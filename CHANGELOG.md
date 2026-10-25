# Changelog

## 0.6.0
- Update check: once a day TEI Scholar looks for a newer `tei-scholar-X.Y.Z.vsix`
  in the GitHub repository and offers to install it. Manual check:
  **TEI: Check for Updates**.

## 0.5.1
- New notes are written `<note target="#…" xml:lang="en">` (target first).

## 0.5.0
- Default note type is now `Note` (was `Notes`).
- Notes inside each `<standOff>` are kept in `-n1, -n2, … -n10` order; older files
  with out-of-order notes are flagged, with a one-click fix and
  **TEI: Sort Notes in standOff by -n Number**.

## 0.4.0
- Hover on an anchor: **Edit** and **Go to note** links. Each note in the
  standOff area has **↑ back to text** and **edit in pane** links.
  `Ctrl+Alt+J` jumps between anchor and note.

## 0.3.0
- Deleting an anchor deletes its note; Backspace/Delete removes an anchor in
  one step; cut-and-paste of an anchor keeps its note.

## 0.2.0
- Note types (Notes / Emendation / Testimonia / Custom), one `<standOff>` per
  type and passage.

## 0.1.0
- First release: TEI validation and help, footnotes in `<standOff>`, font
  profiles, transliteration.
