# TEI Scholar

**An extension for VSCodium (and VS Code) for editing TEI XML texts, built for Indological work.**

TEI Scholar turns the free VSCodium editor into a TEI workbench:

- **Validation** of your file against the TEI P5 `tei_all` schema, with errors underlined as you type (works offline).
- **Pop-up TEI documentation**: hover over any element or attribute to see what it means, what it may contain and where it may appear.
- **Word-processor-style footnotes**: press a key, type the note, and it is stored correctly in a `<standOff>` block.
- **Fonts for Indic scripts**: switch between profiles for markup, IAST, Devanagari, Tibetan and South Indian scripts.
- **Transliteration**: IAST ↔ Devanagari, and Harvard-Kyoto or Velthuis → IAST.

This guide assumes you have never used VSCodium or GitHub before. Follow Parts 1–3 in order; it takes about 15 minutes.

---

## Part 1 — Install VSCodium

VSCodium is a free text editor. It is the open-source build of Microsoft's VS Code, without Microsoft's tracking. (TEI Scholar also works in VS Code itself; the steps are the same.)

1. Go to **https://vscodium.com** and click **Install**.
2. Download the installer for your computer (Windows, macOS or Linux).
3. Run the installer and accept the default options.
4. Open VSCodium once to check that it starts, then leave it open.

---

## Part 2 — Install TEI Scholar

The extension is a single file called **`tei-scholar-0.3.0.vsix`**. You download it, then tell VSCodium to install it.

### Download the file

1. On this GitHub page, scroll up to the list of files and click **`tei-scholar-0.3.0.vsix`**.
2. On the page that opens, click the **Download raw file** button (a small downward arrow ⬇ at the top right of the file box).
3. The file goes to your **Downloads** folder.

(Direct link: https://github.com/sushrutaproject/TEI-scholar-Codium-plugin/raw/main/tei-scholar-0.3.0.vsix)

> Do **not** unzip or double-click the `.vsix` file. VSCodium installs it as it is.

### Install it in VSCodium

1. In VSCodium, click the **Extensions** icon in the bar on the far left (it looks like four small squares).
2. At the top of the Extensions panel, click the **⋯** (three dots) menu.
3. Choose **Install from VSIX…**
4. Find `tei-scholar-0.3.0.vsix` in your Downloads folder and click **Install**.
5. Wait a moment. VSCodium will also install **XML** by Red Hat automatically — TEI Scholar needs it to do the validation. **You must be online for this the first time.**
6. If asked, click **Reload** or close and reopen VSCodium.

You should now see both **TEI Scholar** and **XML** listed under *Installed* in the Extensions panel.

---

## Part 3 — Open and work on a TEI file

1. Choose **File → Open Folder…** (on macOS: **File → Open…**) and select the folder that holds your TEI files. Using a folder rather than a single file lets links between files work.
2. If VSCodium asks *"Do you trust the authors of the files in this folder?"*, click **Yes, I trust the authors**.
3. Click a `.xml` file in the left-hand panel to open it.
4. If the file has no schema declaration, a message appears in the bottom-right corner: click **Add TEI (tei_all)**. This adds one line at the top of the file so it can be checked.

Within a few seconds, mistakes in the markup are underlined in red. Hover over an underline to read the error. The full list is in the **Problems** panel (**View → Problems**).

**Want to practise first?** Download [`test/sample.xml`](test/sample.xml) (a few verses of the *Suśrutasaṃhitā*) the same way you downloaded the `.vsix` file, and open it.

### Where to find everything

Almost every TEI Scholar feature can be reached in one of three ways:

- **Right-click** in an XML file → **TEI** submenu.
- **Command Palette**: press **Ctrl + Shift + P** (macOS: **Cmd + Shift + P**) and type `TEI`.
- **Keyboard shortcuts**, listed below.

---

## Footnotes

| Action | Windows / Linux | macOS |
|---|---|---|
| Insert footnote at cursor | `Ctrl+Alt+N` | `⌘⌥N` |
| Edit footnote (cursor on the anchor) | `Ctrl+Alt+E` | `⌘⌥E` |
| Save note (and return to the text) / cancel | `Ctrl+Enter` / `Esc` | `⌘Enter` / `Esc` |
| Next / previous footnote | `Ctrl+Alt+↓ / ↑` | `⌘⌥↓ / ↑` |

**In plain terms:** put the cursor where the footnote mark should go, press `Ctrl+Alt+N`, type the note in the **Footnote** pane that opens at the bottom of the window, and press `Ctrl+Enter`. A small superscript number (¹ ² ³) appears in your text; it is shown on screen only and is not written into the file.

**What is written to the file.** Inserting places `<anchor xml:id="XXX-n1"/>` at the cursor, where `XXX` is the `xml:id` of the nearest enclosing element. The note itself is saved after `</text>` and before `</TEI>`:

```xml
<standOff corresp="#XXX" type="Notes">
    <note xml:lang="en" target="#XXX-n1">Text of the note.</note>
</standOff>
```

Further notes in the same passage become `-n2`, `-n3` … Cancelling a new note removes its anchor; deleting the last note in a `<standOff>` removes the `<standOff>`.

**Note types.** The pane's **type** list sets the `<standOff>`'s `@type`: *Notes*, *Emendation*, *Testimonia*, or **Custom…** (any single word, e.g. `Parallel`). Each type gets its own `<standOff>` per passage, so one verse can have `Notes`, `Emendation` and `Testimonia` blocks side by side. All types share one `-nN` sequence, so ids never clash. Changing the type of a saved note moves it to the right block. On screen, notes are numbered separately per type: ¹ ² for Notes, ᵉ¹ for Emendation, ᵗ¹ for Testimonia.

**Other things to know:**

- **Deleting a footnote mark deletes its note.** Backspace just after an anchor (or Delete just before it) removes the anchor and its note in one step; `Ctrl+Z` brings both back. If you *cut* an anchor and paste it elsewhere in the same file, its note comes back with it.
- The pane's buttons wrap selected text in `<foreign>`, `<title>`, `<hi>`, `<q>` or `<ref>`. A bare `&` is escaped for you; malformed markup is refused with a message.
- Hover over an anchor to read its note. `Ctrl+click` (or `F12`) on an id or on any `#pointer` jumps to its target.
- **TEI: Renumber Footnotes in Reading Order** tidies the ids after you insert a note before an existing one.

---

## TEI help and validation

- **Hover over an element name** to see its gloss, description, attributes, what it may contain and where it may appear, with links to the TEI Guidelines. **Hover over an attribute** for its definition and allowed values. **Hover over text** to see where you are, e.g. `TEI › text › body › div › lg › l`.
- **`Ctrl+F1`** (macOS `⌘F1`) opens the TEI Guidelines page for the element at the cursor in your web browser.
- **Completion:** type `<` inside an element and a list of the elements allowed at that point appears.
- The TEI schema (`tei_all`, TEI P5 4.10.2) is included, so validation works without internet. If your file points to your own project schema (an ODD), that schema is used instead.
- **Extra checks:** duplicate `xml:id`s, `#pointers` to ids that do not exist, and footnote anchors without notes.

---

## Fonts and scripts

At the bottom right of the window, when an XML file is open, you will see the name of the current **font profile**. Click it (or use **TEI: Choose Font Profile**) to switch between:

- *Markup (monospace)* — tags line up neatly
- *IAST reading* — a proportional serif with full diacritics
- *Devanagari* — larger size and line spacing for conjuncts
- *Tibetan*
- *South Indian scripts* — Tamil, Telugu, Kannada, Malayalam

Profiles apply to XML files and the Footnote pane only. Each profile is a list of fonts: a Latin font handles IAST and a Devanagari font handles Devanagari in the same line.

**The fonts must be installed on your computer.** Recommended free fonts:

- **Noto Serif Devanagari** and **Noto Sans Mono** — https://fonts.google.com/noto
- **Gentium Plus** and **Charis SIL** — https://software.sil.org/fonts/

To install a font, download it, open the font file, and click **Install** (Windows, macOS) or copy it into `~/.local/share/fonts` (Linux). Then restart VSCodium.

### Transliteration

Select some text, right-click → **TEI**, and choose:

- IAST → Devanagari
- Devanagari → IAST
- Harvard-Kyoto → IAST
- Velthuis → IAST

Tags and entity references inside the selection are left untouched.

---

## Changing settings

Open **File → Preferences → Settings** (macOS: **VSCodium → Settings…**) and type `TEI Scholar` in the search box. Useful settings include:

- **Footnotes: Note Lang** — the `xml:lang` of new notes (default `en`).
- **Footnotes: Stand Off Types** — the list of note types offered in the Footnote pane.
- **Footnotes: Context Elements** — set to `["lg"]` to always take footnote ids from the line group, even when an `<l>` has its own `xml:id`.
- **Footnotes: Delete Note With Anchor** and **Atomic Anchors** — turn off the automatic deletion of notes described above.
- **Help: Hover On Text** — turn off the element-path pop-up over ordinary text.
- **Translit: Avagraha** — the character written for ऽ when converting to IAST.
- **Font Profiles** — edit or add font profiles.

---

## Updating and uninstalling

- **To update:** download the newer `.vsix` file from this page and install it exactly as in Part 2. It replaces the old version.
- **To uninstall:** in the Extensions panel, click the gear ⚙ next to **TEI Scholar** → **Uninstall**.

---

## Troubleshooting

**Nothing happens when I press `Ctrl+Alt+N`, and there is no TEI entry when I right-click.**
TEI Scholar only works in XML files. Check the bottom-right corner of the window: it should say **XML**. If it says something else (e.g. *Plain Text*), click it and choose **XML**. Also check that the file name ends in `.xml`.

**No red underlines appear, even for obvious errors.**
- Check that the **XML** extension by Red Hat is installed (Extensions panel → *Installed*). If not, search for `XML Red Hat` in the Extensions panel and click **Install**.
- Check that the file has a schema declaration (see Part 3, step 4). You can add one with **TEI: Add tei_all Schema Declaration** from the Command Palette.
- On some computers (for example with ARM processors), the XML extension may ask you to install **Java**. If it does, install the free Java from https://adoptium.net and restart VSCodium.

**"Install from VSIX" is not in the menu.**
Make sure you clicked the **⋯** at the top of the *Extensions* panel, not elsewhere. Alternatively, press **Ctrl + Shift + P**, type `Install from VSIX`, and press Enter.

**Devanagari or diacritics show as boxes or look wrong.**
The fonts named in the profile are not installed — see *Fonts and scripts* above. If characters are garbled (e.g. `Ä` instead of `ā`), click the encoding shown at the bottom right of the window, choose **Reopen with Encoding**, then **UTF-8**.

**The Footnote pane has disappeared.**
Choose **View → Appearance → Panel** (or press **Ctrl + J**), then click the **Footnote** tab.

**VSCodium says it is in "Restricted Mode".**
Click the notice at the top and choose **Trust**.

**Red Hat XML and TEI Scholar both show a pop-up when I hover.**
That is normal: Red Hat's short note from the schema comes first, and TEI Scholar's fuller description appears below it.

---

## For developers

The source is in `src/` (TypeScript). To build the `.vsix` yourself you need Node.js:

```
npm install
npm run package
```

This type-checks, runs the tests in `test/`, bundles the code with esbuild, and writes a new `.vsix` file. `tools/build_help.py` regenerates `data/tei-help.json`, the documentation shown in hovers.

---

## License

MIT — see [LICENSE](LICENSE). The bundled `tei_all.rng` schema is from the [TEI Consortium](https://tei-c.org) and is distributed under its own terms (CC BY and BSD-2).
