// A small, fast, error-tolerant XML scanner that keeps character offsets.
// It is not a validator (Red Hat XML / Jing does that); it gives the
// extension a tree it can navigate even while the document is half-typed.

export interface Attr {
  name: string;
  value: string;      // raw value, entities not expanded
  nameStart: number;
  nameEnd: number;
  valueStart: number; // offset of first char inside the quotes
  valueEnd: number;   // offset of the closing quote
}

export interface Elem {
  name: string;
  start: number;        // offset of '<'
  nameEnd: number;      // offset just after the element name
  startTagEnd: number;  // offset just after '>' of the start tag
  endTagStart: number;  // offset of '</' (== startTagEnd for empty elements)
  end: number;          // offset just after the closing '>' (-1 while unclosed)
  selfClosing: boolean;
  attrs: Attr[];
  parent?: Elem;
  children: Elem[];
}

export interface Parsed {
  roots: Elem[];
  all: Elem[];          // every element, in document order
  ids: Map<string, Elem[]>;
  textLength: number;
}

const NAME = /[^\s=\/>"'<]+/y;
const ATTR = /\s*([^\s=\/>"'<]+)\s*=\s*("([^"]*)"|'([^']*)')/y;

export function parse(text: string): Parsed {
  const roots: Elem[] = [];
  const all: Elem[] = [];
  const stack: Elem[] = [];
  const n = text.length;
  let i = 0;

  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    i = lt;
    if (text.startsWith('<!--', i)) {
      const e = text.indexOf('-->', i + 4);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', i)) {
      const e = text.indexOf(']]>', i + 9);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (text.startsWith('<?', i)) {
      const e = text.indexOf('?>', i + 2);
      i = e < 0 ? n : e + 2;
      continue;
    }
    if (text.startsWith('<!', i)) {
      // DOCTYPE, possibly with an internal subset
      let j = i + 2, depth = 0;
      while (j < n) {
        const c = text[j];
        if (c === '[') depth++;
        else if (c === ']') depth--;
        else if (c === '>' && depth <= 0) break;
        j++;
      }
      i = j + 1;
      continue;
    }
    if (text[i + 1] === '/') {
      NAME.lastIndex = i + 2;
      const m = NAME.exec(text);
      const name = m ? m[0] : '';
      const gt = text.indexOf('>', i);
      const end = gt < 0 ? n : gt + 1;
      // close the nearest matching open element (tolerant of bad nesting)
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].name === name) {
          while (stack.length > k + 1) stack.pop(); // unclosed children stay end = -1
          const el = stack.pop()!;
          el.endTagStart = i;
          el.end = end;
          break;
        }
      }
      i = end;
      continue;
    }
    NAME.lastIndex = i + 1;
    const m = NAME.exec(text);
    if (!m) { i++; continue; }
    const el: Elem = {
      name: m[0], start: i, nameEnd: i + 1 + m[0].length,
      startTagEnd: -1, endTagStart: -1, end: -1,
      selfClosing: false, attrs: [], children: [],
    };
    let j = el.nameEnd;
    for (;;) {
      ATTR.lastIndex = j;
      const a = ATTR.exec(text);
      if (!a) break;
      const full = a[0];
      const nameStart = j + full.indexOf(a[1]);
      const quoteOffset = full.length - a[2].length;
      el.attrs.push({
        name: a[1],
        value: a[3] !== undefined ? a[3] : a[4],
        nameStart,
        nameEnd: nameStart + a[1].length,
        valueStart: j + quoteOffset + 1,
        valueEnd: j + full.length - 1,
      });
      j += full.length;
    }
    // find end of start tag
    let gt = j;
    while (gt < n && text[gt] !== '>' && text[gt] !== '<') gt++;
    if (gt >= n || text[gt] === '<') {
      // broken tag: treat as ended here so scanning can continue
      el.startTagEnd = gt;
      el.selfClosing = true;
    } else {
      el.selfClosing = text[gt - 1] === '/';
      el.startTagEnd = gt + 1;
    }
    const parent = stack[stack.length - 1];
    if (parent) { el.parent = parent; parent.children.push(el); } else roots.push(el);
    all.push(el);
    if (el.selfClosing) {
      el.endTagStart = el.startTagEnd;
      el.end = el.startTagEnd;
    } else {
      stack.push(el);
    }
    i = el.startTagEnd;
  }

  const ids = new Map<string, Elem[]>();
  for (const el of all) {
    const id = attr(el, 'xml:id');
    if (id !== undefined) {
      const list = ids.get(id);
      if (list) list.push(el); else ids.set(id, [el]);
    }
  }
  return { roots, all, ids, textLength: n };
}

export function attr(el: Elem, name: string): string | undefined {
  for (const a of el.attrs) if (a.name === name) return a.value;
  return undefined;
}

export function attrNode(el: Elem, name: string): Attr | undefined {
  for (const a of el.attrs) if (a.name === name) return a;
  return undefined;
}

export function localName(name: string): string {
  const c = name.indexOf(':');
  return c < 0 ? name : name.slice(c + 1);
}

/** Effective end of an element (unclosed elements run to end of text). */
export function endOf(el: Elem, p: Parsed): number {
  return el.end < 0 ? p.textLength : el.end;
}

/** Deepest element containing offset (including its tags). */
export function elementAt(p: Parsed, offset: number): Elem | undefined {
  let list = p.roots;
  let found: Elem | undefined;
  for (;;) {
    let next: Elem | undefined;
    // binary search would be faster; linear on children is fine in practice
    for (const c of list) {
      if (c.start >= offset) break;
      const e = endOf(c, p);
      if (offset < e || (c.end < 0 && offset <= e)) { next = c; }
    }
    if (!next) return found;
    found = next;
    list = next.children;
  }
}

export type Where =
  | { kind: 'elementName'; el: Elem; closing: boolean }
  | { kind: 'attrName'; el: Elem; attr: Attr }
  | { kind: 'attrValue'; el: Elem; attr: Attr }
  | { kind: 'inTag'; el: Elem }
  | { kind: 'content'; el?: Elem };

/** Classify what lies at an offset. */
export function whereAt(p: Parsed, offset: number): Where {
  const el = elementAt(p, offset);
  if (!el) return { kind: 'content' };
  // inside the start tag?
  if (offset > el.start && offset < el.startTagEnd) {
    if (offset <= el.nameEnd) return { kind: 'elementName', el, closing: false };
    for (const a of el.attrs) {
      if (offset >= a.nameStart && offset <= a.nameEnd) return { kind: 'attrName', el, attr: a };
      if (offset >= a.valueStart && offset <= a.valueEnd) return { kind: 'attrValue', el, attr: a };
    }
    return { kind: 'inTag', el };
  }
  if (el.end >= 0 && !el.selfClosing && offset > el.endTagStart && offset < el.end) {
    return { kind: 'elementName', el, closing: true };
  }
  // a child's end tag area belongs to the child; content belongs to el
  return { kind: 'content', el };
}

export function ancestors(el: Elem | undefined): Elem[] {
  const out: Elem[] = [];
  for (let e = el; e; e = e.parent) out.push(e);
  return out;
}

export function isTeiDocument(text: string): boolean {
  return /xmlns\s*=\s*["']http:\/\/www\.tei-c\.org\/ns\/1\.0["']/.test(text.slice(0, 20000))
    || /<(TEI|teiCorpus)[\s>]/.test(text.slice(0, 20000));
}
