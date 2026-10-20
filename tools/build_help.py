#!/usr/bin/env python3
"""Build data/tei-help.json from the TEI P5 ODD source (p5subset.xml).

Usage: python3 tools/build_help.py path/to/p5subset.xml data/tei-help.json 4.10.2
"""
import json
import re
import sys
from lxml import etree

TEI = 'http://www.tei-c.org/ns/1.0'
NS = {'t': TEI}
XML_LANG = '{http://www.w3.org/XML/1998/namespace}lang'


def q(tag):
    return '{%s}%s' % (TEI, tag)


def flat(node):
    """Flatten a TEI desc/gloss into plain text with light markdown."""
    out = []

    def walk(n):
        tag = etree.QName(n).localname if isinstance(n.tag, str) else None
        if tag == 'gi':
            out.append('`<%s>`' % (n.text or ''))
        elif tag == 'att':
            out.append('`@%s`' % (n.text or ''))
        elif tag == 'val':
            out.append('`"%s"`' % (n.text or ''))
        elif tag in ('ident', 'code', 'tag'):
            out.append('`%s`' % ''.join(n.itertext()))
        elif tag is None:
            pass
        else:
            if n.text:
                out.append(n.text)
            for c in n:
                walk(c)
                if c.tail:
                    out.append(c.tail)
            return
        # leaf handled above; tail handled by parent

    if node.text:
        out.append(node.text)
    for c in node:
        walk(c)
        if c.tail:
            out.append(c.tail)
    return re.sub(r'\s+', ' ', ''.join(out)).strip()


def en(parent, tag):
    for n in parent.findall(q(tag)):
        if n.get(XML_LANG, 'en') == 'en':
            return flat(n)
    return ''


def att_def(ad):
    d = {}
    g = en(ad, 'gloss')
    if g:
        d['gloss'] = g
    ds = en(ad, 'desc')
    if ds:
        d['desc'] = ds
    if ad.get('usage') == 'req':
        d['required'] = True
    vl = ad.find(q('valList'))
    if vl is not None:
        vals = []
        for vi in vl.findall(q('valItem')):
            v = {'v': vi.get('ident')}
            txt = en(vi, 'gloss') or en(vi, 'desc')
            if txt:
                v['d'] = txt
            vals.append(v)
        if vals:
            d['vals'] = vals
            d['valType'] = vl.get('type', 'open')
    return d


def main(src, dst):
    tree = etree.parse(src)
    root = tree.getroot()

    # ---- classes ----
    att_classes = {}
    model_parents = {}   # model class -> model classes it is a member of
    model_desc = {}
    for cs in root.iter(q('classSpec')):
        ident = cs.get('ident')
        members = [m.get('key') for m in cs.findall('%s/%s' % (q('classes'), q('memberOf')))]
        if cs.get('type') == 'atts':
            atts = {}
            deleted = []
            for ad in cs.iter(q('attDef')):
                if ad.get('mode') == 'delete':
                    deleted.append(ad.get('ident'))
                    continue
                atts[ad.get('ident')] = att_def(ad)
            att_classes[ident] = {
                'desc': en(cs, 'desc'),
                'module': cs.get('module'),
                'memberOf': [m for m in members if m.startswith('att.')],
                'atts': atts,
                'deleted': deleted,
            }
        else:
            model_parents[ident] = [m for m in members if m.startswith('model.')]
            model_desc[ident] = en(cs, 'desc')

    macros = {}
    for ms in root.iter(q('macroSpec')):
        macros[ms.get('ident')] = ms.find(q('content'))

    elements = {}
    element_models = {}
    contents = {}
    for es in root.iter(q('elementSpec')):
        name = es.get('ident')
        members = [m.get('key') for m in es.findall('%s/%s' % (q('classes'), q('memberOf')))]
        local = {}
        deleted = []
        al = es.find(q('attList'))
        if al is not None:
            for ad in al.iter(q('attDef')):
                if ad.get('mode') == 'delete':
                    deleted.append(ad.get('ident'))
                    continue
                d = att_def(ad)
                if ad.get('mode') == 'change' and not d:
                    continue
                local[ad.get('ident')] = d
        elements[name] = {
            'gloss': en(es, 'gloss'),
            'desc': en(es, 'desc'),
            'module': es.get('module'),
            'attClasses': [m for m in members if m.startswith('att.')],
            'atts': local,
            'deleted': deleted,
        }
        element_models[name] = [m for m in members if m.startswith('model.')]
        contents[name] = es.find(q('content'))

    # model class -> all elements (transitively)
    def model_ancestors(m, seen=None):
        seen = seen or set()
        for p in model_parents.get(m, []):
            if p not in seen:
                seen.add(p)
                model_ancestors(p, seen)
        return seen

    model_members = {}
    for el, models in element_models.items():
        allm = set()
        for m in models:
            allm.add(m)
            allm |= model_ancestors(m)
        for m in allm:
            model_members.setdefault(m, set()).add(el)

    def collect(node, acc, seen_macros):
        if node is None:
            return
        for n in node.iter():
            if not isinstance(n.tag, str):
                continue
            ln = etree.QName(n).localname
            if ln == 'elementRef':
                acc.add(n.get('key'))
            elif ln == 'classRef':
                acc |= model_members.get(n.get('key'), set())
            elif ln == 'macroRef':
                k = n.get('key')
                if k not in seen_macros:
                    seen_macros.add(k)
                    collect(macros.get(k), acc, seen_macros)
            elif ln == 'textNode':
                acc.add('#text')
            elif ln == 'anyElement':
                acc.add('#any')
            elif ln == 'dataRef':
                acc.add('#data')

    parents = {}
    for el, c in contents.items():
        acc = set()
        collect(c, acc, set())
        kids = sorted(x for x in acc if x in elements)
        elements[el]['contains'] = kids
        flags = sorted(x for x in acc if x.startswith('#'))
        if flags:
            elements[el]['text'] = flags
        for k in kids:
            parents.setdefault(k, set()).add(el)
    for el in elements:
        elements[el]['parents'] = sorted(parents.get(el, []))

    out = {
        'version': sys.argv[3] if len(sys.argv) > 3 else '',
        'elements': elements,
        'attClasses': att_classes,
    }
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print('elements', len(elements), 'attClasses', len(att_classes))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
