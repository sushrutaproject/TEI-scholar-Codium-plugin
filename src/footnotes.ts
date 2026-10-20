// Footnote logic: pure functions over text, returning text edits.
//
//   in the text:   <anchor xml:id="XXX-n1"/>
//   after </text>: <standOff corresp="#XXX" type="Notes">
//                      <note xml:lang="en" target="#XXX-n1">…</note>
//                  </standOff>

import { parse, Elem, Parsed, attr, attrNode, ancestors, localName, whereAt, endOf, elementAt } from './xmlscan';

export interface TextEdit { start: number; end: number; text: string; }

export interface NoteOptions {
  noteLang: string;          // xml:lang on <note>
  standOffTypes: string[];   // known @type values on <standOff>, in display order
  contextElements: string[]; // element names that may supply the context id ([] = any)
  indentUnit: string;
  eol: string;
}

const NOTE_SUFFIX = /^(.*)-n(\d+)$/;

export function escapeRegExp(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function lineIndent(text: string, offset: number): string {
  const ls = text.lastIndexOf('\n', offset - 1) + 1;
  const m = /^[ \t]*/.exec(text.slice(ls, offset));
  return m ? m[0] : '';
}

/** If [start,end) is alone on its line(s), widen it to swallow the line. */
export function wholeLineRange(text: string, start: number, end: number): [number, number] {
  const ls = text.lastIndexOf('\n', start - 1) + 1;
  let le = text.indexOf('\n', end);
  if (le < 0) le = text.length;
  const before = text.slice(ls, start), after = text.slice(end, le);
  if (/^[ \t]*$/.test(before) && /^[ \t\r]*$/.test(after)) {
    // remove the preceding line break together with the line
    if (ls > 0) {
      const prevBreak = text[ls - 2] === '\r' ? ls - 2 : ls - 1;
      return [prevBreak, le === text.length ? le : le - (text[le - 1] === '\r' ? 1 : 0)];
    }
    return [ls, le < text.length ? le + 1 : le];
  }
  return [start, end];
}

export function teiRootOf(el: Elem | undefined, p: Parsed): Elem | undefined {
  for (const a of ancestors(el)) if (localName(a.name) === 'TEI') return a;
  return p.roots.find(r => localName(r.name) === 'TEI');
}

function insideNoteArea(el: Elem | undefined): string | undefined {
  for (const a of ancestors(el)) {
    const n = localName(a.name);
    if (n === 'standOff') return 'inside <standOff>';
    if (n === 'teiHeader') return 'inside the <teiHeader>';
  }
  return undefined;
}

/** The element whose xml:id names the note context at this offset. */
export function findContext(p: Parsed, offset: number, opts: Pick<NoteOptions, 'contextElements'>):
  { el: Elem; id: string } | { error: string } {
  const w = whereAt(p, offset);
  if (w.kind !== 'content') return { error: 'Place the cursor in text, not inside a tag.' };
  const bad = insideNoteArea(w.el);
  if (bad) return { error: `Cannot insert a footnote ${bad}.` };
  const allow = opts.contextElements.map(s => s.trim()).filter(Boolean);
  for (const a of ancestors(w.el)) {
    const ln = localName(a.name);
    if (ln === 'anchor' || ln === 'note') continue;
    const id = attr(a, 'xml:id');
    if (id && (allow.length === 0 || allow.includes(ln))) return { el: a, id };
    if (ln === 'text' || ln === 'TEI') break;
  }
  return {
    error: allow.length
      ? `No enclosing ${allow.map(a => '<' + a + '>').join(' / ')} with an xml:id.`
      : 'No enclosing element with an xml:id.',
  };
}

/** Highest -nN already used for a context, scanning ids and note targets. */
export function maxNoteNumber(p: Parsed, ctxId: string): number {
  const re = new RegExp('^' + escapeRegExp(ctxId) + '-n(\\d+)$');
  let max = 0;
  for (const id of p.ids.keys()) {
    const m = re.exec(id);
    if (m) max = Math.max(max, +m[1]);
  }
  for (const el of p.all) {
    if (localName(el.name) !== 'note') continue;
    const t = attr(el, 'target');
    if (!t) continue;
    for (const tok of t.split(/\s+/)) {
      const m = re.exec(tok.replace(/^#/, ''));
      if (m) max = Math.max(max, +m[1]);
    }
  }
  return max;
}

export function anchorXml(id: string) { return `<anchor xml:id="${id}"/>`; }

export function noteXml(lang: string, anchorId: string, content: string) {
  return `<note xml:lang="${lang}" target="#${anchorId}">${content}</note>`;
}

export function standOffsFor(p: Parsed, tei: Elem | undefined, ctxId: string, type?: string): Elem[] {
  const pool = tei ? tei.children : p.all;
  return pool.filter(e => localName(e.name) === 'standOff' && attr(e, 'corresp') === '#' + ctxId
    && (type === undefined || attr(e, 'type') === type));
}

/** The @type of the standOff holding this note (undefined if not in a standOff). */
export function noteType(note: Elem): string | undefined {
  return note.parent && localName(note.parent.name) === 'standOff' ? attr(note.parent, 'type') : undefined;
}

/** All standOff @type values used in the document, in document order. */
export function typesInDocument(p: Parsed): string[] {
  const out: string[] = [];
  for (const el of p.all) {
    if (localName(el.name) !== 'standOff') continue;
    const t = attr(el, 'type');
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

function noteNumber(note: Elem): number {
  const t = (attr(note, 'target') || '').split(/\s+/)[0].replace(/^#/, '');
  const m = NOTE_SUFFIX.exec(t);
  return m ? +m[2] : Number.MAX_SAFE_INTEGER;
}

/** Edit that places a new <note> in the right <standOff>, creating it if needed. */
export function planNoteInsertion(
  text: string, p: Parsed, ctx: Elem, ctxId: string, anchorId: string, content: string, o: NoteOptions,
  type: string,
): TextEdit {
  const tei = teiRootOf(ctx, p);
  const note = noteXml(o.noteLang, anchorId, content);
  const n = +(NOTE_SUFFIX.exec(anchorId)?.[2] ?? '0');

  const existing = standOffsFor(p, tei, ctxId, type)[0];
  if (existing && !existing.selfClosing) {
    const notes = existing.children.filter(c => localName(c.name) === 'note');
    const before = notes.filter(c => noteNumber(c) < n);
    const after = notes.filter(c => noteNumber(c) >= n);
    if (before.length) {
      const prev = before[before.length - 1];
      const ind = lineIndent(text, prev.start);
      const at = endOf(prev, p);
      return { start: at, end: at, text: o.eol + ind + note };
    }
    if (after.length) {
      const nxt = after[0];
      const ind = lineIndent(text, nxt.start);
      return { start: nxt.start, end: nxt.start, text: note + o.eol + ind };
    }
    const ind = lineIndent(text, existing.start) + o.indentUnit;
    return { start: existing.startTagEnd, end: existing.startTagEnd, text: o.eol + ind + note };
  }

  // Build a new standOff and decide where it goes.
  const block = (ind: string) =>
    `<standOff corresp="#${ctxId}" type="${type}">` + o.eol +
    ind + o.indentUnit + note + o.eol +
    ind + `</standOff>`;

  const kids = tei ? tei.children : p.roots;
  const textEl = kids.find(c => localName(c.name) === 'text');
  const noteStandOffs = kids.filter(c => localName(c.name) === 'standOff' && /^#/.test(attr(c, 'corresp') || ''));

  // keep standOffs in the order of their passages in the text, and within
  // one passage in the order of standOffTypes (Notes, Emendation, …)
  const rank = (t: string | undefined) => {
    const i = t === undefined ? -1 : o.standOffTypes.indexOf(t);
    return i < 0 ? o.standOffTypes.length : i;
  };
  const myRank = rank(type);
  for (const so of noteStandOffs) {
    const target = p.ids.get((attr(so, 'corresp') || '').slice(1))?.[0];
    if (!target) continue;
    if (target.start > ctx.start || (target === ctx && rank(attr(so, 'type')) > myRank)) {
      const ind = lineIndent(text, so.start);
      return { start: so.start, end: so.start, text: block(ind) + o.eol + ind };
    }
  }
  const lastSo = noteStandOffs[noteStandOffs.length - 1]
    ?? [...kids].reverse().find(c => localName(c.name) === 'standOff');
  const after = lastSo ?? textEl;
  if (after) {
    const ind = lineIndent(text, after.start);
    const at = endOf(after, p);
    return { start: at, end: at, text: o.eol + ind + block(ind) };
  }
  if (tei && tei.end >= 0) {
    const ind = lineIndent(text, tei.start) + o.indentUnit;
    return { start: tei.endTagStart, end: tei.endTagStart, text: o.indentUnit + block(ind) + o.eol + lineIndent(text, tei.start) };
  }
  throw new Error('Could not find </text> or </TEI> to place the note after.');
}

// ---------- looking things up ----------

export function anchorAt(p: Parsed, offset: number): Elem | undefined {
  // cursor inside the anchor tag, or touching it on either side
  for (const off of [offset, offset - 1, offset + 1]) {
    const el = elementAt(p, off);
    if (el && localName(el.name) === 'anchor' && attr(el, 'xml:id')) return el;
  }
  // cursor inside a note: return its anchor
  const el = elementAt(p, offset);
  for (const a of ancestors(el)) {
    if (localName(a.name) === 'note') {
      const t = (attr(a, 'target') || '').split(/\s+/)[0].replace(/^#/, '');
      const anc = p.ids.get(t)?.[0];
      if (anc && localName(anc.name) === 'anchor') return anc;
    }
  }
  return undefined;
}

export function noteFor(p: Parsed, anchorId: string): Elem | undefined {
  const want = '#' + anchorId;
  for (const el of p.all) {
    if (localName(el.name) !== 'note') continue;
    const t = attr(el, 'target');
    if (t && t.split(/\s+/).includes(want)) return el;
  }
  return undefined;
}

export function noteContent(text: string, note: Elem): string {
  if (note.selfClosing || note.end < 0) return '';
  return text.slice(note.startTagEnd, note.endTagStart);
}

export function contextIdOfAnchor(anchorId: string): string | undefined {
  return NOTE_SUFFIX.exec(anchorId)?.[1];
}

/** Edit that removes a note, and its standOff if that becomes empty. */
export function planNoteRemoval(text: string, p: Parsed, note: Elem): TextEdit {
  const so = note.parent && localName(note.parent.name) === 'standOff' ? note.parent : undefined;
  const others = so ? so.children.filter(c => c !== note) : [];
  const victim = so && others.length === 0 ? so : note;
  const [s, e] = wholeLineRange(text, victim.start, endOf(victim, p));
  return { start: s, end: e, text: '' };
}

/** Smallest single edit turning `before` into `after`. */
export function diffEdit(before: string, after: string): TextEdit {
  let s = 0;
  const max = Math.min(before.length, after.length);
  while (s < max && before[s] === after[s]) s++;
  let e = 0;
  while (e < max - s && before[before.length - 1 - e] === after[after.length - 1 - e]) e++;
  return { start: s, end: before.length - e, text: after.slice(s, after.length - e) };
}

/**
 * Move a note to the standOff of another @type (creating it if needed, and
 * removing the old one if it empties), also replacing its content.
 * Returns one edit so the change is a single undo step.
 */
export function planRetype(
  text: string, p: Parsed, anchorId: string, newType: string, content: string, o: NoteOptions,
): TextEdit {
  const note = noteFor(p, anchorId);
  if (!note) throw new Error(`No note for ${anchorId}.`);
  const ctxId = contextIdOfAnchor(anchorId);
  if (!ctxId) throw new Error(`Cannot tell the passage of ${anchorId}.`);
  const mid = applyEdits(text, [planNoteRemoval(text, p, note)]);
  const p2 = parse(mid);
  const ctx = p2.ids.get(ctxId)?.[0];
  if (!ctx) throw new Error(`No element with xml:id="${ctxId}".`);
  const final = applyEdits(mid, [planNoteInsertion(mid, p2, ctx, ctxId, anchorId, content, o, newType)]);
  return diffEdit(text, final);
}

/** Edits that remove an anchor, its note, and an emptied standOff. */
export function planDeletion(text: string, p: Parsed, anchor: Elem): TextEdit[] {
  const edits: TextEdit[] = [{ start: anchor.start, end: anchor.end, text: '' }];
  const id = attr(anchor, 'xml:id')!;
  const note = noteFor(p, id);
  if (note) edits.push(planNoteRemoval(text, p, note));
  return edits;
}

/**
 * Renumber every context's notes in reading order (n1, n2, …), update the
 * note targets, and sort the notes inside each standOff to match.
 */
export function planRenumber(text: string, p: Parsed): { edits: TextEdit[]; changed: number } {
  const edits: TextEdit[] = [];
  const byCtx = new Map<string, Elem[]>();
  for (const el of p.all) {
    if (localName(el.name) !== 'anchor') continue;
    const id = attr(el, 'xml:id');
    const m = id && NOTE_SUFFIX.exec(id);
    if (!m) continue;
    // only anchors that actually have a note are treated as footnotes
    if (!noteFor(p, id!)) continue;
    const list = byCtx.get(m[1]);
    if (list) list.push(el); else byCtx.set(m[1], [el]);
  }
  const rename = new Map<string, string>();
  let changed = 0;
  for (const [ctx, anchors] of byCtx) {
    anchors.forEach((a, i) => {
      const oldId = attr(a, 'xml:id')!;
      const newId = `${ctx}-n${i + 1}`;
      rename.set(oldId, newId);
      if (oldId !== newId) changed++;
    });
  }
  if (!changed) return { edits, changed };

  // anchors
  for (const [ctx, anchors] of byCtx) {
    void ctx;
    for (const a of anchors) {
      const at = attrNode(a, 'xml:id')!;
      const nu = rename.get(at.value)!;
      if (nu !== at.value) edits.push({ start: at.valueStart, end: at.valueEnd, text: nu });
    }
  }
  // standOffs: rebuild note order, or just retarget notes outside standOff
  const handledNotes = new Set<Elem>();
  for (const so of p.all.filter(e => localName(e.name) === 'standOff')) {
    const notes = so.children.filter(c => localName(c.name) === 'note');
    if (!notes.length) continue;
    const retarget = (n: Elem) => {
      let s = text.slice(n.start, endOf(n, p));
      const t = attrNode(n, 'target');
      if (t) {
        const newVal = t.value.split(/(\s+)/).map(tok => {
          const nu = tok.startsWith('#') ? rename.get(tok.slice(1)) : undefined;
          return nu ? '#' + nu : tok;
        }).join('');
        s = s.slice(0, t.valueStart - n.start) + newVal + s.slice(t.valueEnd - n.start);
      }
      return s;
    };
    const sorted = [...notes].sort((a, b) => sortKey(a) - sortKey(b));
    function sortKey(n: Elem) {
      const t = (attr(n, 'target') || '').split(/\s+/)[0].replace(/^#/, '');
      const nu = rename.get(t);
      const m = nu && NOTE_SUFFIX.exec(nu);
      return m ? +m[2] : Number.MAX_SAFE_INTEGER - notes.length + notes.indexOf(n);
    }
    // replace each note slot (keeping the whitespace between notes) with the sorted note
    notes.forEach((slot, i) => {
      handledNotes.add(slot);
      const replacement = retarget(sorted[i]);
      const original = text.slice(slot.start, endOf(slot, p));
      if (replacement !== original) edits.push({ start: slot.start, end: endOf(slot, p), text: replacement });
    });
  }
  // notes elsewhere that point at renamed anchors
  for (const n of p.all) {
    if (localName(n.name) !== 'note' || handledNotes.has(n)) continue;
    const t = attrNode(n, 'target');
    if (!t) continue;
    const newVal = t.value.split(/(\s+)/).map(tok => {
      const nu = tok.startsWith('#') ? rename.get(tok.slice(1)) : undefined;
      return nu ? '#' + nu : tok;
    }).join('');
    if (newVal !== t.value) edits.push({ start: t.valueStart, end: t.valueEnd, text: newVal });
  }
  return { edits, changed };
}

/** Apply non-overlapping edits to a string (used by tests). */
export function applyEdits(text: string, edits: TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = text;
  for (const e of sorted) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/** Footnote anchors (anchors with a note) in reading order. */
export function footnoteAnchors(p: Parsed): Elem[] {
  const targets = new Set<string>();
  for (const el of p.all) {
    if (localName(el.name) !== 'note') continue;
    for (const t of (attr(el, 'target') || '').split(/\s+/)) if (t.startsWith('#')) targets.add(t.slice(1));
  }
  return p.all.filter(el => localName(el.name) === 'anchor' && targets.has(attr(el, 'xml:id') || ''));
}
