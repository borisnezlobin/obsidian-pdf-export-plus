import { PdfFootnotesSettings } from "./settings";

// The CSS that turns the rendered note into a paginated document with
// page-bottom footnotes. This is the piece Paged.js acts on: `float: footnote`
// moves each note into the page's @footnote area, and the @page margin box
// reproduces Better Export PDF's "page / total" footer.
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
      margin: ${s.marginTop}mm ${s.marginRight}mm ${Math.max(s.marginBottom, 20)}mm ${s.marginLeft}mm;
      ${footer}
      @footnote {
        border-top: 0.5pt solid #999;
        margin-top: 10pt;
        padding-top: 8pt;
        /* Keep the footnote area clear of the page-number footer below it. */
        margin-bottom: 6pt;
      }
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

    /* Push a footnote's reference to the next page rather than clipping the
       footnote when it doesn't fit the current page's footnote area. */
    .print-root {
      footnote-policy: line;
    }

    .print-root .footnote {
      float: footnote;
    }

    /* CRITICAL: Paged.js MOVES each footnote out of .print-root into its own
       .pagedjs_footnote_area, so footnote text must be sized THERE — a rule
       scoped to .print-root never reaches it, and the footnote renders at full
       body size (huge, and it overflows/clips). Force the small size on the
       Paged.js footnote containers and everything inside them. */
    .pagedjs_footnote_area,
    .pagedjs_footnote_content,
    .pagedjs_footnote_inner_content,
    .pagedjs_footnote_area * {
      font-size: ${s.footnoteFontPt}pt !important;
      line-height: 1.4 !important;
      overflow-wrap: anywhere;
    }
    /* A little breathing room between the rule and the first footnote. */
    .pagedjs_footnote_content {
      padding-top: 2pt;
    }
    ::footnote-call {
      font-size: 65%;
      vertical-align: super;
      line-height: 0;
    }
    ::footnote-marker {
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
