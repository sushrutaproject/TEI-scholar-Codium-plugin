import * as vscode from 'vscode';

export interface NoteState {
  uri: string;
  anchorId: string;
  isNew: boolean;      // anchor was just inserted by "Insert footnote"
  hasNote: boolean;    // a <note> already exists in the file
  content: string;
  type: string;        // @type of the standOff the note lives (or will live) in
  types: string[];     // choices offered in the pane
}

type FromView =
  | { type: 'ready' }
  | { type: 'save'; content: string; noteType: string }
  | { type: 'cancel' }
  | { type: 'delete' }
  | { type: 'goto' }
  | { type: 'dirty'; dirty: boolean };

export interface FootnoteHandlers {
  save(state: NoteState, content: string, type: string): Promise<boolean>;
  cancel(state: NoteState): Promise<void>;
  remove(state: NoteState): Promise<void>;
  goto(state: NoteState): Promise<void>;
}

export class FootnoteViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'teiScholar.footnoteView';
  private view?: vscode.WebviewView;
  private ready = false;
  private queued: unknown[] = [];
  state?: NoteState;
  dirty = false;

  constructor(private handlers: FootnoteHandlers) {}

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    this.ready = false;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html();
    view.webview.onDidReceiveMessage(async (m: FromView) => {
      switch (m.type) {
        case 'ready':
          this.ready = true;
          this.post({ type: 'font', ...fontSettings() });
          if (this.state) this.post(this.loadMessage(false));
          for (const q of this.queued.splice(0)) this.post(q);
          break;
        case 'dirty': this.dirty = m.dirty; break;
        case 'save':
          if (this.state && await this.handlers.save(this.state, m.content, m.noteType)) {
            const types = this.state.types.includes(m.noteType) ? this.state.types : [...this.state.types, m.noteType];
            this.state = { ...this.state, isNew: false, hasNote: true, content: m.content, type: m.noteType, types };
            this.dirty = false;
            this.post({ type: 'saved' });
            // like a word processor: after saving, carry on typing in the text
            await this.handlers.goto(this.state);
          }
          break;
        case 'cancel':
          if (this.state) await this.handlers.cancel(this.state);
          break;
        case 'delete':
          if (this.state) await this.handlers.remove(this.state);
          break;
        case 'goto':
          if (this.state) await this.handlers.goto(this.state);
          break;
      }
    });
    view.onDidDispose(() => { this.view = undefined; this.ready = false; });
  }

  async show(state: NoteState, focus: boolean) {
    this.state = state;
    this.dirty = false;
    if (!this.view || focus) {
      await vscode.commands.executeCommand(`${FootnoteViewProvider.viewId}.focus`);
    }
    this.post(this.loadMessage(focus));
  }

  clear(message?: string) {
    this.state = undefined;
    this.dirty = false;
    this.post({ type: 'clear', message });
  }

  refreshFont() { this.post({ type: 'font', ...fontSettings() }); }

  get visible() { return !!this.view?.visible; }

  private loadMessage(focus: boolean) {
    const s = this.state!;
    return { type: 'load', anchorId: s.anchorId, content: s.content, isNew: s.isNew, hasNote: s.hasNote, noteType: s.type, types: s.types, focus };
  }

  private post(msg: unknown) {
    if (this.view && this.ready) this.view.webview.postMessage(msg);
    else this.queued.push(msg);
  }

  private html(): string {
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    return /* html */ `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  body { margin: 0; padding: 6px 10px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; }
  header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
  #title { font-weight: 600; }
  #title a { color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: none; }
  #status { opacity: .75; font-size: 90%; }
  .spacer { flex: 1; }
  button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 3px 9px; border-radius: 2px; cursor: pointer; font-size: 12px; }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button:hover { filter: brightness(1.15); }
  button:disabled { opacity: .4; cursor: default; }
  .tags button { font-family: var(--vscode-editor-font-family); padding: 2px 6px; }
  textarea { flex: 1; min-height: 60px; width: 100%; box-sizing: border-box; resize: none; padding: 6px 8px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); outline: none; }
  textarea:focus { border-color: var(--vscode-focusBorder); }
  select, input.custom { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border, transparent); padding: 2px 4px; font-size: 12px; }
  input.custom { width: 9em; }
  #err { color: var(--vscode-errorForeground); font-size: 90%; min-height: 1.2em; margin-top: 4px; white-space: pre-wrap; }
  #empty { opacity: .7; padding: 12px 0; line-height: 1.5; }
  .hidden { display: none !important; }
  kbd { font-family: var(--vscode-editor-font-family); font-size: 90%; opacity: .8; }
</style></head>
<body>
<div id="empty">No footnote selected.<br>Put the cursor where the note belongs and run <b>TEI: Insert Footnote</b> (<kbd>Ctrl+Alt+N</kbd> / <kbd>⌘⌥N</kbd>), or click on an existing <code>&lt;anchor/&gt;</code>.</div>
<div id="editor" class="hidden" style="display:flex;flex-direction:column;flex:1;min-height:0">
  <header>
    <span id="title"></span>
    <label title="@type of the &lt;standOff&gt; this note goes into">type
      <select id="ntype"></select>
      <input id="ctype" class="custom hidden" placeholder="custom type" spellcheck="false">
    </label>
    <span id="status"></span>
    <span class="spacer"></span>
    <span class="tags">
      <button data-wrap="foreign" title="Wrap selection in &lt;foreign xml:lang=…&gt;">foreign</button>
      <button data-wrap="title" title="Wrap selection in &lt;title&gt;">title</button>
      <button data-wrap="hi" title="Wrap selection in &lt;hi rend=&quot;italic&quot;&gt;">hi</button>
      <button data-wrap="q" title="Wrap selection in &lt;q&gt;">q</button>
      <button data-wrap="ref" title="Wrap selection in &lt;ref target=&quot;&quot;&gt;">ref</button>
    </span>
    <button id="del" title="Remove the anchor and its note">Delete</button>
    <button id="cancel" title="Esc">Cancel</button>
    <button id="save" class="primary" title="Ctrl+Enter / ⌘Enter">Save</button>
  </header>
  <textarea id="text" spellcheck="true" placeholder="Type the note. Markup such as <foreign xml:lang=&quot;sa-Latn&quot;>…</foreign> is allowed."></textarea>
  <div id="err"></div>
</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  const ta = $('text');
  let original = '', originalType = '', current = null, foreignLang = 'sa-Latn';
  const sel = $('ntype'), ctype = $('ctype');
  const CUSTOM = '__custom__';
  function chosenType() { return sel.value === CUSTOM ? ctype.value.trim() : sel.value; }
  function fillTypes(types, chosen) {
    sel.innerHTML = '';
    for (const t of types) { const o = document.createElement('option'); o.value = o.textContent = t; sel.append(o); }
    const c = document.createElement('option'); c.value = CUSTOM; c.textContent = 'Custom…'; sel.append(c);
    sel.value = chosen; ctype.classList.add('hidden'); ctype.value = '';
  }
  sel.addEventListener('change', () => {
    const custom = sel.value === CUSTOM;
    ctype.classList.toggle('hidden', !custom);
    if (custom) ctype.focus();
    setDirty();
  });
  ctype.addEventListener('input', setDirty);
  ctype.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); ta.focus(); } });

  function setDirty() {
    const d = current && (ta.value !== original || chosenType() !== originalType);
    $('status').textContent = current ? (current.isNew && !current.hasNote ? '· new' : d ? '· modified' : '') : '';
    vscode.postMessage({ type: 'dirty', dirty: !!d });
  }

  function check(text) {
    // a bare & is never valid XML, so always escape it for the user
    text = text.replace(/&(?![A-Za-z_][\\w.-]*;|#\\d+;|#x[0-9A-Fa-f]+;)/g, '&amp;');
    if (!text.includes('<')) return { ok: true, text };
    const doc = new DOMParser().parseFromString('<note xmlns="http://www.tei-c.org/ns/1.0">' + text + '</note>', 'application/xml');
    const pe = doc.getElementsByTagName('parsererror')[0];
    if (pe) {
      const detail = (pe.textContent || '').replace(/This page contains the following errors:/, '').replace(/Below is a rendering[\\s\\S]*/, '').trim();
      return { ok: false, msg: 'Not well-formed XML (check that every tag is closed): ' + detail };
    }
    return { ok: true, text };
  }

  function save() {
    if (!current) return;
    const nt = chosenType();
    if (!nt) { $('err').textContent = 'Type a custom @type value (or pick one from the list).'; ctype.focus(); return; }
    if (/[\\s"<>&]/.test(nt)) { $('err').textContent = 'A @type value cannot contain spaces, quotes, <, > or &.'; ctype.focus(); return; }
    const r = check(ta.value.trim());
    if (!r.ok) { $('err').textContent = r.msg; return; }
    if (!r.text) { $('err').textContent = 'The note is empty. Use Delete to remove the footnote.'; return; }
    $('err').textContent = '';
    ta.value = r.text;
    vscode.postMessage({ type: 'save', content: r.text, noteType: nt });
  }

  function wrap(tag) {
    const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e);
    const open = tag === 'foreign' ? '<foreign xml:lang="' + foreignLang + '">'
      : tag === 'hi' ? '<hi rend="italic">' : tag === 'ref' ? '<ref target="">' : '<' + tag + '>';
    const close = '</' + tag + '>';
    ta.setRangeText(open + sel + close, s, e, 'end');
    if (!sel) ta.selectionStart = ta.selectionEnd = s + open.length;
    if (tag === 'ref' && sel) ta.selectionStart = ta.selectionEnd = s + open.length - 2;
    ta.focus(); setDirty();
  }

  document.querySelectorAll('[data-wrap]').forEach(b => b.addEventListener('click', () => wrap(b.dataset.wrap)));
  $('save').onclick = save;
  $('cancel').onclick = () => { ta.value = original; if (current) fillTypes(current.types, originalType); setDirty(); $('err').textContent = ''; vscode.postMessage({ type: 'cancel' }); };
  $('del').onclick = () => vscode.postMessage({ type: 'delete' });
  ta.addEventListener('input', setDirty);
  ta.addEventListener('keydown', ev => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); save(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); $('cancel').click(); }
  });

  window.addEventListener('message', ({ data: m }) => {
    if (m.type === 'font') {
      ta.style.fontFamily = m.fontFamily; ta.style.fontSize = m.fontSize + 'px'; ta.style.lineHeight = m.lineHeight;
      foreignLang = m.foreignLang || foreignLang;
    } else if (m.type === 'load') {
      current = m; original = m.content; ta.value = m.content;
      originalType = m.noteType; fillTypes(m.types, m.noteType);
      $('empty').classList.add('hidden'); $('editor').classList.remove('hidden');
      $('title').innerHTML = '';
      const a = document.createElement('a'); a.textContent = m.anchorId; a.title = 'Go to the anchor in the text';
      a.onclick = () => vscode.postMessage({ type: 'goto' });
      $('title').append('Footnote ', a);
      $('del').disabled = false; $('err').textContent = '';
      setDirty();
      if (m.focus) { ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; }
    } else if (m.type === 'saved') {
      const nt = chosenType();
      if (!current.types.includes(nt)) current.types.push(nt);
      original = ta.value; originalType = nt; fillTypes(current.types, nt);
      current.isNew = false; current.hasNote = true; setDirty();
      $('status').textContent = '· saved';
    } else if (m.type === 'clear') {
      current = null; original = ''; ta.value = '';
      $('editor').classList.add('hidden'); $('empty').classList.remove('hidden');
      if (m.message) $('empty').textContent = m.message;
    } else if (m.type === 'error') {
      $('err').textContent = m.message;
    }
  });
  vscode.postMessage({ type: 'ready' });
</script>
</body></html>`;
  }

  postError(message: string) { this.post({ type: 'error', message }); }
}

export function fontSettings() {
  const ed = vscode.workspace.getConfiguration('editor', { languageId: 'xml' });
  const cfg = vscode.workspace.getConfiguration('teiScholar.footnotes');
  const fontFamily = cfg.get<string>('fontFamily') || ed.get<string>('fontFamily') || 'serif';
  const fontSize = cfg.get<number>('fontSize') || ed.get<number>('fontSize') || 15;
  const lh = ed.get<number>('lineHeight') || 0;
  const lineHeight = lh > 0 && lh < 8 ? String(lh) : lh >= 8 ? lh + 'px' : '1.5';
  const foreignLang = cfg.get<string>('foreignLang') || 'sa-Latn';
  return { fontFamily, fontSize, lineHeight, foreignLang };
}
