// Keeps footnote notes in step with their anchors when the text is edited
// by hand: deleting an anchor deletes its note; cutting an anchor and
// pasting it elsewhere brings the note back.

import { Parsed, attr, localName } from './xmlscan';

export interface AnchorSnap { id: string; start: number; end: number; }
export interface Change { rangeOffset: number; rangeLength: number; text: string; }

export function snapshotAnchors(p: Parsed): AnchorSnap[] {
  const out: AnchorSnap[] = [];
  for (const el of p.all) {
    if (localName(el.name) !== 'anchor') continue;
    const id = attr(el, 'xml:id');
    if (id) out.push({ id, start: el.start, end: el.end });
  }
  return out;
}

/** Does this batch of changes possibly add or remove an anchor? */
export function touchesAnchors(old: AnchorSnap[], changes: readonly Change[]): boolean {
  for (const c of changes) {
    if (c.text.includes('anchor')) return true;
    const s = c.rangeOffset, e = c.rangeOffset + c.rangeLength;
    if (c.rangeLength > 0 && old.some(a => a.start < e && a.end > s)) return true;
  }
  return false;
}

/** Move the snapshot's offsets past changes that do not touch any anchor. */
export function shiftAnchors(old: AnchorSnap[], changes: readonly Change[]): AnchorSnap[] {
  // changes in one event are relative to the old text; apply from the end
  const sorted = [...changes].sort((a, b) => b.rangeOffset - a.rangeOffset);
  const out = old.map(a => ({ ...a }));
  for (const c of sorted) {
    const delta = c.text.length - c.rangeLength;
    const end = c.rangeOffset + c.rangeLength;
    for (const a of out) if (a.start >= end) { a.start += delta; a.end += delta; }
  }
  return out;
}

/**
 * Ids of anchors removed by these changes: an edit deleted the anchor's
 * opening "<", and no anchor with that id remains. (Editing the id itself
 * leaves the "<" alone, so it is not mistaken for a deletion.)
 */
export function deletedAnchorIds(old: AnchorSnap[], changes: readonly Change[], now: Parsed): string[] {
  const out: string[] = [];
  for (const a of old) {
    const hit = changes.some(c => c.rangeLength > 0 && c.rangeOffset <= a.start && a.start < c.rangeOffset + c.rangeLength);
    if (!hit) continue;
    const still = now.ids.get(a.id)?.some(e => localName(e.name) === 'anchor');
    if (!still && !out.includes(a.id)) out.push(a.id);
  }
  return out;
}

/** Ids of anchors that arrived in inserted text (paste, undo of a cut …). */
export function insertedAnchorIds(changes: readonly Change[]): string[] {
  const out: string[] = [];
  for (const c of changes) {
    for (const m of c.text.matchAll(/<anchor\b[^>]*\bxml:id\s*=\s*["']([^"']+)["']/g)) {
      if (!out.includes(m[1])) out.push(m[1]);
    }
  }
  return out;
}
