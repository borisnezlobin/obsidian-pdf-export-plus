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
  `;
}
