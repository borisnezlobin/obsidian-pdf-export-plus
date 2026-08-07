# PDF Export Plus

Export polished PDFs from Obsidian. PDF Export Plus supports custom or preset styles, and is the only Obsidian plugin that supports placing footnotes at the bottom of the page where they are referenced.

PDF Export Plus gives you an easy-to-use PDF export workflow that can be as simple or as powerful as you need. Export with
normal mode to preserve your Obsidian theme, or enable Professional Style to export with customizable professional-grade typography.

## Demo

![PDF Export Plus workflow: open the command palette, preview the note, enable professional typography, and export](docs/pdf-export-plus-demo.gif)

`Cmd`+`Shift`+`P` is a user-assigned example hotkey; you can assign any available shortcut in Obsidian's Hotkeys settings.

![Two exported pages side by side: footnotes one through three sit at the bottom of page one, footnotes four and five at the bottom of page two](docs/pdf-export-plus-preview.png)

Both images are real output: the second is an exported PDF, with each footnote on the page that cites it.

## Highlights

- Page-bottom footnotes instead of a separate endnotes section
- Live, scrollable preview before export
- Links between references and their footnotes
- Images, tables, lists, callouts, code blocks, math, headings, blockquotes, and common Obsidian Markdown
- Optional title generated from `title` frontmatter or the note filename
- Paragraph shaping: first-line indents, paragraph spacing, and blank lines
- An optional drop cap with adjustable size
- Page numbers
- Optional Professional Style for customizable professional typography
- A4, Letter, Legal, A3, A5, and Tabloid output
- Configurable margins, page numbers, backgrounds, footnote size, and export folder

## Examples

### Footnotes

Write ordinary Obsidian footnotes:

```markdown
The reference stays with the sentence that cites it.[^1]

[^1]: PDF Export Plus places this note at the bottom of the reference's page.
```

Recommended to use with Footnotes Plus, which automatically renumbers footnotes and makes jumping around/creating footnotes easy.

### A professional manuscript

Enable **Professional style** in the export preview for a clean manuscript-style PDF. The default preset uses Times New Roman at 12 pt with double spacing, but you can change the font, size, or line spacing in **Settings → PDF Export Plus** or directly in the preview.

Professional Style deliberately overrides vault typography while retaining document structure. It includes print rules for headings, paragraphs, emphasis, links, lists, tables, blockquotes, callouts, code, math, media, and footnotes. Community-plugin-generated HTML may still need its own print CSS.

### Paragraph shaping

**Paragraph shaping** indents first lines and sets the space between paragraphs; at zero spacing it produces indented, manuscript-style paragraphs. Paragraph shaping also enabled the creation of blank lines. Professional style switches this on, and you can switch it off again.

### Drop caps

Drop caps are off by default. Enable **Drop caps** and choose a size from two to six lines.

## Usage

1. Open a Markdown note.
2. Open the Command palette.
3. Run **PDF Export Plus: Export to PDF** using the `Cmd`+`P`/`Ctrl`+`P` command palette.
4. Adjust the options and review every page in the preview.
5. Select **Export PDF** and choose a destination.

Add a hotkey in Settings (`Ctrl`+`,` or `Cmd`+`,`) to export faster. I personally use `Cmd`+`Shift`+`P` to print/export PDFs.

## Installation

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Create `<vault>/.obsidian/plugins/pdf-footnotes/`.
3. Copy all three files into that directory.
4. Reload Obsidian and enable **PDF Export Plus** under **Community plugins**.

The directory name remains `pdf-footnotes` for compatibility with existing installs; the displayed plugin name is PDF Export Plus.

## Settings

| Setting | Purpose |
| --- | --- |
| Page size and margins | Set the physical page geometry. |
| Title heading | Include the frontmatter title or note filename. |
| Paragraph shaping | Indent first lines, set paragraph spacing, and keep blank-line gaps. |
| Drop caps / size | Add and size the opening drop cap. |
| Force professional export | Ignore vault typography and use the professional print preset. |
| Professional typography | Choose font, body size, and line spacing. |
| Page numbers | Show or hide the centered page counter. |
| Print backgrounds | Include theme and element background colors. |
| Footnote font size | Set page-bottom footnote text size. |
| Export folder | Choose the default folder; blank uses Downloads. |
| Open after export | Open the completed PDF automatically. |

## Privacy

Notes are rendered and exported locally. PDF Export Plus does not upload note contents or export files.

## Development

```bash
npm install
npm run build
npm run dev
npm run typecheck
```

(`src/autotest.ts` is a development harness for driving scripted export cycles. It is not wired into the plugin and ships in no release build; see the comment at the top of that file to enable it locally. If using agents, e.g. Claude Code, to contribute code, `autotest.ts` makes iteration much faster for the agent.)

## License

GNU Affero General Public License v3.0 or later.
