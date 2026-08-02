import { PdfFootnotesSettings } from "./settings";

function cssString(value: string): string {
  return `"${value.replace(/[\\"\n\r]/g, " ").trim()}"`;
}

// Every container between .print-root and the text carries a snapshotted
// theme font-family (see snapshotComputedStyles), so `font-family: inherit`
// on a paragraph resolves to the theme font, not the professional one. The
// family has to be named explicitly on each element that could inherit it.
const FONT_BEARING_SELECTOR = `:where(
  div, section, article, header, footer, main, aside, span, p, a,
  ul, ol, li, dl, dd, dt, blockquote, figure, figcaption, hr,
  table, thead, tbody, tfoot, tr, td, th, caption,
  h1, h2, h3, h4, h5, h6, em, strong, i, b, u, s, small, sub, sup, mark, label,
  .callout, .callout-title, .callout-content, .markdown-preview-sizer, .markdown-preview-section
)`;

export function buildPageCss(s: PdfFootnotesSettings): string {
  const bodyFont = `${cssString(s.professionalFontFamily)}, "Times New Roman", Times, serif`;
  const professional = s.professionalExport ? `
    html, body, .print-root {
      color: #111 !important;
      font-family: ${bodyFont} !important;
      font-size: ${s.professionalFontSizePt}pt !important;
      line-height: ${s.professionalLineHeight} !important;
      text-rendering: optimizeLegibility;
      -webkit-font-smoothing: antialiased;
    }
    .print-root ${FONT_BEARING_SELECTOR} {
      font-family: ${bodyFont} !important;
    }
    .print-root :where(p, li, dd, dt, blockquote, td, th, figcaption, .callout-content) {
      color: #111 !important;
      font-size: ${s.professionalFontSizePt}pt !important;
      line-height: ${s.professionalLineHeight} !important;
      letter-spacing: normal !important;
      word-spacing: normal !important;
    }
    .print-root :where(h1, h2, h3, h4, h5, h6) {
      color: #111 !important;
      font-style: normal !important;
      font-weight: 700 !important;
      line-height: 1.2 !important;
      margin: 1.25em 0 0.5em !important;
      break-after: avoid;
    }
    .print-root h1 { font-size: 2em !important; }
    .print-root h2 { font-size: 1.5em !important; }
    .print-root h3 { font-size: 1.25em !important; }
    .print-root :where(ul, ol) { margin: 0 0 1em !important; }
    .print-root :where(pre, code, kbd, samp) {
      font-family: "Courier New", Courier, monospace !important;
      font-size: 0.9em !important;
      line-height: 1.4 !important;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .print-root pre { border: 1px solid #bbb !important; background: #f7f7f7 !important; padding: 0.75em !important; }
    .print-root blockquote { border-left: 2pt solid #777 !important; margin: 1em 0 !important; padding: 0 0 0 1em !important; }
    .print-root table { width: 100%; border-collapse: collapse; margin: 1em 0 !important; }
    .print-root :where(th, td) { border: 0.5pt solid #777 !important; padding: 0.35em 0.5em !important; text-align: left; }
    .print-root th { font-weight: 700 !important; background: #eee !important; }
    .print-root .callout { border: 1px solid #888 !important; border-radius: 0 !important; background: transparent !important; }
    .print-root .callout-title { color: #111 !important; background: #eee !important; font-family: inherit !important; font-weight: 700 !important; }
    .print-root a { color: #111 !important; text-decoration: underline !important; }
    .print-root hr { border: 0 !important; border-top: 0.5pt solid #777 !important; }
    .print-root :where(img, svg, video, canvas, mjx-container) { filter: none !important; }
  ` : "";
  // Turning on the professional style switches this on too (see the export
  // modal), but it stays independently controllable from there.
  const paragraphs = s.applyParagraphStyles ? `
    .print-root p {
      margin: 0 0 ${s.professionalParagraphSpacingEm}em !important;
      text-indent: ${s.professionalParagraphSpacingEm === 0 ? "0.5in" : "0"} !important;
      orphans: 2;
      widows: 2;
    }
    .print-root .markdown-preview-section > p:first-of-type,
    .print-root :where(h1, h2, h3, h4, h5, h6) + p,
    .print-root :where(blockquote, ul, ol, pre, figure, table) + p {
      text-indent: 0 !important;
    }
    .print-root .pdf-para-break {
      display: block !important;
      height: ${s.professionalExport ? s.professionalLineHeight : 1}em;
      break-inside: avoid;
    }
  ` : "";
  const dropCap = s.applyLedeStyles ? `
    .print-root .markdown-preview-section > p:first-of-type::first-letter {
      initial-letter: ${s.dropCapLines};
      -webkit-initial-letter: ${s.dropCapLines};
      font-family: inherit !important;
      font-style: normal !important;
      font-weight: inherit !important;
      color: inherit !important;
      margin-left: 0.1em;
      margin-right: 0.15em;
    }
  ` : "";
  return `
    @page {
      size: ${s.pageSize};
      margin: ${s.marginTop}mm ${s.marginRight}mm ${s.marginBottom}mm ${s.marginLeft}mm;
      ${s.showPageNumbers ? `@bottom-center { content: counter(page) " / " counter(pages); font-size: 10px; color: #555; }` : ""}
      @footnote {
        border-top: 0.5pt solid #999;
        margin-top: 12pt;
        padding-top: 10pt;
      }
    }

    html, body, .print-root {
      margin: 0 !important;
      padding: 0 !important;
      width: auto !important;
      max-width: none !important;
      height: auto !important;
      overflow: visible !important;
      background: #fff !important;
    }
    .markdown-preview-sizer,
    .markdown-preview-section {
      width: auto !important;
      max-width: none !important;
      margin-left: 0 !important;
      margin-right: 0 !important;
      padding-left: 0 !important;
      padding-right: 0 !important;
    }

    .print-root .internal-embed,
    .print-root .image-embed,
    .print-root .media-embed {
      display: block;
      break-inside: avoid;
      text-align: center;
    }
    .print-root img,
    .print-root svg,
    .print-root video {
      max-width: 100%;
      max-height: 120mm;
      height: auto;
      break-inside: avoid;
    }
    .print-root table { max-width: 100%; }
    .print-root ul,
    .print-root ol { padding-inline-start: 2em !important; }
    .print-root .callout,
    .print-root .callout-content,
    .print-root blockquote,
    .print-root ul,
    .print-root ol {
      break-inside: auto;
      overflow: visible;
    }
    .print-root .callout { min-height: 0; }
    .print-root .callout-title { min-height: 0; padding: 0.55em 1.2em; }
    .print-root .callout-icon { display: none; }
    .print-root .callout-content { padding: 0.75em 1.2em; }
    .print-root .callout-content > :first-child { margin-top: 0; }
    .print-root .callout-content > :last-child { margin-bottom: 0; }

    .pdf-footnotes-title {
      margin: 0 0 0.8em !important;
      padding: 0 !important;
      break-after: avoid;
    }
    .pdf-footnote-ref {
      color: inherit !important;
      background: none !important;
      padding: 0 !important;
      font-size: 65% !important;
      font-weight: 600 !important;
      line-height: 0 !important;
      text-decoration: none !important;
      vertical-align: super !important;
    }
    .pdf-footnote-ref sup { color: inherit !important; font: inherit !important; }
    .pdf-footnote {
      float: footnote;
      footnote-display: block;
      footnote-policy: line;
      font-size: ${s.footnoteFontPt}pt !important;
      line-height: 1.4 !important;
      overflow-wrap: anywhere;
    }
    .pdf-footnote-label { font-weight: 600 !important; }
    .pdf-footnote * {
      font-size: inherit !important;
      line-height: inherit !important;
    }
    .pdf-footnote a {
      background: none !important;
      padding-right: 0 !important;
    }
    .external-link {
      background-image: none !important;
      padding-right: 0 !important;
    }
    .pdf-fn-return {
      color: #555 !important;
      background: none !important;
      margin-left: 0.35em;
      padding: 0 !important;
      text-decoration: none !important;
      white-space: nowrap;
    }
    .pdf-fn-return-icon { width: 0.85em; height: 0.85em; vertical-align: -0.12em; }
    .pdf-fn-return-icon,
    .pdf-fn-return-icon path { color: inherit !important; fill: currentColor !important; }
    ${professional}
    ${paragraphs}
    ${dropCap}
  `;
}
