import { PdfFootnotesSettings } from "./settings";

const MANUAL_FOOTNOTE_RESERVE_MM = 54;
const MANUAL_FOOTNOTE_GAP_MM = 5;

// The CSS that turns the rendered note into a paginated document. Paged.js is
// used for page breaks, but footnotes are placed manually after pagination; its
// native float: footnote support is too fragile with Obsidian/theme CSS.
export function buildPageCss(s: PdfFootnotesSettings): string {
  const footer = s.showPageNumbers
    ? `@bottom-center {
         content: counter(page) " / " counter(pages);
         font-size: 10px;
         color: #555;
       }`
    : "";

  return `
    @page {
      size: ${s.pageSize};
      margin: ${s.marginTop}mm ${s.marginRight}mm ${Math.max(
        s.marginBottom + MANUAL_FOOTNOTE_RESERVE_MM,
        20
      )}mm ${s.marginLeft}mm;
      ${footer}
    }

    /* Neutralize the app's workspace layout so the note flows as a document. */
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      display: block;
      overflow: visible;
    }
    .print-root {
      width: auto !important;
      max-width: none !important;
      height: auto !important;
      padding: 0 !important;
      margin: 0 !important;
      overflow: visible !important;
    }
    /* Image embeds must be BLOCK so Paged.js can move a too-tall one to the next
       page instead of letting it overflow the page bottom (which clips it in
       print). Inline embeds — MarkdownRenderer's default — can't be moved. */
    .print-root .internal-embed,
    .print-root .image-embed,
    .print-root .media-embed {
      display: block;
      break-inside: avoid;
      text-align: center;
    }

    /* Keep images well shorter than a page so one ALWAYS fits in the space left
       after other content and a footnote area on the same page. When an image
       overflows the page box, Chromium's printToPDF drops it entirely (it
       renders blank) — so a conservative cap is what actually makes images
       appear. break-inside stops them splitting mid-image. */
    .print-root img,
    .print-root svg,
    .print-root video {
      max-width: 100%;
      max-height: 150mm;
      height: auto;
      break-inside: avoid;
    }
    .print-root table {
      max-width: 100%;
    }

    /* Themes often style callouts/quotes as boxed blocks. They must be allowed
       to split; otherwise a callout that starts near the page bottom can be
       clipped instead of continuing on the next page. */
    .print-root .callout,
    .print-root .callout-content,
    .print-root blockquote {
      break-inside: auto !important;
      page-break-inside: auto !important;
      overflow: visible !important;
    }

    /* Let lists break across pages, but keep each item whole — Paged.js can
       drop a list item that straddles a page boundary otherwise. */
    .print-root ul,
    .print-root ol {
      break-inside: auto;
    }
    .print-root li {
      break-inside: avoid;
    }

    .pdf-footnotes-title {
      margin: 0 0 1.2em;
    }

    .pdf-footnote-ref {
      font-size: 65%;
      vertical-align: super;
      line-height: 0;
      font-weight: 600;
    }

    .pdf-footnote-data {
      display: none !important;
    }

    .pdf-manual-footnotes {
      position: absolute;
      left: var(--pagedjs-margin-left);
      right: var(--pagedjs-margin-right);
      bottom: ${Math.max(s.marginBottom, 10)}mm;
      max-height: ${MANUAL_FOOTNOTE_RESERVE_MM - MANUAL_FOOTNOTE_GAP_MM}mm;
      border-top: 0.5pt solid #999;
      padding-top: 8pt;
      overflow: hidden;
      box-sizing: border-box;
    }

    .pdf-manual-footnote,
    .pdf-manual-footnote * {
      font-size: ${s.footnoteFontPt}pt !important;
      line-height: 1.4 !important;
      overflow-wrap: anywhere;
    }

    .pdf-manual-footnote {
      display: block;
      margin: 0 0 4pt;
    }

    .pdf-manual-footnote-marker {
      font-weight: 600;
      padding-right: 0.3em;
    }

    /* The "return to reference" link at the end of each footnote. */
    .pdf-fn-anchor {
      /* zero-width marker in the body; the return link jumps here */
      display: inline;
    }
    .pdf-fn-return {
      text-decoration: none;
      margin-left: 0.35em;
      color: #555; /* same grey as the page-number footer */
      white-space: nowrap;
    }
    .pdf-fn-return-icon {
      width: 0.85em;
      height: 0.85em;
      vertical-align: -0.12em;
    }
  `;
}
