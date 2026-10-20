import { readFileSync, writeFileSync } from 'fs';
import { parse } from '../src/xmlscan';
import * as F from '../src/footnotes';
import * as T from '../src/translit';
import * as G from '../src/anchorGuard';

const opts: F.NoteOptions = { noteLang: 'en', standOffTypes: ['Notes', 'Emendation', 'Testimonia'], contextElements: [], indentUnit: '    ', eol: '\n' };
let fails = 0;
function check(name: string, ok: boolean, extra = '') {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + extra));
  if (!ok) fails++;
}

function addNote(text: string, after: string, note: string, occurrence = 0, type = 'Notes'): { text: string; id: string } {
  let idx = -1;
  for (let k = 0; k <= occurrence; k++) idx = text.indexOf(after, idx + 1);
  if (idx < 0) throw new Error('marker not found: ' + after);
  const offset = idx + after.length;
  let p = parse(text);
  const ctx = F.findContext(p, offset, opts);
  if ('error' in ctx) throw new Error(ctx.error);
  const id = `${ctx.id}-n${F.maxNoteNumber(p, ctx.id) + 1}`;
  text = text.slice(0, offset) + F.anchorXml(id) + text.slice(offset);   // step 1: anchor
  p = parse(text);                                                       // step 2: note on save
  const ctxEl = p.ids.get(ctx.id)![0];
  const e = F.planNoteInsertion(text, p, ctxEl, ctx.id, id, note, opts, type);
  return { text: F.applyEdits(text, [e]), id };
}

let t = readFileSync(__dirname + '/sample.xml', 'utf8');
let r = addNote(t, 'ṛṣigaṇaparivṛtam', 'Some manuscripts read <foreign xml:lang="sa-Latn">ṛṣigaṇa</foreign>.'); t = r.text;
check('first id', r.id === 'SS.1.1.2-n1', r.id);
r = addNote(t, 'vyākhyāsyāmaḥ', 'Cf. Carakasaṃhitā Sū. 1.1.'); t = r.text;
check('second ctx id', r.id === 'SS.1.1.1-n1', r.id);
r = addNote(t, 'atha khalu', 'Ḍalhaṇa glosses <q>atha</q> as auspicious.'); t = r.text;
check('increment', r.id === 'SS.1.1.2-n2', r.id);
r = addNote(t, 'pauṣkalāvata', 'Names of the students.'); t = r.text;
check('third ctx', r.id === 'SS.1.1.3-n1', r.id);
writeFileSync(__dirname + '/out1.xml', t);

const so = [...t.matchAll(/<standOff corresp="#([^"]+)"/g)].map(m => m[1]);
check('standOff order follows text', JSON.stringify(so) === JSON.stringify(['SS.1.1.1', 'SS.1.1.2', 'SS.1.1.3']), JSON.stringify(so));
check('standOffs after </text>', t.indexOf('<standOff') > t.indexOf('</text>') && t.lastIndexOf('</standOff>') < t.indexOf('</TEI>'));
const block = t.slice(t.indexOf('<standOff corresp="#SS.1.1.2"'), t.indexOf('</standOff>', t.indexOf('<standOff corresp="#SS.1.1.2"')));
check('notes ordered by n inside standOff', block.indexOf('-n1"') < block.indexOf('-n2"'));

// errors
let p = parse(t);
const inTag = t.indexOf('<lg xml:id="SS.1.1.3"') + 3;
check('reject inside tag', 'error' in F.findContext(p, inTag, opts));
check('reject in header', 'error' in F.findContext(p, t.indexOf('Born digital'), opts));
check('reject in standOff', 'error' in F.findContext(p, t.indexOf('Names of the'), opts));
const restricted = F.findContext(p, t.indexOf('athāto') + 2, { contextElements: ['div'] });
check('contextElements setting', !('error' in restricted) && restricted.id === 'SS.1.1', ('error' in restricted) ? restricted.error : restricted.id);

// lookups
const anc = F.anchorAt(p, t.indexOf('<anchor xml:id="SS.1.1.2-n2"/>') + 30)!;
check('anchorAt touching', anc && anc.attrs[0].value === 'SS.1.1.2-n2');
check('noteFor', F.noteContent(t, F.noteFor(p, 'SS.1.1.2-n2')!) === 'Ḍalhaṇa glosses <q>atha</q> as auspicious.');
check('anchorAt from inside note', F.anchorAt(p, t.indexOf('Names of the') + 2)?.attrs[0].value === 'SS.1.1.3-n1');

// renumber: SS.1.1.2-n2 comes first in reading order
const rn = F.planRenumber(t, p);
let t2 = F.applyEdits(t, rn.edits);
writeFileSync(__dirname + '/out2.xml', t2);
const firstAnchor = /<anchor xml:id="SS\.1\.1\.2-n(\d)"\/>atha khalu|atha khalu/.exec(t2);
check('renumber changed 2', rn.changed === 2, String(rn.changed));
check('renumber anchors', t2.indexOf('<anchor xml:id="SS.1.1.2-n1"/>') < t2.indexOf('<anchor xml:id="SS.1.1.2-n2"/>'));
const p2 = parse(t2);
check('renumber notes follow', F.noteContent(t2, F.noteFor(p2, 'SS.1.1.2-n1')!).startsWith('Ḍalhaṇa'));
const b2 = t2.slice(t2.indexOf('<standOff corresp="#SS.1.1.2"'));
check('renumber note order', b2.indexOf('#SS.1.1.2-n1') < b2.indexOf('#SS.1.1.2-n2'));
void firstAnchor;
check('renumber idempotent', F.planRenumber(t2, p2).changed === 0);

// deletion: last note in a standOff removes the standOff
const del = F.planDeletion(t2, p2, F.anchorAt(p2, t2.indexOf('<anchor xml:id="SS.1.1.1-n1"/>') + 3)!);
const t3 = F.applyEdits(t2, del);
writeFileSync(__dirname + '/out3.xml', t3);
check('delete anchor', !t3.includes('SS.1.1.1-n1'));
check('delete empty standOff', !t3.includes('corresp="#SS.1.1.1"'));
check('no blank lines left', !/\n[ \t]*\n/.test(t3.slice(t3.indexOf('</text>'))), JSON.stringify(t3.slice(t3.indexOf('</text>'), t3.indexOf('</text>') + 80)));
const p3 = parse(t3);
const del2 = F.planDeletion(t3, p3, F.anchorAt(p3, t3.indexOf('<anchor xml:id="SS.1.1.2-n1"/>') + 3)!);
const t4 = F.applyEdits(t3, del2);
check('delete one of two keeps standOff', t4.includes('corresp="#SS.1.1.2"') && t4.includes('#SS.1.1.2-n2') && !t4.includes('#SS.1.1.2-n1'));

// edit existing note content
const n2 = F.noteFor(p3, 'SS.1.1.3-n1')!;
const t5 = F.applyEdits(t3, [{ start: n2.startTagEnd, end: n2.endTagStart, text: 'Edited.' }]);
check('edit note', t5.includes('target="#SS.1.1.3-n1">Edited.</note>'));

// CRLF files
const crlf = readFileSync(__dirname + '/sample.xml', 'utf8').replace(/\n/g, '\r\n');
{
  const o2 = { ...opts, eol: '\r\n' };
  const off = crlf.indexOf('dhanvantariḥ') + 'dhanvantariḥ'.length;
  let pc = parse(crlf);
  const c = F.findContext(pc, off, o2) as { el: any; id: string };
  const tt = crlf.slice(0, off) + F.anchorXml(c.id + '-n1') + crlf.slice(off);
  pc = parse(tt);
  const out = F.applyEdits(tt, [F.planNoteInsertion(tt, pc, pc.ids.get(c.id)![0], c.id, c.id + '-n1', 'x', o2, 'Notes')]);
  check('CRLF preserved', !/[^\r]\n/.test(out));
  const pd = parse(out);
  const back = F.applyEdits(out, F.planDeletion(out, pd, F.anchorAt(pd, out.indexOf('<anchor') + 3)!));
  check('CRLF delete restores original', back === crlf);
}

// ---- standOff types ----
{
  let u = readFileSync(__dirname + '/sample.xml', 'utf8');
  let r2 = addNote(u, 'ṛṣigaṇaparivṛtam', 'A testimonium.', 0, 'Testimonia'); u = r2.text;
  r2 = addNote(u, 'ṛṣigaṇaparivṛtam', 'Read ṛṣigaṇa°.', 0, 'Emendation'); u = r2.text;
  check('types share the n-sequence', r2.id === 'SS.1.1.2-n2', r2.id);
  r2 = addNote(u, 'atha khalu', 'Plain note.', 0, 'Notes'); u = r2.text;
  r2 = addNote(u, 'vyākhyāsyāmaḥ', 'Emendation in first verse.', 0, 'Emendation'); u = r2.text;
  r2 = addNote(u, 'divodāsaṃ', 'Custom kind.', 0, 'Parallel'); u = r2.text;
  r2 = addNote(u, 'pauṣkalāvata', 'Another plain note.', 0, 'Notes'); u = r2.text;
  writeFileSync(__dirname + '/out-types.xml', u);
  const order = [...u.matchAll(/<standOff corresp="#([^"]+)" type="([^"]+)"/g)].map(m => m[1] + ':' + m[2]);
  const want = ['SS.1.1.1:Emendation', 'SS.1.1.2:Notes', 'SS.1.1.2:Emendation', 'SS.1.1.2:Testimonia', 'SS.1.1.2:Parallel', 'SS.1.1.3:Notes'];
  check('one standOff per passage and type, in order', JSON.stringify(order) === JSON.stringify(want), JSON.stringify(order));
  let pu = parse(u);
  check('noteType', F.noteType(F.noteFor(pu, 'SS.1.1.2-n2')!) === 'Emendation');
  check('typesInDocument', JSON.stringify(F.typesInDocument(pu)) === JSON.stringify(['Emendation', 'Notes', 'Testimonia', 'Parallel']), JSON.stringify(F.typesInDocument(pu)));
  // move the testimonium (n1) to Notes: Testimonia standOff disappears
  const e1 = F.planRetype(u, pu, 'SS.1.1.2-n1', 'Notes', 'Now a plain note.', opts);
  u = F.applyEdits(u, [e1]);
  pu = parse(u);
  check('retype removes emptied standOff', !u.includes('type="Testimonia"'));
  const notesSo = F.standOffsFor(pu, undefined, 'SS.1.1.2', 'Notes')[0];
  const ts = notesSo.children.map(c => c.attrs.find(a => a.name === 'target')!.value);
  check('retyped note placed in order', JSON.stringify(ts) === JSON.stringify(['#SS.1.1.2-n1', '#SS.1.1.2-n3']), JSON.stringify(ts));
  check('retyped content', F.noteContent(u, F.noteFor(pu, 'SS.1.1.2-n1')!) === 'Now a plain note.');
  // move a note into a type that does not exist yet for that passage
  u = F.applyEdits(u, [F.planRetype(u, pu, 'SS.1.1.3-n1', 'Testimonia', 'Cited by Ḍalhaṇa.', opts)]);
  check('retype creates new standOff', /<standOff corresp="#SS.1.1.3" type="Testimonia">/.test(u) && !/corresp="#SS.1.1.3" type="Notes"/.test(u));
  writeFileSync(__dirname + '/out-types2.xml', u);
  check('no blank lines after retype', !/\n[ \t]*\n/.test(u.slice(u.indexOf('</text>'))));
}

// ---- anchor deletion detection ----
{
  let u = readFileSync(__dirname + '/sample.xml', 'utf8');
  u = addNote(u, 'ṛṣigaṇaparivṛtam', 'N1.').text;
  const tag = '<anchor xml:id="SS.1.1.2-n1"/>';
  const at = u.indexOf(tag);
  const old = G.snapshotAnchors(parse(u));
  const edit = (start: number, len: number, txt: string) => {
    const after = u.slice(0, start) + txt + u.slice(start + len);
    const ch = [{ rangeOffset: start, rangeLength: len, text: txt }];
    return { after, ch, p: parse(after) };
  };
  // whole tag selected and deleted
  let r = edit(at, tag.length, '');
  check('detect whole-tag delete', JSON.stringify(G.deletedAnchorIds(old, r.ch, r.p)) === '["SS.1.1.2-n1"]');
  // a larger selection containing the tag
  r = edit(at - 10, tag.length + 15, '');
  check('detect delete of wider selection', G.deletedAnchorIds(old, r.ch, r.p).length === 1);
  // editing the id value is not a deletion
  const idPos = u.indexOf('SS.1.1.2-n1', at);
  r = edit(idPos + 10, 1, '7');
  check('id edit not a deletion', G.deletedAnchorIds(old, r.ch, r.p).length === 0);
  // typing elsewhere does not touch anchors; offsets shift correctly
  const ch2 = [{ rangeOffset: 10, rangeLength: 0, text: 'abc' }];
  check('touchesAnchors false for unrelated typing', !G.touchesAnchors(old, ch2));
  const sh = G.shiftAnchors(old, ch2);
  check('shift offsets', sh[0].start === at + 3);
  // paste brings an anchor back
  check('inserted ids', JSON.stringify(G.insertedAnchorIds([{ rangeOffset: 0, rangeLength: 0, text: 'x ' + tag }])) === '["SS.1.1.2-n1"]');
  // a note removed after anchor deletion leaves valid, tidy XML
  const pd = parse(edit(at, tag.length, '').after);
  const t2 = F.applyEdits(edit(at, tag.length, '').after, [F.planNoteRemoval(edit(at, tag.length, '').after, pd, F.noteFor(pd, 'SS.1.1.2-n1')!)]);
  check('note and standOff removed', !t2.includes('SS.1.1.2-n1') && !t2.includes('<standOff'));
  check('back to original text', t2 === readFileSync(__dirname + '/sample.xml', 'utf8'));
}

// transliteration
const cases: [string, string][] = [
  ['athāto vedotpattim adhyāyaṃ vyākhyāsyāmaḥ', 'अथातो वेदोत्पत्तिम् अध्यायं व्याख्यास्यामः'],
  ['kṛṣṇa', 'कृष्ण'],
  ['dharmakṣetre kurukṣetre', 'धर्मक्षेत्रे कुरुक्षेत्रे'],
  ['praüga', 'प्रउग'],
  ['aindra', 'ऐन्द्र'],
  ["so 'ham", 'सो ऽहम्'],
  ['jñāna', 'ज्ञान'],
  ['śrīḥ ||1||', 'श्रीः ॥१॥'],
];
for (const [i, d] of cases) {
  check('IAST→Dev ' + i, T.iastToDevanagari(i) === d, T.iastToDevanagari(i));
  check('Dev→IAST ' + d, T.devanagariToIast(d) === i, T.devanagariToIast(d));
}
check('markup preserved', T.iastToDevanagari('<l n="1">rāma</l>') === '<l n="1">राम</l>');
check('HK', T.harvardKyotoToIast('kRSNa zrI rAmaH') === 'kṛṣṇa śrī rāmaḥ', T.harvardKyotoToIast('kRSNa zrI rAmaH'));
check('Velthuis', T.velthuisToIast('k.r.s.na "srii raama.h') === 'kṛṣṇa śrī rāmaḥ', T.velthuisToIast('k.r.s.na "srii raama.h'));
check('decomposed input', T.iastToDevanagari('rāma') === 'राम');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
