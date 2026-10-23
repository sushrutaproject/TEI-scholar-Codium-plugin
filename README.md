# TEI Scholar

A VS Code extension for editing TEI P5 texts, built for Indological work.
It runs on top of Red Hat's XML extension, which does the schema validation
(with Jing, the same validator oXygen uses).

## Install

1. Install [VS Code](https://code.visualstudio.com/).
2. In VS Code: **Extensions** view → **⋯** menu → **Install from VSIX…** → choose `tei-scholar-0.5.0.vsix`.
   Red Hat's *XML* extension is installed automatically (needs internet once).
3. Open a TEI file. If it has no schema declaration you will be offered one.

## Footnotes

| Action | Windows / Linux | Mac |
|---|---|---|
| Insert footnote at cursor | `Ctrl+Alt+N` | `⌘⌥N` |
| Edit footnote (cursor on the anchor) | `Ctrl+Alt+E` | `⌘⌥E` |
| Save note (and return to the text) / cancel | `Ctrl+Enter` / `Esc` | `⌘Enter` / `Esc` |
| Jump from anchor to its note, and back | `Ctrl+Alt+J` | `⌘⌥J` |
| Next / previous footnote | `Ctrl+Alt+↓ / ↑` | `⌘⌥↓ / ↑` |

Inserting places `<anchor xml:id="XXX-n1"/>` at the cursor, where `XXX` is the
`xml:id` of the nearest enclosing element, and opens the **Footnote** pane at the
bottom of the window. Saving writes

```xml
<standOff corresp="#XXX" type="Note">
    <note xml:lang="en" target="#XXX-n1">Text of the note.</note>
</standOff>
```

after `</text>` and before `</TEI>`. Further notes in the same passage become
`-n2`, `-n3` … Cancelling a new note removes its anchor; deleting the last note
in a `<standOff>` removes the `<standOff>`.

**Note types.** The pane's **type** list sets the `<standOff>`'s `@type`:
*Note*, *Emendation*, *Testimonia*, or **Custom…** (any single word, e.g.
`Parallel`). Each type gets its own `<standOff>` per passage, so one verse can
have `type="Note"`, `type="Emendation"` and `type="Testimonia"` blocks side by
side. All types share one `-nN` sequence, so ids never clash. Changing the type
of a saved note moves it to the right block (creating or removing blocks as
needed). New notes start with the type you used last. Blocks are ordered by
passage, then by type. On screen, notes are numbered separately per type:
¹ ² for Note, ᵉ¹ for Emendation, ᵗ¹ for Testimonia. The list of types is in
**Settings → TEI Scholar → Footnotes: Stand Off Types**.

- **Deleting a footnote in the text deletes its note.** Backspace just after an
  anchor (or Delete just before it) removes the anchor, its superscript number
  and its note in one step; `Ctrl+Z` brings both back. Deleting a selection that
  contains anchors also deletes their notes, and a `<standOff>` left empty is
  removed. If you *cut* an anchor and paste it elsewhere in the same file, its
  note comes back. Turn this off with `teiScholar.footnotes.deleteNoteWithAnchor`;
  `teiScholar.footnotes.atomicAnchors` controls the Backspace/Delete behaviour.
- The note may contain markup; the pane's buttons wrap a selection in
  `<foreign>`, `<title>`, `<hi>`, `<q>` or `<ref>`. A bare `&` is escaped for you;
  malformed markup is refused with a message.
- Running numbers (¹ ² ³) appear after anchors on screen only.
- **Hover an anchor** to read its note, with two links: **Edit** opens it in the
  Footnote pane; **Go to note** jumps to the `<note>` in the standOff area. Each
  note there has **↑ back to text (line N)** and **edit in pane** links above it,
  and hovering inside a note shows **Back to text** as well. Going back puts the
  cursor just after the anchor, so you can carry on typing. `Ctrl+Alt+J` does
  the same jump in both directions from the keyboard.
- `Ctrl+click` (or F12) on any `#pointer` jumps to its target.
- **Notes are kept in number order** inside each `<standOff>` (`-n1`, `-n2`, … `-n10`),
  whenever a note is added, moved to another type, or restored. For older files,
  an out-of-order `<standOff>` is flagged in the Problems list; the light-bulb
  quick fix, or **TEI: Sort Notes in standOff by -n Number**, sorts the whole file.
- **TEI: Renumber Footnotes in Reading Order** fixes ids after you insert a note
  before an existing one (e.g. `-n2` before `-n1`).
- To always use the line group's id even when `<l>` has its own, set
  `teiScholar.footnotes.contextElements` to `["lg"]` (add `"p"`, `"div"` etc. as needed).

## TEI help and validation

- Hover an element name: gloss, description, attributes, what it may contain
  and where it may appear, with links to the TEI Guidelines. Hover an attribute:
  its definition and suggested/allowed values. Hover text: the element path.
- `Ctrl+F1` (`⌘F1`) opens the TEI reference page for the element or attribute class at the cursor.
- Validation and context-sensitive completion come from Red Hat XML. `tei_all.rng`
  (TEI P5 4.10.2) is bundled and used whenever a file declares the standard
  tei_all URL, so it works offline. Files that point their `<?xml-model?>` at a
  project ODD schema use that schema instead.
- Extra checks: duplicate `xml:id`s, `#pointers` to ids that do not exist, and
  footnote anchors without notes.

## Fonts and scripts

Click the font name in the status bar (or **TEI: Choose Font Profile**) to switch
profiles: *Markup (monospace)*, *IAST reading*, *Devanagari*, *Tibetan*, *South
Indian scripts*, or a custom font. Profiles apply to XML files only and to the
footnote pane. Each is a fallback list, so a Latin font handles IAST and a
Devanagari font handles Devanagari in the same line. Edit the list under
**Settings → TEI Scholar → Font Profiles**.

Recommended free fonts: Noto Serif Devanagari and Noto Sans Mono
(fonts.google.com/noto), Gentium Plus and Charis SIL (software.sil.org).

Transliteration (select text, right-click → **TEI**): IAST → Devanagari,
Devanagari → IAST, Harvard-Kyoto → IAST, Velthuis → IAST. Tags and entity
references inside the selection are left alone.

## Notes

- Red Hat XML shows its own short hover from the schema; TEI Scholar's fuller
  hover appears below it.
- `teiScholar.help.hoverOnText` turns off the element-path hover over text.
