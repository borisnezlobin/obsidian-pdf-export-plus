import { PdfFootnotesSettings } from "./settings";

export function buildPageCss(s: PdfFootnotesSettings): string {
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
      margin: 0;
      padding: 0;
      width: auto;
      max-width: none;
      height: auto;
      overflow: visible;
      background: #fff;
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
      color: inherit;
      font-size: 65%;
      font-weight: 600;
      line-height: 0;
      text-decoration: none;
      vertical-align: super;
    }
    .pdf-footnote-ref sup { font: inherit; }
    .pdf-footnote {
      float: footnote;
      footnote-display: block;
      footnote-policy: line;
      font-size: ${s.footnoteFontPt}pt !important;
      line-height: 1.4 !important;
      overflow-wrap: anywhere;
    }
    .pdf-footnote-label { font-weight: 600 !important; }
    .pdf-fn-return {
      color: #555;
      margin-left: 0.35em;
      text-decoration: none;
      white-space: nowrap;
    }
    .pdf-fn-return-icon { width: 0.85em; height: 0.85em; vertical-align: -0.12em; }
  `;
}
