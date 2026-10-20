import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { parse, Parsed, whereAt, ancestors, localName, attr, isTeiDocument, Elem, elementAt as elementAtOffset } from './xmlscan';
import * as F from './footnotes';
import { TeiHelp, HelpData, refUrl } from './help';
import { FootnoteViewProvider, NoteState } from './footnoteView';
import * as T from './translit';
import * as G from './anchorGuard';

const TEI_ALL_URL = 'https://www.tei-c.org/release/xml/tei/custom/schema/relaxng/tei_all.rng';

// ---------- parse cache ----------
const cache = new Map<string, { version: number; parsed: Parsed }>();
function parsedOf(doc: vscode.TextDocument): Parsed {
  const key = doc.uri.toString();
  const c = cache.get(key);
  if (c && c.version === doc.version) return c.parsed;
  const parsed = parse(doc.getText());
  cache.set(key, { version: doc.version, parsed });
  return parsed;
}
const isTei = (doc: vscode.TextDocument) => doc.languageId === 'xml' && isTeiDocument(doc.getText());
const cfg = () => vscode.workspace.getConfiguration('teiScholar');

function noteOptionsFor(doc: vscode.TextDocument): F.NoteOptions {
  const ed = vscode.window.visibleTextEditors.find(e => e.document === doc);
  if (ed) return noteOptions(ed);
  const ec = vscode.workspace.getConfiguration('editor', doc);
  const fake = { options: { insertSpaces: ec.get<boolean>('insertSpaces', true), tabSize: ec.get<number>('tabSize', 4) }, document: doc };
  return noteOptions(fake as unknown as vscode.TextEditor);
}

function noteOptions(editor: vscode.TextEditor): F.NoteOptions {
  const c = cfg();
  const tab = editor.options.insertSpaces === false ? '\t' : ' '.repeat(Number(editor.options.tabSize) || 4);
  return {
    noteLang: c.get<string>('footnotes.noteLang') || 'en',
    standOffTypes: configuredTypes(),
    contextElements: c.get<string[]>('footnotes.contextElements') || [],
    indentUnit: c.get<string>('footnotes.indent') || tab,
    eol: editor.document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n',
  };
}

function configuredTypes(): string[] {
  const t = (cfg().get<string[]>('footnotes.standOffTypes') || []).map(x => x.trim()).filter(Boolean);
  return t.length ? t : ['Notes'];
}

async function applyEdits(doc: vscode.TextDocument, edits: F.TextEdit[]): Promise<boolean> {
  const we = new vscode.WorkspaceEdit();
  for (const e of edits) we.replace(doc.uri, new vscode.Range(doc.positionAt(e.start), doc.positionAt(e.end)), e.text);
  return vscode.workspace.applyEdit(we);
}

function findDoc(uri: string) {
  return vscode.workspace.textDocuments.find(d => d.uri.toString() === uri);
}

function editorFor(uri: string) {
  return vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri);
}

// ---------- activation ----------
export function activate(ctx: vscode.ExtensionContext) {
  const help = new TeiHelp(JSON.parse(fs.readFileSync(path.join(ctx.extensionPath, 'data', 'tei-help.json'), 'utf8')) as HelpData);
  registerCatalog(ctx);

  // ----- footnote pane -----
  const view = new FootnoteViewProvider({
    save: async (s, content, type) => {
      const doc = findDoc(s.uri);
      if (!doc) { vscode.window.showErrorMessage('The XML file for this note is no longer open.'); return false; }
      const p = parsedOf(doc);
      const text = doc.getText();
      const anchor = p.ids.get(s.anchorId)?.find(e => localName(e.name) === 'anchor');
      if (!anchor) { view.postError(`The anchor ${s.anchorId} is no longer in the text.`); return false; }
      if (!/^[^\s"<>&]+$/.test(type)) { view.postError(`"${type}" cannot be used as @type: no spaces, quotes, <, > or &.`); return false; }
      await ctx.workspaceState.update('lastNoteType', type);
      const existing = F.noteFor(p, s.anchorId);
      const ed = editorFor(s.uri) ?? vscode.window.activeTextEditor!;
      try {
        if (existing) {
          if ((F.noteType(existing) ?? type) === type) {
            return applyEdits(doc, [{ start: existing.startTagEnd, end: existing.endTagStart, text: content }]);
          }
          return applyEdits(doc, [F.planRetype(text, p, s.anchorId, type, content, noteOptions(ed))]);
        }
        const ctxId = F.contextIdOfAnchor(s.anchorId);
        const ctxEl = ctxId ? p.ids.get(ctxId)?.[0] : undefined;
        if (!ctxId || !ctxEl) { view.postError(`Cannot find the element with xml:id="${ctxId}".`); return false; }
        return applyEdits(doc, [F.planNoteInsertion(text, p, ctxEl, ctxId, s.anchorId, content, noteOptions(ed), type)]);
      } catch (e) { view.postError(String((e as Error).message)); return false; }
    },
    cancel: async s => {
      if (s.isNew && !s.hasNote) {
        const doc = findDoc(s.uri);
        if (doc) {
          const p = parsedOf(doc);
          const a = p.ids.get(s.anchorId)?.find(e => localName(e.name) === 'anchor');
          if (a && !F.noteFor(p, s.anchorId)) await applyEdits(doc, [{ start: a.start, end: a.end, text: '' }]);
        }
        view.clear();
      }
      await focusEditor(s.uri);
    },
    remove: async s => {
      const doc = findDoc(s.uri);
      if (!doc) return;
      const p = parsedOf(doc);
      const a = p.ids.get(s.anchorId)?.find(e => localName(e.name) === 'anchor');
      const pick = s.hasNote
        ? await vscode.window.showWarningMessage(`Delete footnote ${s.anchorId} (anchor and note)?`, { modal: true }, 'Delete')
        : 'Delete';
      if (pick !== 'Delete') return;
      if (a) await applyEdits(doc, F.planDeletion(doc.getText(), p, a));
      view.clear();
      await focusEditor(s.uri);
    },
    goto: async s => {
      const doc = findDoc(s.uri);
      if (!doc) return;
      const a = parsedOf(doc).ids.get(s.anchorId)?.[0];
      const ed = await vscode.window.showTextDocument(doc, { preserveFocus: false });
      if (a) {
        const pos = doc.positionAt(a.end);
        ed.selection = new vscode.Selection(pos, pos);
        ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      }
    },
  });
  ctx.subscriptions.push(vscode.window.registerWebviewViewProvider(FootnoteViewProvider.viewId, view, {
    webviewOptions: { retainContextWhenHidden: true },
  }));

  async function focusEditor(uri: string) {
    const doc = findDoc(uri);
    if (doc) await vscode.window.showTextDocument(doc, { preserveFocus: false });
  }

  function openNote(doc: vscode.TextDocument, anchor: Elem, focus: boolean, isNew = false) {
    const p = parsedOf(doc);
    const id = attr(anchor, 'xml:id')!;
    const note = F.noteFor(p, id);
    const known = configuredTypes();
    const last = ctx.workspaceState.get<string>('lastNoteType');
    const type = (note && F.noteType(note)) || last || known[0];
    const types = [...new Set([...known, ...F.typesInDocument(p), type])];
    const st: NoteState = {
      uri: doc.uri.toString(), anchorId: id, isNew, hasNote: !!note,
      content: note ? F.noteContent(doc.getText(), note) : '', type, types,
    };
    return view.show(st, focus);
  }

  // ----- commands -----
  const cmd = (id: string, fn: (...a: any[]) => any) => ctx.subscriptions.push(vscode.commands.registerCommand(id, fn));

  cmd('teiScholar.insertFootnote', async () => {
    const ed = vscode.window.activeTextEditor;
    if (!ed || ed.document.languageId !== 'xml') return;
    const doc = ed.document;
    if (view.dirty && view.state) {
      const go = await vscode.window.showWarningMessage(`Footnote ${view.state.anchorId} has unsaved changes.`, 'Discard and continue');
      if (!go) return;
    }
    const p = parsedOf(doc);
    const pos = ed.selection.active;
    const c = F.findContext(p, doc.offsetAt(pos), noteOptions(ed));
    if ('error' in c) { vscode.window.showWarningMessage('TEI footnote: ' + c.error); return; }
    const anchorId = `${c.id}-n${F.maxNoteNumber(p, c.id) + 1}`;
    const ok = await ed.edit(b => b.insert(pos, F.anchorXml(anchorId)));
    if (!ok) return;
    const after = doc.positionAt(doc.offsetAt(pos) + F.anchorXml(anchorId).length);
    ed.selection = new vscode.Selection(after, after);
    const anchor = parsedOf(doc).ids.get(anchorId)![0];
    await openNote(doc, anchor, true, true);
  });

  cmd('teiScholar.editFootnote', async () => {
    const ed = vscode.window.activeTextEditor;
    if (!ed) return;
    const a = F.anchorAt(parsedOf(ed.document), ed.document.offsetAt(ed.selection.active));
    if (!a) { vscode.window.showInformationMessage('Put the cursor on a footnote <anchor/> (or inside its <note>).'); return; }
    await openNote(ed.document, a, true);
  });

  cmd('teiScholar.deleteFootnote', async () => {
    const ed = vscode.window.activeTextEditor;
    if (!ed) return;
    const p = parsedOf(ed.document);
    const a = F.anchorAt(p, ed.document.offsetAt(ed.selection.active));
    if (!a) { vscode.window.showInformationMessage('Put the cursor on a footnote <anchor/>.'); return; }
    const id = attr(a, 'xml:id')!;
    const pick = await vscode.window.showWarningMessage(`Delete footnote ${id} (anchor and note)?`, { modal: true }, 'Delete');
    if (pick !== 'Delete') return;
    await applyEdits(ed.document, F.planDeletion(ed.document.getText(), p, a));
    if (view.state?.anchorId === id) view.clear();
  });

  cmd('teiScholar.renumberFootnotes', async () => {
    const ed = vscode.window.activeTextEditor;
    if (!ed) return;
    const { edits, changed } = F.planRenumber(ed.document.getText(), parsedOf(ed.document));
    if (!changed) { vscode.window.showInformationMessage('Footnote numbers are already in reading order.'); return; }
    const pick = await vscode.window.showWarningMessage(
      `Renumber ${changed} footnote id(s) so each passage's notes run n1, n2, … in reading order? Note targets are updated too; references to these ids from other files are not.`,
      { modal: true }, 'Renumber');
    if (pick === 'Renumber') await applyEdits(ed.document, edits);
  });

  cmd('teiScholar.nextFootnote', () => jumpFootnote(1));
  cmd('teiScholar.previousFootnote', () => jumpFootnote(-1));
  function jumpFootnote(dir: 1 | -1) {
    const ed = vscode.window.activeTextEditor;
    if (!ed) return;
    const anchors = F.footnoteAnchors(parsedOf(ed.document));
    const off = ed.document.offsetAt(ed.selection.active);
    const target = dir > 0 ? anchors.find(a => a.start > off) : [...anchors].reverse().find(a => a.end < off);
    if (!target) return;
    const pos = ed.document.positionAt(target.end);
    ed.selection = new vscode.Selection(pos, pos);
    ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  cmd('teiScholar.openDocs', async () => {
    const ed = vscode.window.activeTextEditor;
    if (!ed) return;
    const w = whereAt(parsedOf(ed.document), ed.document.offsetAt(ed.selection.active));
    let ident: string | undefined;
    if (w.kind === 'attrName' || w.kind === 'attrValue') {
      const a = help.attributes(localName(w.el.name)).get(w.attr.name);
      ident = a ? a.origin : localName(w.el.name);
    } else if ('el' in w && w.el) ident = localName(w.el.name);
    if (!ident || !(help.element(ident) || help.data.attClasses[ident])) {
      const name = await vscode.window.showQuickPick(Object.keys(help.data.elements).sort(), { placeHolder: 'TEI element' });
      if (!name) return;
      ident = name;
    }
    vscode.env.openExternal(vscode.Uri.parse(refUrl(ident)));
  });

  cmd('teiScholar.addSchema', async () => {
    const ed = vscode.window.activeTextEditor;
    if (!ed) return;
    await addSchemaDeclaration(ed.document);
  });

  cmd('teiScholar.chooseFont', () => chooseFont(view));

  const conv = (fn: (s: string) => string) => async () => {
    const ed = vscode.window.activeTextEditor;
    if (!ed) return;
    if (ed.selections.every(s => s.isEmpty)) { vscode.window.showInformationMessage('Select the text to convert first.'); return; }
    await ed.edit(b => { for (const s of ed.selections) if (!s.isEmpty) b.replace(s, fn(ed.document.getText(s))); });
  };
  cmd('teiScholar.iastToDevanagari', conv(T.iastToDevanagari));
  cmd('teiScholar.devanagariToIast', conv(s => T.devanagariToIast(s, cfg().get<string>('translit.avagraha') || "'")));
  cmd('teiScholar.hkToIast', conv(T.harvardKyotoToIast));
  cmd('teiScholar.velthuisToIast', conv(T.velthuisToIast));

  // ----- follow the cursor: show the note of the anchor under it -----
  let followTimer: NodeJS.Timeout | undefined;
  ctx.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(e => {
    if (!cfg().get<boolean>('footnotes.followCursor', true)) return;
    if (e.textEditor.document.languageId !== 'xml') return;
    clearTimeout(followTimer);
    followTimer = setTimeout(() => {
      if (view.dirty) return;
      const doc = e.textEditor.document;
      const a = F.anchorAt(parsedOf(doc), doc.offsetAt(e.selections[0].active));
      if (!a) return;
      const id = attr(a, 'xml:id')!;
      if (view.state?.anchorId === id && view.state.uri === doc.uri.toString()) return;
      if (!F.noteFor(parsedOf(doc), id) && !/-n\d+$/.test(id)) return;
      if (view.visible || cfg().get<boolean>('footnotes.revealOnAnchor', false)) openNote(doc, a, false);
    }, 200);
  }));

  // ----- hovers -----
  ctx.subscriptions.push(vscode.languages.registerHoverProvider({ language: 'xml' }, {
    provideHover(doc, pos) {
      if (!isTei(doc)) return;
      const p = parsedOf(doc);
      const off = doc.offsetAt(pos);
      const w = whereAt(p, off);
      const maxList = cfg().get<number>('help.maxListLength', 30);
      let md: string | undefined;
      let range: vscode.Range | undefined;
      const onAnchor = 'el' in w && w.el && localName(w.el.name) === 'anchor' && w.kind !== 'content' ? w.el : undefined;
      const inNote = !onAnchor ? noteAround(p, off) : undefined;
      if (onAnchor) {
        md = noteHover(doc, p, onAnchor);
        const more = help.elementMarkdown('anchor', { maxList: 0 });
        if (md && more && w.kind === 'elementName') md += '\n\n---\n\n' + more;
      } else if (inNote && cfg().get<boolean>('help.hoverOnText', true) && w.kind === 'content') {
        md = backHover(doc, inNote.anchorId);
      } else if (w.kind === 'elementName') {
        const ln = localName(w.el.name);
        md = help.elementMarkdown(ln, { maxList });
        if (inNote && ln === 'note') md = backHover(doc, inNote.anchorId) + (md ? '\n\n---\n\n' + md : '');
      } else if (w.kind === 'attrName' || w.kind === 'attrValue') {
        const ln = localName(w.el.name);
        md = help.attributeMarkdown(ln, w.attr.name, w.attr.value);
        if (w.kind === 'attrValue') {
          const ref = pointerTarget(p, w.attr.value, off - w.attr.valueStart);
          if (ref) md = `→ \`<${ref.name}${attr(ref, 'n') ? ` n="${attr(ref, 'n')}"` : ''}>\`: ${snippet(doc.getText(), ref)}\n\n---\n\n` + (md ?? '');
        }
        range = new vscode.Range(doc.positionAt(w.attr.nameStart), doc.positionAt(w.attr.valueEnd + 1));
      } else if (w.kind === 'content' && w.el && cfg().get<boolean>('help.hoverOnText', true)) {
        const path = ancestors(w.el).reverse().map(e => localName(e.name));
        md = help.pathMarkdown(path);
      }
      if (!md) return;
      const m = new vscode.MarkdownString(md);
      // only our own footnote commands may be run from hover links
      m.isTrusted = { enabledCommands: ['teiScholar.editFootnoteById', 'teiScholar.gotoNote', 'teiScholar.gotoAnchor'] };
      m.supportThemeIcons = true;
      return new vscode.Hover(m, range);
    },
  }));

  const link = (title: string, command: string, args: unknown[], tip: string) =>
    `[${title}](command:${command}?${encodeURIComponent(JSON.stringify(args))} "${tip}")`;

  function noteHover(doc: vscode.TextDocument, p: Parsed, anchor: Elem): string | undefined {
    const id = attr(anchor, 'xml:id');
    if (!id) return;
    const uri = doc.uri.toString();
    const note = F.noteFor(p, id);
    const edit = link('$(edit) Edit', 'teiScholar.editFootnoteById', [uri, id], 'Edit this note in the Footnote pane (Ctrl+Alt+E)');
    if (!note) return `**Footnote ${id}** — *no note yet*\n\n${edit}`;
    const body = F.noteContent(doc.getText(), note).replace(/\s+/g, ' ').trim();
    const t = F.noteType(note);
    const go = link('$(arrow-down) Go to note', 'teiScholar.gotoNote', [uri, id], 'Jump to the <note> in the standOff (Ctrl+Alt+J); Ctrl+Alt+J again brings you back');
    return `**Footnote ${id}**${t ? ` · *${t}*` : ''}\n\n${escapeMd(body)}\n\n${edit} &nbsp;&nbsp; ${go}`;
  }

  function backHover(doc: vscode.TextDocument, anchorId: string): string {
    const uri = doc.uri.toString();
    const back = link('$(arrow-up) Back to text', 'teiScholar.gotoAnchor', [uri, anchorId], 'Return to the anchor in the text (Ctrl+Alt+J)');
    const edit = link('$(edit) Edit in pane', 'teiScholar.editFootnoteById', [uri, anchorId], 'Edit this note in the Footnote pane');
    return `**Note for ${anchorId}**\n\n${back} &nbsp;&nbsp; ${edit}`;
  }

  /** The note (in a standOff or elsewhere) that contains this offset. */
  function noteAround(p: Parsed, off: number): { note: Elem; anchorId: string } | undefined {
    for (let e = elementAtOffset(p, off); e; e = e.parent) {
      if (localName(e.name) !== 'note') continue;
      const t = (attr(e, 'target') || '').split(/\s+/)[0].replace(/^#/, '');
      if (t && p.ids.get(t)?.some(x => localName(x.name) === 'anchor')) return { note: e, anchorId: t };
    }
    return undefined;
  }

  // ----- jumping between anchor and note -----
  async function reveal(doc: vscode.TextDocument, offset: number) {
    const ed = await vscode.window.showTextDocument(doc, { preserveFocus: false });
    const pos = doc.positionAt(offset);
    ed.selection = new vscode.Selection(pos, pos);
    ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }
  const docFor = async (uri?: string) => uri ? (findDoc(uri) ?? await vscode.workspace.openTextDocument(vscode.Uri.parse(uri))) : vscode.window.activeTextEditor?.document;

  cmd('teiScholar.gotoNote', async (uri?: string, id?: string) => {
    const doc = await docFor(uri);
    if (!doc) return;
    const p = parsedOf(doc);
    if (!id) {
      const a = F.anchorAt(p, doc.offsetAt(vscode.window.activeTextEditor!.selection.active));
      id = a ? attr(a, 'xml:id') : undefined;
    }
    const note = id ? F.noteFor(p, id) : undefined;
    if (!note) { vscode.window.showInformationMessage(id ? `Footnote ${id} has no note yet.` : 'Put the cursor on a footnote anchor.'); return; }
    await reveal(doc, note.startTagEnd);
  });

  cmd('teiScholar.gotoAnchor', async (uri?: string, id?: string) => {
    const doc = await docFor(uri);
    if (!doc) return;
    const p = parsedOf(doc);
    if (!id) id = noteAround(p, doc.offsetAt(vscode.window.activeTextEditor!.selection.active))?.anchorId;
    const a = id ? p.ids.get(id)?.find(x => localName(x.name) === 'anchor') : undefined;
    if (!a) { vscode.window.showInformationMessage('Put the cursor inside a footnote <note>.'); return; }
    await reveal(doc, a.end); // cursor just after the anchor, ready to carry on typing
  });

  // one key for both directions
  cmd('teiScholar.toggleAnchorNote', async () => {
    const ed = vscode.window.activeTextEditor;
    if (!ed) return;
    const p = parsedOf(ed.document);
    const off = ed.document.offsetAt(ed.selection.active);
    if (noteAround(p, off)) return vscode.commands.executeCommand('teiScholar.gotoAnchor');
    if (F.anchorAt(p, off)) return vscode.commands.executeCommand('teiScholar.gotoNote');
    vscode.window.showInformationMessage('Put the cursor on a footnote anchor or inside its note.');
  });

  cmd('teiScholar.editFootnoteById', async (uri?: string, id?: string) => {
    const doc = await docFor(uri);
    if (!doc || !id) return;
    const a = parsedOf(doc).ids.get(id)?.find(x => localName(x.name) === 'anchor');
    if (a) await openNote(doc, a, true);
  });

  // "↑ back to text" above every footnote note in the standOff area
  ctx.subscriptions.push(vscode.languages.registerCodeLensProvider({ language: 'xml' }, {
    provideCodeLenses(doc) {
      if (!cfg().get<boolean>('footnotes.backLinks', true) || !isTei(doc)) return [];
      const p = parsedOf(doc);
      const lenses: vscode.CodeLens[] = [];
      for (const el of p.all) {
        if (localName(el.name) !== 'note' || !el.parent || localName(el.parent.name) !== 'standOff') continue;
        const id = (attr(el, 'target') || '').split(/\s+/)[0].replace(/^#/, '');
        const a = p.ids.get(id)?.find(x => localName(x.name) === 'anchor');
        if (!a) continue;
        const r = new vscode.Range(doc.positionAt(el.start), doc.positionAt(el.start));
        const line = doc.positionAt(a.start).line + 1;
        lenses.push(new vscode.CodeLens(r, { title: `↑ back to text (line ${line})`, command: 'teiScholar.gotoAnchor', arguments: [doc.uri.toString(), id] }));
        lenses.push(new vscode.CodeLens(r, { title: 'edit in pane', command: 'teiScholar.editFootnoteById', arguments: [doc.uri.toString(), id] }));
      }
      return lenses;
    },
  }));

  // ----- go to definition for #pointers and anchors -----
  ctx.subscriptions.push(vscode.languages.registerDefinitionProvider({ language: 'xml' }, {
    provideDefinition(doc, pos) {
      const p = parsedOf(doc);
      const off = doc.offsetAt(pos);
      const w = whereAt(p, off);
      if (w.kind === 'attrValue') {
        if (w.attr.name === 'xml:id' && localName(w.el.name) === 'anchor') {
          const n = F.noteFor(p, w.attr.value);
          if (n) return new vscode.Location(doc.uri, doc.positionAt(n.start));
        }
        const ref = pointerTarget(p, w.attr.value, off - w.attr.valueStart);
        if (ref) return new vscode.Location(doc.uri, doc.positionAt(ref.start));
      }
      return undefined;
    },
  }));

  // ----- deleting an anchor by hand deletes its note -----
  const snaps = new Map<string, G.AnchorSnap[]>();
  const stash = new Map<string, Map<string, { type?: string; content: string }>>(); // notes of cut anchors
  const snapOf = (doc: vscode.TextDocument) => {
    const k = doc.uri.toString();
    let sn = snaps.get(k);
    if (!sn) { sn = G.snapshotAnchors(parsedOf(doc)); snaps.set(k, sn); }
    return sn;
  };
  vscode.workspace.textDocuments.forEach(d => { if (d.languageId === 'xml') snapOf(d); });
  ctx.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(d => { if (d.languageId === 'xml') snapOf(d); }),
    vscode.workspace.onDidCloseTextDocument(d => { snaps.delete(d.uri.toString()); stash.delete(d.uri.toString()); }),
    vscode.workspace.onDidChangeTextDocument(e => {
      const doc = e.document;
      if (doc.languageId !== 'xml' || !e.contentChanges.length) return;
      const k = doc.uri.toString();
      const old = snaps.get(k);
      if (!old) { snapOf(doc); return; }
      if (!G.touchesAnchors(old, e.contentChanges)) { snaps.set(k, G.shiftAnchors(old, e.contentChanges)); return; }
      const now = parsedOf(doc);
      snaps.set(k, G.snapshotAnchors(now));
      // undo/redo replays edits we already made; acting again would fight it
      if (e.reason !== undefined) return;
      if (!cfg().get<boolean>('footnotes.deleteNoteWithAnchor', true)) return;
      const isAnchor = (id: string) => now.ids.get(id)?.some(x => localName(x.name) === 'anchor');
      const gone = G.deletedAnchorIds(old, e.contentChanges, now).filter(id => F.noteFor(now, id));
      const back = G.insertedAnchorIds(e.contentChanges).filter(id => stash.get(k)?.has(id) && isAnchor(id) && !F.noteFor(now, id));
      if (gone.length || back.length) setTimeout(() => syncNotes(doc, gone, back), 0);
    }),
  );

  async function syncNotes(doc: vscode.TextDocument, gone: string[], back: string[]) {
    const k = doc.uri.toString();
    const before = doc.getText();
    let text = before;
    let p = parse(text);
    const opts = noteOptionsFor(doc);
    const removed: string[] = [];
    let mine = stash.get(k);
    if (!mine) { mine = new Map(); stash.set(k, mine); }
    for (const id of gone) {
      if (p.ids.get(id)?.some(x => localName(x.name) === 'anchor')) continue;
      const note = F.noteFor(p, id);
      if (!note) continue;
      mine.set(id, { type: F.noteType(note), content: F.noteContent(text, note) });
      if (mine.size > 200) mine.delete(mine.keys().next().value!);
      text = F.applyEdits(text, [F.planNoteRemoval(text, p, note)]);
      p = parse(text);
      removed.push(id);
    }
    const restored: string[] = [];
    for (const id of back) {
      const saved = mine.get(id);
      const ctxId = F.contextIdOfAnchor(id);
      const ctxEl = ctxId ? p.ids.get(ctxId)?.[0] : undefined;
      if (!saved || !ctxId || !ctxEl || F.noteFor(p, id)) continue;
      text = F.applyEdits(text, [F.planNoteInsertion(text, p, ctxEl, ctxId, id, saved.content, opts, saved.type || opts.standOffTypes[0])]);
      p = parse(text);
      mine.delete(id);
      restored.push(id);
    }
    if (text === before) return;
    await applyEdits(doc, [F.diffEdit(before, text)]);
    if (view.state && removed.includes(view.state.anchorId) && view.state.uri === k) view.clear();
    const msg = [
      removed.length ? `Deleted note${removed.length > 1 ? 's' : ''} ${removed.join(', ')} with the anchor` : '',
      restored.length ? `Restored note${restored.length > 1 ? 's' : ''} ${restored.join(', ')}` : '',
    ].filter(Boolean).join(' · ');
    vscode.window.setStatusBarMessage(`$(note) ${msg} (Ctrl+Z to undo)`, 6000);
  }

  // Backspace just after an anchor / Delete just before it removes the whole
  // anchor and its note in one step, like a footnote mark in a word processor.
  let atEnd = false, atStart = false;
  const updateAnchorKeys = (ed: vscode.TextEditor | undefined) => {
    let e = false, st = false;
    if (ed && ed.document.languageId === 'xml' && ed.selections.length === 1 && ed.selection.isEmpty
        && cfg().get<boolean>('footnotes.atomicAnchors', true)) {
      const off = ed.document.offsetAt(ed.selection.active);
      const sn = snapOf(ed.document);
      e = sn.some(a => a.end === off);
      st = sn.some(a => a.start === off);
    }
    if (e !== atEnd) { atEnd = e; vscode.commands.executeCommand('setContext', 'teiScholar.atAnchorEnd', e); }
    if (st !== atStart) { atStart = st; vscode.commands.executeCommand('setContext', 'teiScholar.atAnchorStart', st); }
  };
  ctx.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(e => updateAnchorKeys(e.textEditor)),
    vscode.window.onDidChangeActiveTextEditor(updateAnchorKeys),
  );
  const deleteAdjacentAnchor = async (side: 'left' | 'right') => {
    const ed = vscode.window.activeTextEditor;
    if (!ed) return;
    const doc = ed.document;
    const p = parsedOf(doc);
    const off = doc.offsetAt(ed.selection.active);
    const a = p.all.find(x => localName(x.name) === 'anchor' && (side === 'left' ? x.end === off : x.start === off));
    if (!a) {
      await vscode.commands.executeCommand(side === 'left' ? 'deleteLeft' : 'deleteRight');
      return;
    }
    const id = attr(a, 'xml:id');
    const note = id ? F.noteFor(p, id) : undefined;
    if (id && note) {
      const m = stash.get(doc.uri.toString()) ?? new Map();
      m.set(id, { type: F.noteType(note), content: F.noteContent(doc.getText(), note) });
      stash.set(doc.uri.toString(), m);
    }
    await applyEdits(doc, F.planDeletion(doc.getText(), p, a));
    if (id && view.state?.anchorId === id) view.clear();
    if (note) vscode.window.setStatusBarMessage(`$(note) Deleted footnote ${id} and its note (Ctrl+Z to undo)`, 6000);
  };
  cmd('teiScholar.deleteAnchorLeft', () => deleteAdjacentAnchor('left'));
  cmd('teiScholar.deleteAnchorRight', () => deleteAdjacentAnchor('right'));

  // ----- diagnostics -----
  const diags = vscode.languages.createDiagnosticCollection('tei-scholar');
  ctx.subscriptions.push(diags);
  const timers = new Map<string, NodeJS.Timeout>();
  const schedule = (doc: vscode.TextDocument) => {
    if (doc.languageId !== 'xml') return;
    const k = doc.uri.toString();
    clearTimeout(timers.get(k));
    timers.set(k, setTimeout(() => diags.set(doc.uri, isTei(doc) ? checkDocument(doc) : []), 400));
  };
  vscode.workspace.textDocuments.forEach(schedule);
  ctx.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(schedule),
    vscode.workspace.onDidChangeTextDocument(e => { schedule(e.document); refreshDecorations(); }),
    vscode.workspace.onDidCloseTextDocument(d => { diags.delete(d.uri); cache.delete(d.uri.toString()); }),
  );

  function checkDocument(doc: vscode.TextDocument): vscode.Diagnostic[] {
    const p = parsedOf(doc);
    const out: vscode.Diagnostic[] = [];
    const range = (s: number, e: number) => new vscode.Range(doc.positionAt(s), doc.positionAt(e));
    for (const [id, els] of p.ids) {
      if (els.length < 2) continue;
      for (const el of els) {
        const a = el.attrs.find(x => x.name === 'xml:id')!;
        out.push(diag(range(a.valueStart, a.valueEnd), `Duplicate xml:id "${id}" (${els.length} times).`, vscode.DiagnosticSeverity.Error));
      }
    }
    const skip = new Set(['xml:id', 'style', 'rend', 'n', 'xml:lang', 'type', 'subtype']);
    for (const el of p.all) {
      for (const a of el.attrs) {
        if (skip.has(a.name) || !a.value.includes('#')) continue;
        let pos = 0;
        for (const tok of a.value.split(/(\s+)/)) {
          if (tok.startsWith('#') && tok.length > 1 && !p.ids.has(tok.slice(1))) {
            const s = a.valueStart + pos;
            out.push(diag(range(s, s + tok.length), `No element with xml:id="${tok.slice(1)}" in this file.`, vscode.DiagnosticSeverity.Warning));
          }
          pos += tok.length;
        }
      }
      if (localName(el.name) === 'anchor') {
        const id = attr(el, 'xml:id');
        if (id && /-n\d+$/.test(id) && !F.noteFor(p, id)) {
          out.push(diag(range(el.start, el.end), `Footnote anchor ${id} has no <note>.`, vscode.DiagnosticSeverity.Warning));
        }
      }
    }
    return out;
  }

  // ----- footnote numbers shown after anchors -----
  const deco = vscode.window.createTextEditorDecorationType({
    after: { color: new vscode.ThemeColor('editorCodeLens.foreground'), margin: '0 0 0 1px', fontStyle: 'normal' },
  });
  ctx.subscriptions.push(deco);
  let decoTimer: NodeJS.Timeout | undefined;
  function refreshDecorations() {
    clearTimeout(decoTimer);
    decoTimer = setTimeout(() => {
      for (const ed of vscode.window.visibleTextEditors) {
        if (ed.document.languageId !== 'xml') continue;
        if (!cfg().get<boolean>('footnotes.showNumbers', true) || !isTei(ed.document)) { ed.setDecorations(deco, []); continue; }
        const p = parsedOf(ed.document);
        const anchors = F.footnoteAnchors(p);
        const first = configuredTypes()[0];
        const counters = new Map<string, number>();
        ed.setDecorations(deco, anchors.map(a => {
          const note = F.noteFor(p, attr(a, 'xml:id')!);
          const t = (note && F.noteType(note)) || first;
          const n = (counters.get(t) ?? 0) + 1;
          counters.set(t, n);
          // separate running numbers per type; non-default types get a letter: ᵉ¹ ᵗ¹
          const label = (t === first ? '' : superLetter(t)) + superscript(n);
          return {
            range: new vscode.Range(ed.document.positionAt(a.end), ed.document.positionAt(a.end)),
            renderOptions: { after: { contentText: label } },
          };
        }));
      }
    }, 250);
  }
  ctx.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(refreshDecorations));
  refreshDecorations();

  // ----- status bar: font profile -----
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'teiScholar.chooseFont';
  status.tooltip = 'TEI Scholar: choose a font profile for XML files';
  ctx.subscriptions.push(status);
  const updateStatus = () => {
    const ed = vscode.window.activeTextEditor;
    if (ed?.document.languageId === 'xml') {
      status.text = `$(text-size) ${currentProfileName()}`;
      status.show();
    } else status.hide();
  };
  ctx.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateStatus));
  updateStatus();
  ctx.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('editor') || e.affectsConfiguration('teiScholar')) { view.refreshFont(); refreshDecorations(); updateStatus(); }
  }));

  type Prof = { name: string; fontFamily: string; fontSize?: number; lineHeight?: number; description?: string };
  function currentProfileName(): string {
    const fam = vscode.workspace.getConfiguration('editor', { languageId: 'xml' }).inspect<string>('fontFamily');
    const v = fam?.globalLanguageValue ?? fam?.workspaceLanguageValue;
    if (!v) return 'Default font';
    return (cfg().get<Prof[]>('fontProfiles') || []).find(p => p.fontFamily === v)?.name ?? 'Custom font';
  }

  async function chooseFont(v: FootnoteViewProvider) {
    const profiles = cfg().get<Prof[]>('fontProfiles') || [];
    const items: (vscode.QuickPickItem & { prof?: Prof; action?: string })[] = [
      ...profiles.map(p => ({ label: p.name, description: p.description, detail: p.fontFamily, prof: p })),
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      { label: '$(edit) Custom font…', action: 'custom' },
      { label: '$(discard) Reset XML files to VS Code default font', action: 'reset' },
      { label: '$(gear) Edit font profiles in settings', action: 'settings' },
    ];
    const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Font for XML files (and the footnote pane)', matchOnDetail: true });
    if (!pick) return;
    const ed = vscode.workspace.getConfiguration('editor', { languageId: 'xml' });
    const set = (k: string, val: unknown) => ed.update(k, val, vscode.ConfigurationTarget.Global, true);
    if (pick.action === 'settings') { vscode.commands.executeCommand('workbench.action.openSettings', 'teiScholar.fontProfiles'); return; }
    if (pick.action === 'reset') {
      await set('fontFamily', undefined); await set('fontSize', undefined); await set('lineHeight', undefined);
    } else if (pick.action === 'custom') {
      const fam = await vscode.window.showInputBox({ prompt: 'Font family (CSS list; later fonts are used for characters the first lacks)', value: ed.get<string>('fontFamily') });
      if (!fam) return;
      const size = await vscode.window.showInputBox({ prompt: 'Font size (px)', value: String(ed.get<number>('fontSize') || 16) });
      await set('fontFamily', fam);
      if (size && +size > 0) await set('fontSize', +size);
    } else if (pick.prof) {
      await set('fontFamily', pick.prof.fontFamily);
      await set('fontSize', pick.prof.fontSize);
      await set('lineHeight', pick.prof.lineHeight);
    }
    v.refreshFont();
    updateStatus();
  }

  // ----- offer schema association for TEI files without one -----
  const offered = new Set<string>();
  const offerSchema = (doc: vscode.TextDocument) => {
    if (!cfg().get<boolean>('schema.offerAssociation', true)) return;
    if (doc.languageId !== 'xml' || offered.has(doc.uri.toString()) || !isTei(doc)) return;
    const head = doc.getText().slice(0, 4000);
    if (/<\?xml-model\b/.test(head) || /<!DOCTYPE/.test(head) || /schemaLocation=/.test(head)) return;
    offered.add(doc.uri.toString());
    vscode.window.showInformationMessage(`${path.basename(doc.fileName)} has no schema declaration, so it is not being validated.`, 'Add TEI (tei_all)', 'Not now')
      .then(c => { if (c === 'Add TEI (tei_all)') addSchemaDeclaration(doc); });
  };
  vscode.workspace.textDocuments.forEach(offerSchema);
  ctx.subscriptions.push(vscode.workspace.onDidOpenTextDocument(offerSchema));
}

export function deactivate() { /* nothing */ }

// ---------- helpers ----------

function diag(r: vscode.Range, msg: string, sev: vscode.DiagnosticSeverity) {
  const d = new vscode.Diagnostic(r, msg, sev);
  d.source = 'TEI Scholar';
  return d;
}

function pointerTarget(p: Parsed, value: string, rel: number): Elem | undefined {
  let pos = 0;
  for (const tok of value.split(/(\s+)/)) {
    if (rel >= pos && rel <= pos + tok.length && tok.startsWith('#')) return p.ids.get(tok.slice(1))?.[0];
    pos += tok.length;
  }
  return undefined;
}

function snippet(text: string, el: Elem): string {
  if (el.selfClosing && el.parent) {
    // an empty element such as <anchor/>: show the words just before it
    const before = text.slice(el.parent.startTagEnd, el.start).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trimStart();
    return '…' + escapeMd(before.slice(-80)) + ' ⟨here⟩';
  }
  const inner = el.selfClosing ? '' : text.slice(el.startTagEnd, el.endTagStart < 0 ? el.startTagEnd + 200 : el.endTagStart);
  const plain = inner.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  return escapeMd(plain.length > 160 ? plain.slice(0, 160) + '…' : plain) || '*(empty)*';
}

function escapeMd(s: string) { return s.replace(/([\\`*_{}[\]<>#|])/g, '\\$1'); }

function superLetter(type: string) {
  const sup: Record<string, string> = { a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', f: 'ᶠ', g: 'ᵍ', h: 'ʰ', i: 'ⁱ', j: 'ʲ', k: 'ᵏ', l: 'ˡ', m: 'ᵐ', n: 'ⁿ', o: 'ᵒ', p: 'ᵖ', r: 'ʳ', s: 'ˢ', t: 'ᵗ', u: 'ᵘ', v: 'ᵛ', w: 'ʷ', x: 'ˣ', y: 'ʸ', z: 'ᶻ' };
  const c = type[0]?.toLowerCase() ?? '';
  return sup[c] ?? type[0] ?? '';
}

function superscript(n: number) {
  const map = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  return String(n).split('').map(d => map[+d]).join('');
}

async function addSchemaDeclaration(doc: vscode.TextDocument) {
  const text = doc.getText();
  if (text.includes(TEI_ALL_URL)) { vscode.window.showInformationMessage('This file already declares tei_all.'); return; }
  const eol = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  const pi = `<?xml-model href="${TEI_ALL_URL}" type="application/xml" schematypens="http://relaxng.org/ns/structure/1.0"?>`;
  const decl = /^﻿?<\?xml[^>]*\?>[ \t]*\r?\n?/.exec(text);
  const at = decl ? decl[0].length : 0;
  const insert = decl ? (decl[0].endsWith('\n') ? pi + eol : eol + pi + eol) : pi + eol;
  const we = new vscode.WorkspaceEdit();
  we.insert(doc.uri, doc.positionAt(at), insert);
  await vscode.workspace.applyEdit(we);
}

/** Register our XML catalog with Red Hat XML so tei_all.rng resolves offline. */
function registerCatalog(ctx: vscode.ExtensionContext) {
  if (!cfg().get<boolean>('schema.useBundledSchema', true)) return;
  const catalog = path.join(ctx.extensionPath, 'schema', 'catalog.xml');
  const xml = vscode.workspace.getConfiguration('xml');
  const current = xml.inspect<string[]>('catalogs')?.globalValue ?? [];
  // drop catalogs from older versions of this extension
  const kept = current.filter(c => !(/tei-scholar/i.test(c) && /catalog\.xml$/.test(c) && c !== catalog));
  if (!kept.includes(catalog)) kept.push(catalog);
  if (kept.length !== current.length || kept.some((c, i) => c !== current[i])) {
    // fails harmlessly if Red Hat XML is not installed (setting not registered)
    xml.update('catalogs', kept, vscode.ConfigurationTarget.Global).then(undefined, () => undefined);
  }
}

