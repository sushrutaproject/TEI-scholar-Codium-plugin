// TEI documentation lookups built from data/tei-help.json (from p5subset.xml).

export interface AttDef { gloss?: string; desc?: string; required?: boolean; vals?: { v: string; d?: string }[]; valType?: string; }
export interface ElementDoc {
  gloss: string; desc: string; module: string;
  attClasses: string[]; atts: Record<string, AttDef>; deleted: string[];
  contains: string[]; parents: string[]; text?: string[];
}
export interface AttClassDoc { desc: string; module: string; memberOf: string[]; atts: Record<string, AttDef>; deleted: string[]; }
export interface HelpData { version: string; elements: Record<string, ElementDoc>; attClasses: Record<string, AttClassDoc>; }

export const DOC_BASE = 'https://www.tei-c.org/release/doc/tei-p5-doc/en/html/';
export const refUrl = (ident: string) => `${DOC_BASE}ref-${ident}.html`;

export interface ResolvedAtt { def: AttDef; origin: string; } // origin = element name or att class

export class TeiHelp {
  private attCache = new Map<string, Map<string, ResolvedAtt>>();
  constructor(public data: HelpData) {}

  element(name: string): ElementDoc | undefined {
    return Object.prototype.hasOwnProperty.call(this.data.elements, name) ? this.data.elements[name] : undefined;
  }

  attributes(elName: string): Map<string, ResolvedAtt> {
    const cached = this.attCache.get(elName);
    if (cached) return cached;
    const out = new Map<string, ResolvedAtt>();
    const el = this.element(elName);
    if (!el) return out;
    const deleted = new Set(el.deleted);
    for (const [k, d] of Object.entries(el.atts)) out.set(k, { def: d, origin: elName });
    const seen = new Set<string>();
    const visit = (cls: string) => {
      if (seen.has(cls)) return;
      seen.add(cls);
      const c = this.data.attClasses[cls];
      if (!c) return;
      for (const d of c.deleted) deleted.add(d);
      for (const [k, d] of Object.entries(c.atts)) {
        const prev = out.get(k);
        if (!prev) out.set(k, { def: d, origin: cls });
        else if (!prev.def.desc && d.desc) prev.def = { ...d, ...prev.def, desc: d.desc };
      }
      for (const m of c.memberOf) visit(m);
    };
    for (const c of el.attClasses) visit(c);
    for (const d of deleted) if (out.get(d)?.origin !== elName) out.delete(d);
    this.attCache.set(elName, out);
    return out;
  }

  elementMarkdown(name: string, opts: { maxList: number }): string | undefined {
    const el = this.element(name);
    if (!el) return undefined;
    const lines: string[] = [];
    lines.push(`**\`<${name}>\`**${el.gloss ? ` *(${el.gloss})*` : ''} — [TEI reference ↗](${refUrl(name)})`);
    if (el.desc) lines.push('', cap(el.desc));
    const atts = [...this.attributes(name).entries()];
    if (atts.length) {
      const own = atts.filter(([, a]) => a.origin === name).map(([k, a]) => `**@${k}**${a.def.required ? ' (required)' : ''}`);
      const classes = [...new Set(atts.filter(([, a]) => a.origin !== name).map(([, a]) => a.origin))];
      const parts: string[] = [];
      if (own.length) parts.push(own.join(', '));
      if (classes.length) parts.push('classes ' + classes.slice(0, 8).map(c => `[${c}](${refUrl(c)})`).join(', ') + (classes.length > 8 ? ' …' : ''));
      lines.push('', '**Attributes:** ' + parts.join('; '));
    }
    lines.push('', '**May contain:** ' + this.list(el.contains, opts.maxList, el.text));
    lines.push('', '**Contained by:** ' + this.list(el.parents, opts.maxList));
    lines.push('', `*Module ${el.module} · TEI P5 ${this.data.version}*`);
    return lines.join('\n');
  }

  attributeMarkdown(elName: string, attName: string, value?: string): string | undefined {
    const a = this.attributes(elName).get(attName);
    if (!a) {
      if (!this.element(elName)) return undefined;
      return `**@${attName}** is not defined for \`<${elName}>\` in TEI P5 — [see \`<${elName}>\` ↗](${refUrl(elName)})`;
    }
    const lines: string[] = [];
    const where = a.origin === elName ? `\`<${elName}>\`` : `[${a.origin}](${refUrl(a.origin)})`;
    lines.push(`**@${attName}**${a.def.gloss ? ` *(${a.def.gloss})*` : ''} on \`<${elName}>\` — defined in ${where}`);
    if (a.def.desc) lines.push('', cap(a.def.desc));
    if (a.def.vals?.length) {
      const kind = a.def.valType === 'closed' ? 'Allowed values' : 'Suggested values';
      lines.push('', `**${kind}:**`);
      for (const v of a.def.vals.slice(0, 30)) {
        const mark = value !== undefined && value.split(/\s+/).includes(v.v) ? '▶ ' : '';
        lines.push(`- ${mark}\`${v.v}\`${v.d ? ' — ' + v.d : ''}`);
      }
      if (a.def.vals.length > 30) lines.push(`- … ${a.def.vals.length - 30} more`);
    }
    lines.push('', `[Reference for \`<${elName}>\` ↗](${refUrl(elName)})`);
    return lines.join('\n');
  }

  pathMarkdown(path: string[]): string {
    // path: outermost → innermost
    const inner = path[path.length - 1];
    const el = this.element(inner);
    const crumbs = path.map(n => this.element(n) ? `[${n}](${refUrl(n)})` : n).join(' › ');
    return crumbs + (el ? `\n\n\`<${inner}>\` — ${el.gloss || cap(el.desc).slice(0, 140)}` : '');
  }

  private list(names: string[], max: number, extra?: string[]): string {
    const bits: string[] = [];
    if (extra?.includes('#text')) bits.push('*text*');
    if (extra?.includes('#data')) bits.push('*a data value*');
    if (extra?.includes('#any')) bits.push('*any element*');
    const shown = names.slice(0, max).map(n => `[${n}](${refUrl(n)})`);
    bits.push(...shown);
    if (names.length > max) bits.push(`… and ${names.length - max} more`);
    return bits.length ? bits.join(', ') : '*nothing (empty element)*';
  }
}

function cap(s: string) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
