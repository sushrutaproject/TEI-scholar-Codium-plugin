// Transliteration helpers for Sanskrit: IAST <-> Devanagari, and
// Harvard-Kyoto / Velthuis -> IAST. XML markup and entity references in
// the input are passed through untouched.

const VIRAMA = '्';

const CONS: Record<string, string> = {
  k: 'क', kh: 'ख', g: 'ग', gh: 'घ', 'ṅ': 'ङ',
  c: 'च', ch: 'छ', j: 'ज', jh: 'झ', 'ñ': 'ञ',
  'ṭ': 'ट', 'ṭh': 'ठ', 'ḍ': 'ड', 'ḍh': 'ढ', 'ṇ': 'ण',
  t: 'त', th: 'थ', d: 'द', dh: 'ध', n: 'न',
  p: 'प', ph: 'फ', b: 'ब', bh: 'भ', m: 'म',
  y: 'य', r: 'र', l: 'ल', v: 'व', 'ḻ': 'ळ', 'ḻh': 'ळ्ह',
  'ś': 'श', 'ṣ': 'ष', s: 'स', h: 'ह',
};

// vowel: [independent, sign]
const VOW: Record<string, [string, string]> = {
  a: ['अ', ''], 'ā': ['आ', 'ा'], i: ['इ', 'ि'], 'ī': ['ई', 'ी'],
  u: ['उ', 'ु'], 'ū': ['ऊ', 'ू'], 'ṛ': ['ऋ', 'ृ'], 'ṝ': ['ॠ', 'ॄ'],
  'ḷ': ['ऌ', 'ॢ'], 'ḹ': ['ॡ', 'ॣ'], e: ['ए', 'े'], ai: ['ऐ', 'ै'],
  o: ['ओ', 'ो'], au: ['औ', 'ौ'],
  'ï': ['इ', 'ि'], 'ü': ['उ', 'ु'], // diaeresis marks hiatus: aï, aü
};

const OTHER: Record<string, string> = {
  'ṃ': 'ं', 'ṁ': 'ं', 'm̐': 'ँ', 'ḥ': 'ः', 'ẖ': 'ᳵ', 'ḫ': 'ᳶ',
  "'": 'ऽ', '’': 'ऽ', '||': '॥', '|': '।',
  '0': '०', '1': '१', '2': '२', '3': '३', '4': '४',
  '5': '५', '6': '६', '7': '७', '8': '८', '9': '९',
};

function keysByLength(...objs: Record<string, unknown>[]): string[] {
  const s = new Set<string>();
  for (const o of objs) for (const k of Object.keys(o)) s.add(k);
  return [...s].sort((a, b) => b.length - a.length);
}
const IAST_KEYS = keysByLength(CONS, VOW, OTHER);

/** Split text into runs of markup (kept as-is) and plain text (converted). */
function mapText(input: string, f: (s: string) => string): string {
  return input.replace(/(<[^>]*>|&[#\w.-]+;)|([^<&]+|[<&])/g, (_m, markup, plain) => markup ?? f(plain));
}

export function iastToDevanagari(input: string): string {
  return mapText(input, s => iastPlainToDev(s.normalize('NFC')));
}

function iastPlainToDev(src: string): string {
  let out = '';
  let pendingConsonant = false; // last emitted is a bare consonant (needs vowel or virama)
  let i = 0;
  const lower = src.toLowerCase();
  while (i < src.length) {
    let tok = '';
    for (const k of IAST_KEYS) if (lower.startsWith(k, i)) { tok = k; break; }
    // 'ai'/'au' only when not written with diaeresis (handled by key order)
    if (tok && tok in CONS) {
      if (pendingConsonant) out += VIRAMA;
      out += CONS[tok];
      pendingConsonant = true;
      i += tok.length;
      continue;
    }
    if (tok && tok in VOW) {
      const [ind, sign] = VOW[tok];
      out += pendingConsonant ? sign : ind;
      pendingConsonant = false;
      i += tok.length;
      continue;
    }
    if (pendingConsonant) { out += VIRAMA; pendingConsonant = false; }
    if (tok) { out += OTHER[tok]; i += tok.length; continue; }
    out += src[i++];
  }
  if (pendingConsonant) out += VIRAMA;
  return out;
}

// ---------- Devanagari -> IAST ----------

const D_CONS: Record<string, string> = {};
for (const [k, v] of Object.entries(CONS)) if (v.length === 1) D_CONS[v] = k;
const D_IND: Record<string, string> = {};
const D_SIGN: Record<string, string> = {};
for (const [k, [ind, sign]] of Object.entries(VOW)) {
  if (k === 'ï' || k === 'ü') continue;
  D_IND[ind] = k;
  if (sign) D_SIGN[sign] = k;
}
const D_OTHER: Record<string, string> = {
  'ं': 'ṃ', 'ँ': 'm̐', 'ः': 'ḥ', 'ऽ': "'", '।': '|', '॥': '||', 'ॐ': 'oṃ',
  'ᳵ': 'ẖ', 'ᳶ': 'ḫ',
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
};

export function devanagariToIast(input: string, avagraha = "'"): string {
  return mapText(input, s => devPlainToIast(s.normalize('NFC'), avagraha));
}

function devPlainToIast(src: string, avagraha: string): string {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c in D_CONS) {
      out += D_CONS[c];
      const nx = src[i + 1];
      if (nx === VIRAMA) i++;
      else if (nx && nx in D_SIGN) { out += D_SIGN[nx]; i++; }
      else out += 'a';
      continue;
    }
    if (c in D_IND) {
      let v = D_IND[c];
      // hiatus after an a: keep it distinct from ai / au
      if (out.endsWith('a') && (v === 'i' || v === 'u')) v = v === 'i' ? 'ï' : 'ü';
      out += v;
      continue;
    }
    if (c in D_OTHER) {
      out += c === 'ऽ' ? avagraha : D_OTHER[c];
      continue;
    }
    out += c;
  }
  return out;
}

// ---------- ASCII schemes -> IAST ----------

function makeConverter(table: [string, string][]): (s: string) => string {
  const sorted = [...table].sort((a, b) => b[0].length - a[0].length);
  return (input: string) => mapText(input, src => {
    let out = '';
    let i = 0;
    outer: while (i < src.length) {
      for (const [from, to] of sorted) {
        if (src.startsWith(from, i)) { out += to; i += from.length; continue outer; }
      }
      out += src[i++];
    }
    return out;
  });
}

export const harvardKyotoToIast = makeConverter([
  ['A', 'ā'], ['I', 'ī'], ['U', 'ū'], ['RR', 'ṝ'], ['R', 'ṛ'], ['lRR', 'ḹ'], ['lR', 'ḷ'],
  ['M', 'ṃ'], ['H', 'ḥ'], ['G', 'ṅ'], ['J', 'ñ'], ['T', 'ṭ'], ['D', 'ḍ'], ['N', 'ṇ'],
  ['z', 'ś'], ['S', 'ṣ'], ['L', 'ḻ'],
]);

export const velthuisToIast = makeConverter([
  ['aa', 'ā'], ['ii', 'ī'], ['uu', 'ū'], ['.rr', 'ṝ'], ['.r', 'ṛ'], ['.ll', 'ḹ'], ['.l', 'ḷ'],
  ['.m', 'ṃ'], ['.h', 'ḥ'], ['"n', 'ṅ'], ['~n', 'ñ'], ['.t', 'ṭ'], ['.d', 'ḍ'], ['.n', 'ṇ'],
  ['"s', 'ś'], ['.s', 'ṣ'], ['.a', "'"],
  ['AA', 'Ā'], ['Aa', 'Ā'], ['II', 'Ī'], ['Ii', 'Ī'], ['UU', 'Ū'], ['Uu', 'Ū'],
  ['.R', 'Ṛ'], ['.T', 'Ṭ'], ['.D', 'Ḍ'], ['.N', 'Ṇ'], ['"S', 'Ś'], ['.S', 'Ṣ'],
]);
