// Pagination + PDF via a <webview>, mirroring Better Export PDF's proven
// mechanism, plus Paged.js for page-bottom footnotes.
//
// Layout that makes it all work: the note is rendered inside a `.print` wrapper,
// and Paged.js paginates into a destination that also lives inside `.print`.
// Obsidian's core print CSS hides every non-".print" body child, so keeping the
// pages inside `.print` (a) stops that rule from hiding Paged.js's own container
// (which otherwise crashes it) and (b) lets us apply the theme's @media print
// styling on screen — so the preview paginates exactly like the exported PDF.

import { req } from "./node";
import { PAGEDJS_SOURCE } from "./pagedjs-bundle";
import { buildPageCss } from "./page-css";
import { captureThemeContext, collectPrintStyles, collectStyleSheets, ThemeContext } from "./render";
import { PdfFootnotesSettings } from "./settings";

export type ProgressFn = (stage: string) => void;

export interface PaginationResult {
  webview: any;
  pageCount: number;
  outputText: string;
  removedHidden: string[];
  imageReport: string[];
  footnotePolicyReport: string[];
}

const DOM_READY_TIMEOUT = 15000;
const PAGED_TIMEOUT = 90000;

const PATCH_CSS = `
  body { overflow: auto !important; background: #fff !important; }
  .markdown-preview-view, .markdown-preview-sizer, .print-root {
    width: 100% !important; max-width: none !important; height: auto !important;
  }
  /* A Style Settings / theme snippet can define runaway typography variables —
     e.g. --line-height-customize: 25, applied via
     '.markdown-preview-view { line-height: var(--line-height-customize) }'.
     They resolve correctly in the live app (whose theme <link> sheets scope
     them), but collected flat into the export — where those app:// sheets fail
     to load in the webview — the raw 25 lands on our .markdown-preview-view
     container as a unitless multiplier: 25 × 19px ≈ 480px per line. Pages then
     hold ~2 lines and look almost entirely blank. Pin the line-height variables
     to Obsidian's defaults on the print content so exported text is spaced like
     the reading view. */
  .print-root, .markdown-preview-view {
    --line-height-normal: 1.5 !important;
    --line-height-tight: 1.3 !important;
    --line-height: 1.5 !important;
    --line-height-customize: 1.5 !important;
  }
`;

export async function paginateInWebview(
  host: HTMLElement,
  bodyHtml: string,
  settings: PdfFootnotesSettings,
  onProgress: ProgressFn
): Promise<PaginationResult> {
  const theme = captureThemeContext();
  const styleSheets = collectStyleSheets();
  const printStyles = collectPrintStyles();
  const pageCssText = buildPageCss(settings);

  if (settings.debugDump) {
    dumpDebugHtml(bodyHtml, theme, styleSheets, printStyles, pageCssText, settings);
  }

  onProgress("Opening preview…");
  const webview = document.createElement("webview") as any;
  webview.src = "app://obsidian.md/help.html";
  (webview as any).nodeintegration = true;
  webview.setAttribute("nodeintegration", "on");
  // No fixed height here — the modal sets it to the paginated content height so
  // the (fixed-height) host scrolls. Start tall enough for Paged.js to measure.
  webview.setAttribute("style", "width: 100%; height: 800px; display: block; border: none; background: #fff;");
  host.appendChild(webview);

  webview.addEventListener("console-message", (e: any) =>
    console.log("[PDF Footnotes webview]", e.message)
  );

  await once(webview, "dom-ready", DOM_READY_TIMEOUT, "The preview page didn't load.");

  onProgress("Applying your theme…");
  await webview.executeJavaScript(setupScript(bodyHtml, theme, pageCssText));
  for (const css of [...styleSheets, ...printStyles, PATCH_CSS]) {
    try {
      await webview.insertCSS(css);
    } catch (e) {
      console.warn("[PDF Footnotes] insertCSS failed for one sheet", e);
    }
  }

  // Remove elements that are hidden under the FULL applied theme (class-based
  // display:none, not just inline styles). A display:none element has a null
  // offsetParent, which crashes Paged.js's layout pass and drops surrounding
  // content — the real cause of the missing paragraphs. Must run here, in the
  // webview, where every Obsidian/theme rule is actually in effect.
  onProgress("Preparing content…");
  // Only remove LEAF hidden elements — never a hidden element that still
  // contains visible text/images (a theme can set a wrapper display:none while
  // a child overrides it back to visible; removing the wrapper would delete
  // real content). Report exactly what was removed for debugging.
  const removedReport = await webview.executeJavaScript(
    `(function () {
       var src = document.getElementById('pf-src');
       if (!src) return [];
       var nodes = src.querySelectorAll('*'), rm = [], report = [];
       for (var i = 0; i < nodes.length; i++) {
         var el = nodes[i];
         try {
           if (el.classList && el.classList.contains('pdf-footnote-data')) continue;
           if (getComputedStyle(el).display !== 'none') continue;
           // keep it if any descendant is actually visible
           var kids = el.querySelectorAll('*'), visibleChild = false;
           for (var j = 0; j < kids.length; j++) { if (getComputedStyle(kids[j]).display !== 'none') { visibleChild = true; break; } }
           if (visibleChild) continue;
           rm.push(el);
           report.push(el.tagName + '.' + (el.className && el.className.toString ? el.className.toString().slice(0,60) : '') + ' "' + (el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,50) + '"');
         } catch (e) {}
       }
       rm.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
       return report;
     })();`
  );
  console.log(`[PDF Footnotes] removed ${removedReport.length} hidden element(s):`, removedReport);

  onProgress("Injecting Paged.js…");
  await webview.executeJavaScript(PAGEDJS_SOURCE);

  // Paginate the source into the `.print` destination. Explicit stylesheets so
  // Paged.js parses only our page CSS (Obsidian's :is() selectors would crash
  // it); the theme still applies visually.
  //
  // CRITICAL: wait for every image to DECODE and for fonts to load before
  // paginating. Paged.js measures element geometry; if it runs while a (large
  // data-URI) image is still decoding, that image has no layout box, its
  // offsetParent is null, and Paged.js crashes mid-layout — silently dropping
  // the surrounding content. This was the real cause of missing paragraphs and
  // vanished images.
  onProgress("Loading images…");
  await webview.executeJavaScript(
    `(async function () {
       var src = document.getElementById('pf-src');
       var imgs = Array.prototype.slice.call(src.querySelectorAll('img'));
       await Promise.all(imgs.map(function (im) {
         if (im.complete && im.naturalWidth > 0) return Promise.resolve();
         if (im.decode) return im.decode().catch(function () {});
         return new Promise(function (r) { im.onload = im.onerror = r; });
       }));
       if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) {} }
     })();`
  );

  onProgress("Paginating with Paged.js…");
  await webview.executeJavaScript(
    `(function () {
       var src = document.getElementById('pf-src');
       var dest = document.getElementById('pf-dest');
       window.__manualFootnotes = Array.prototype.slice.call(src.querySelectorAll('[data-pdf-footnote]')).map(function (n) {
         return {
           id: n.getAttribute('data-pdf-footnote') || '',
           html: n.innerHTML || ''
         };
       });
       function footnoteData(id) {
         for (var i = 0; i < window.__manualFootnotes.length; i++) {
           if (window.__manualFootnotes[i].id === id) return window.__manualFootnotes[i];
         }
         return null;
       }
       function placeManualFootnotes() {
         var pages = Array.prototype.slice.call(dest.querySelectorAll('.pagedjs_page'));
         var buckets = pages.map(function () { return []; });
         var seen = {};
         Array.prototype.slice.call(dest.querySelectorAll('[data-pdf-footnote-ref]')).forEach(function (ref) {
           var id = ref.getAttribute('data-pdf-footnote-ref') || '';
           var data = footnoteData(id);
           var page = ref.closest('.pagedjs_page');
           var pageIndex = pages.indexOf(page);
           if (!data || pageIndex < 0 || seen[id]) return;
           seen[id] = true;
           buckets[pageIndex].push(data);
         });
         buckets.forEach(function (notes, pageIndex) {
           if (!notes.length) return;
           notes.forEach(function (data) {
             var target = document.createElement('span');
             target.className = 'pdf-footnote-target';
             target.id = 'pdf-fn-note-' + data.id;
             pages[pageIndex].appendChild(target);
           });
           var wrap = document.createElement('div');
           wrap.className = 'pdf-manual-footnotes';
           notes.forEach(function (data) {
             var item = document.createElement('div');
             item.className = 'pdf-manual-footnote';
             item.setAttribute('data-pdf-manual-footnote', data.id);
             var marker = document.createElement('span');
             marker.className = 'pdf-manual-footnote-marker';
             marker.textContent = data.id + '.';
             var body = document.createElement('span');
             body.className = 'pdf-manual-footnote-body';
             body.innerHTML = data.html;
             item.appendChild(marker);
             item.appendChild(body);
             wrap.appendChild(item);
           });
           pages[pageIndex].appendChild(wrap);
         });
       }
       function clearManualDecorations() {
         Array.prototype.slice.call(dest.querySelectorAll('.pdf-manual-footnotes, .pdf-manual-page-number, .pdf-footnote-target')).forEach(function (n) {
           if (n.parentNode) n.parentNode.removeChild(n);
         });
       }
       function placeManualPageNumbers() {
         if (!${settings.showPageNumbers ? "true" : "false"}) return;
         var pages = Array.prototype.slice.call(dest.querySelectorAll('.pagedjs_page'));
         pages.forEach(function (page, index) {
           var num = document.createElement('div');
           num.className = 'pdf-manual-page-number';
           num.textContent = (index + 1) + ' / ' + pages.length;
           page.appendChild(num);
         });
       }
       function pageSection(page) {
         return page && page.querySelector('.markdown-preview-sizer, .markdown-preview-section');
       }
       function clearSection(section) {
         if (!section) return;
         while (section.firstChild) section.removeChild(section.firstChild);
       }
       function ensureNextPage(pages, index) {
         if (index + 1 < pages.length) return pages[index + 1];
         var clone = pages[index].cloneNode(true);
         clone.id = 'page-' + (pages.length + 1);
         clone.setAttribute('data-page-number', String(pages.length + 1));
         Array.prototype.slice.call(clone.querySelectorAll('[id]')).forEach(function (n) {
           if (n !== clone) n.removeAttribute('id');
         });
         Array.prototype.slice.call(clone.querySelectorAll('.pdf-manual-footnotes, .pdf-manual-page-number, .pdf-footnote-target')).forEach(function (n) {
           if (n.parentNode) n.parentNode.removeChild(n);
         });
         clearSection(pageSection(clone));
         pages[index].parentNode.appendChild(clone);
         pages.push(clone);
         return clone;
       }
       function pageSafeBottom(page) {
         var pr = page.getBoundingClientRect();
         // Chromium's printed page clips before Paged.js's on-screen content
         // box in a few split-block cases. Use a conservative physical page
         // boundary, then further shrink it for footnotes/page numbers.
         var safe = pr.bottom - 120;
         var area = page.querySelector('.pdf-manual-footnotes');
         if (area) safe = Math.min(safe, area.getBoundingClientRect().top - 16);
         var pageNumber = page.querySelector('.pdf-manual-page-number');
         if (pageNumber) safe = Math.min(safe, pageNumber.getBoundingClientRect().top - 24);
         return safe;
       }
       function moveCollidingBlocks() {
         var pages = Array.prototype.slice.call(dest.querySelectorAll('.pagedjs_page'));
         var moved = false;
         for (var i = 0; i < pages.length; i++) {
           var page = pages[i];
           var safeBottom = pageSafeBottom(page);
           var section = pageSection(page);
           if (!section) continue;
           var guard = 0;
           while (guard++ < 12) {
             var children = Array.prototype.slice.call(section.children).filter(function (child) {
               if (child.classList && (child.classList.contains('pdf-footnote-data') || child.classList.contains('pdf-footnote-target'))) return false;
               var r = child.getBoundingClientRect();
               return r.height > 0 && r.bottom > safeBottom;
             });
             if (!children.length) break;
             var nextPage = ensureNextPage(pages, i);
             var nextSection = pageSection(nextPage);
             if (!nextSection) break;
             nextSection.insertBefore(children[children.length - 1], nextSection.firstChild);
             moved = true;
           }
         }
         return moved;
       }
       function layoutManualDecorations() {
         for (var i = 0; i < 8; i++) {
           clearManualDecorations();
           placeManualFootnotes();
           placeManualPageNumbers();
           if (!moveCollidingBlocks()) break;
         }
         clearManualDecorations();
         placeManualFootnotes();
         placeManualPageNumbers();
       }
       window.PagedPolyfill.preview(src, [{ "pdf-footnotes.css": window.__pdfPageCss }], dest)
         .then(function (f) {
           layoutManualDecorations();
           if (src) src.remove();
           window.__pagedDone = true;
           window.__pagedPages = dest.querySelectorAll('.pagedjs_page').length;
         })
         .catch(function (e) { window.__pagedError = String(e && e.message ? e.message : e); });
     })();`
  );

  const pageCount = await waitForPaged(webview);

  // Grab the text that actually made it onto the pages, so the caller can warn
  // if Paged.js dropped content (it can choke on complex tables/floats).
  let outputText = "";
  try {
    outputText = await webview.executeJavaScript(
      `(function(){var d=document.getElementById('pf-dest');return d?(d.textContent||'').replace(/\\s+/g,' ').trim():'';})()`
    );
  } catch {
    /* leave "" — treated as "unknown", no false warning */
  }

  // Per-image status in the final paginated output: does it survive, and where?
  let imageReport: string[] = [];
  try {
    imageReport = await webview.executeJavaScript(
      `(function () {
         var d = document.getElementById('pf-dest');
         var pages = Array.prototype.slice.call(d.querySelectorAll('.pagedjs_page'));
         var imgs = Array.prototype.slice.call(d.querySelectorAll('img'));
         return imgs.map(function (im) {
           var r = im.getBoundingClientRect();
           var cs = getComputedStyle(im);
           var pageIdx = -1, overflow = '?';
           var pc = im.closest('.pagedjs_page_content');
           if (pc) {
             var pr = pc.getBoundingClientRect();
             overflow = (r.bottom > pr.bottom + 2) ? ('OVERFLOWS bottom by ' + Math.round(r.bottom - pr.bottom) + 'px') :
                        (r.top < pr.top - 2) ? ('above top by ' + Math.round(pr.top - r.top) + 'px') : 'in-box';
             var pg = im.closest('.pagedjs_page');
             pageIdx = pages.indexOf(pg) + 1;
           }
           return (im.getAttribute('alt') || im.className || '(img)').slice(0,36) +
             ' | page ' + pageIdx + ' | ' + Math.round(r.width) + 'x' + Math.round(r.height) +
             ' | ' + overflow +
             ' | display=' + cs.display + ' visibility=' + cs.visibility + ' opacity=' + cs.opacity;
         });
       })();`
    );
  } catch {
    /* ignore */
  }

  let footnotePolicyReport: string[] = [];
  try {
    footnotePolicyReport = await webview.executeJavaScript(
      `(function () {
         var d = document.getElementById('pf-dest');
         var pages = Array.prototype.slice.call(d.querySelectorAll('.pagedjs_page'));
         return Array.prototype.slice.call(d.querySelectorAll('[data-pdf-manual-footnote]')).map(function (fn, i) {
           var pg = fn.closest('.pagedjs_page');
           var r = fn.getBoundingClientRect();
           var area = fn.closest('.pdf-manual-footnotes');
           var ar = area ? area.getBoundingClientRect() : null;
           var content = pg ? pg.querySelector('.pagedjs_page_content') : null;
           var cr = content ? content.getBoundingClientRect() : null;
           var overlap = ar && cr && cr.bottom > ar.top - 6 ? Math.round(cr.bottom - ar.top + 6) : 0;
           return '#' + (i + 1) + ' page ' + (pages.indexOf(pg) + 1) +
             ' manual=true' +
             (overlap > 0 ? ' OVERLAPS body by ' + overlap + 'px' : '') +
             ' text="' + (fn.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80) + '"';
         });
       })();`
    );
  } catch {
    /* ignore */
  }

  if (settings.debugDump) {
    try {
      const paginatedHtml: string = await webview.executeJavaScript(
        `(function(){var d=document.getElementById('pf-dest');var h=d?d.outerHTML:'';return h.replace(/data:[^"']{40,}/g,'data:IMG');})()`
      );
      const fs = req("fs");
      const os = req("os");
      const path = req("path");
      fs.writeFileSync(
        path.join(os.homedir(), "Downloads", "pdf-footnotes-paginated.html"),
        `<!doctype html><meta charset="utf-8"><body>${paginatedHtml}</body>`,
        "utf8"
      );
      console.log("[PDF Footnotes] wrote paginated structure to ~/Downloads/pdf-footnotes-paginated.html");
    } catch (e) {
      console.warn("[PDF Footnotes] paginated dump failed", e);
    }
  }

  onProgress(`Preview ready — ${pageCount} page${pageCount === 1 ? "" : "s"}.`);
  return { webview, pageCount, outputText, removedHidden: removedReport, imageReport, footnotePolicyReport };
}

export async function printWebviewToPdf(
  webview: any,
  settings: PdfFootnotesSettings
): Promise<Uint8Array> {
  // Paged.js has already built full paper-sized page boxes that include the
  // requested @page margins internally. Chromium must print those boxes with
  // zero additional print margin; otherwise it clips/reflows the preview pages
  // and text that is present in the DOM can disappear from the final PDF.
  await webview.insertCSS(buildPrintStageCss(settings));
  const data = await webview.printToPDF({
    pageSize: settings.pageSize,
    printBackground: settings.printBackground,
    preferCSSPageSize: true,
    scale: 1,
    margins: { marginType: "none" },
  });
  return data as Uint8Array;
}

function buildPrintStageCss(settings: PdfFootnotesSettings): string {
  return `
    @page {
      size: ${settings.pageSize};
      margin: 0;
    }
    @media print {
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        background: #fff !important;
      }
      #pf-src {
        display: none !important;
      }
      #pf-dest {
        display: block !important;
      }
      .pagedjs_page {
        margin: 0 !important;
        box-shadow: none !important;
        break-after: page;
        page-break-after: always;
      }
      .pagedjs_page:last-child {
        break-after: auto;
        page-break-after: auto;
      }
    }
  `;
}

// Write a self-contained copy of exactly what the print engine paginates, so
// layout problems can be reproduced and inspected outside Obsidian. Includes
// Paged.js so opening the file in a browser re-runs the same pagination.
function dumpDebugHtml(
  bodyHtml: string,
  theme: ThemeContext,
  styleSheets: string[],
  printStyles: string[],
  pageCss: string,
  settings: PdfFootnotesSettings
): void {
  try {
    const fs = req("fs");
    const os = req("os");
    const path = req("path");
    const imgCount = (bodyHtml.match(/<img/g) || []).length;
    const dataImgCount = (bodyHtml.match(/<img[^>]+src="data:/g) || []).length;
    const appImgCount = (bodyHtml.match(/<img[^>]+src="app:/g) || []).length;
    // Neutralize any stray "</style>"/"</script>" inside the collected CSS so it
    // can't break out of the <style> tag and corrupt the file's HTML parse.
    const safeCss = (css: string) => css.replace(/<\//g, "<\\/");
    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<!-- PDF Footnotes debug dump. images total=${imgCount} data-uri=${dataImgCount} app-url=${appImgCount} -->
<style>${safeCss(styleSheets.join("\n"))}</style>
<style>${safeCss(printStyles.join("\n"))}</style>
<style>${safeCss(pageCss)}</style>
<style>${safeCss(buildPrintStageCss(settings))}</style>
</head>
<body class="${theme.bodyClass} theme-light" style="${theme.bodyStyle}">
<div class="print"><div id="pf-src">${bodyHtml}</div><div id="pf-dest"></div></div>
<script>
  window.PagedConfig = { auto: false };
  window.__pdfPageCss = ${JSON.stringify(pageCss)};
  function placeManualFootnotes(src, dest) {
    var data = Array.prototype.slice.call(src.querySelectorAll('[data-pdf-footnote]')).map(function (n) {
      return { id: n.getAttribute('data-pdf-footnote') || '', html: n.innerHTML || '' };
    });
    function findData(id) {
      for (var i = 0; i < data.length; i++) if (data[i].id === id) return data[i];
      return null;
    }
    var pages = Array.prototype.slice.call(dest.querySelectorAll('.pagedjs_page'));
    var buckets = pages.map(function () { return []; });
    var seen = {};
    Array.prototype.slice.call(dest.querySelectorAll('[data-pdf-footnote-ref]')).forEach(function (ref) {
      var id = ref.getAttribute('data-pdf-footnote-ref') || '';
      var item = findData(id);
      var page = ref.closest('.pagedjs_page');
      var pageIndex = pages.indexOf(page);
      if (!item || pageIndex < 0 || seen[id]) return;
      seen[id] = true;
      buckets[pageIndex].push(item);
    });
    buckets.forEach(function (notes, pageIndex) {
      if (!notes.length) return;
      notes.forEach(function (note) {
        var target = document.createElement('span');
        target.className = 'pdf-footnote-target';
        target.id = 'pdf-fn-note-' + note.id;
        pages[pageIndex].appendChild(target);
      });
      var wrap = document.createElement('div');
      wrap.className = 'pdf-manual-footnotes';
      notes.forEach(function (note) {
        var item = document.createElement('div');
        item.className = 'pdf-manual-footnote';
        item.setAttribute('data-pdf-manual-footnote', note.id);
        var marker = document.createElement('span');
        marker.className = 'pdf-manual-footnote-marker';
        marker.textContent = note.id + '.';
        var body = document.createElement('span');
        body.className = 'pdf-manual-footnote-body';
        body.innerHTML = note.html;
        item.appendChild(marker);
        item.appendChild(body);
        wrap.appendChild(item);
      });
      pages[pageIndex].appendChild(wrap);
    });
  }
  function clearManualDecorations(dest) {
    Array.prototype.slice.call(dest.querySelectorAll('.pdf-manual-footnotes, .pdf-manual-page-number, .pdf-footnote-target')).forEach(function (n) {
      if (n.parentNode) n.parentNode.removeChild(n);
    });
  }
  function placeManualPageNumbers(dest) {
    var pages = Array.prototype.slice.call(dest.querySelectorAll('.pagedjs_page'));
    pages.forEach(function (page, index) {
      var num = document.createElement('div');
      num.className = 'pdf-manual-page-number';
      num.textContent = (index + 1) + ' / ' + pages.length;
      page.appendChild(num);
    });
  }
  function pageSection(page) {
    return page && page.querySelector('.markdown-preview-sizer, .markdown-preview-section');
  }
  function clearSection(section) {
    if (!section) return;
    while (section.firstChild) section.removeChild(section.firstChild);
  }
  function ensureNextPage(pages, index) {
    if (index + 1 < pages.length) return pages[index + 1];
    var clone = pages[index].cloneNode(true);
    clone.id = 'page-' + (pages.length + 1);
    clone.setAttribute('data-page-number', String(pages.length + 1));
    Array.prototype.slice.call(clone.querySelectorAll('[id]')).forEach(function (n) {
      if (n !== clone) n.removeAttribute('id');
    });
    Array.prototype.slice.call(clone.querySelectorAll('.pdf-manual-footnotes, .pdf-manual-page-number, .pdf-footnote-target')).forEach(function (n) {
      if (n.parentNode) n.parentNode.removeChild(n);
    });
    clearSection(pageSection(clone));
    pages[index].parentNode.appendChild(clone);
    pages.push(clone);
    return clone;
  }
  function pageSafeBottom(page) {
    var pr = page.getBoundingClientRect();
    var safe = pr.bottom - 120;
    var area = page.querySelector('.pdf-manual-footnotes');
    if (area) safe = Math.min(safe, area.getBoundingClientRect().top - 16);
    var pageNumber = page.querySelector('.pdf-manual-page-number');
    if (pageNumber) safe = Math.min(safe, pageNumber.getBoundingClientRect().top - 24);
    return safe;
  }
  function moveCollidingBlocks(dest) {
    var pages = Array.prototype.slice.call(dest.querySelectorAll('.pagedjs_page'));
    var moved = false;
    for (var i = 0; i < pages.length; i++) {
      var page = pages[i];
      var safeBottom = pageSafeBottom(page);
      var section = pageSection(page);
      if (!section) continue;
      var guard = 0;
      while (guard++ < 12) {
        var children = Array.prototype.slice.call(section.children).filter(function (child) {
          if (child.classList && (child.classList.contains('pdf-footnote-data') || child.classList.contains('pdf-footnote-target'))) return false;
          var r = child.getBoundingClientRect();
          return r.height > 0 && r.bottom > safeBottom;
        });
        if (!children.length) break;
        var nextPage = ensureNextPage(pages, i);
        var nextSection = pageSection(nextPage);
        if (!nextSection) break;
        nextSection.insertBefore(children[children.length - 1], nextSection.firstChild);
        moved = true;
      }
    }
    return moved;
  }
  function layoutManualDecorations(src, dest) {
    for (var i = 0; i < 8; i++) {
      clearManualDecorations(dest);
      placeManualFootnotes(src, dest);
      ${settings.showPageNumbers ? "placeManualPageNumbers(dest);" : ""}
      if (!moveCollidingBlocks(dest)) break;
    }
    clearManualDecorations(dest);
    placeManualFootnotes(src, dest);
    ${settings.showPageNumbers ? "placeManualPageNumbers(dest);" : ""}
  }
  window.addEventListener("load", function () {
    var src = document.getElementById("pf-src"), dest = document.getElementById("pf-dest");
    new window.Paged.Previewer().preview(src, [{ "pdf-footnotes.css": window.__pdfPageCss }], dest)
      .then(function () { layoutManualDecorations(src, dest); if (src) src.remove(); });
  });
</script>
<script>${PAGEDJS_SOURCE}</script>
</body>
</html>`;
    const outPath = path.join(os.homedir(), "Downloads", "pdf-footnotes-debug.html");
    fs.writeFileSync(outPath, html, "utf8");
    console.log(
      `[PDF Footnotes] debug dump written to ${outPath} (images: ${imgCount} total, ${dataImgCount} inlined, ${appImgCount} app:// unresolved)`
    );
  } catch (e) {
    console.warn("[PDF Footnotes] debug dump failed", e);
  }
}

// Total height of the paginated pages, so the modal can size the webview to its
// content and let the surrounding (fixed-height) host scroll through all pages.
export async function measureContentHeight(webview: any): Promise<number> {
  try {
    return await webview.executeJavaScript(
      `(function(){var d=document.getElementById('pf-dest')||document.body;return Math.ceil(d.getBoundingClientRect().height)+24;})()`
    );
  } catch {
    return 0;
  }
}

function setupScript(bodyHtml: string, theme: ThemeContext, pageCss: string): string {
  const dec = (s: string) => `decodeURIComponent("${encodeURIComponent(s)}")`;
  // Bring the main window's head (theme/snippet <link> styles) and body theme
  // classes so CSS variables resolve, force light theme, and lay the note out
  // inside a `.print` wrapper with a separate paginate destination.
  return `
    (function () {
      window.PagedConfig = { auto: false };
      window.__pdfPageCss = ${dec(pageCss)};
      try { document.head.innerHTML = ${dec(theme.headHtml)}; } catch (e) { console.warn("head copy failed", e); }
      document.body.setAttribute("class", ${dec(theme.bodyClass)});
      document.body.setAttribute("style", ${dec(theme.bodyStyle)});
      document.body.classList.add("theme-light");
      document.body.classList.remove("theme-dark");
      document.body.innerHTML =
        '<div class="print"><div id="pf-src">' + ${dec(bodyHtml)} + '</div><div id="pf-dest"></div></div>';
    })();
  `;
}

function waitForPaged(webview: any): Promise<number> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = setInterval(async () => {
      if (Date.now() - started > PAGED_TIMEOUT) {
        clearInterval(poll);
        reject(new Error("Paged.js timed out while laying out the pages."));
        return;
      }
      let state: string;
      try {
        state = await webview.executeJavaScript(
          `window.__pagedError ? ('err:' + window.__pagedError) : (window.__pagedDone ? ('ok:' + (window.__pagedPages || 0)) : 'wait')`
        );
      } catch {
        return; // transient; keep polling
      }
      if (state.startsWith("ok:")) {
        clearInterval(poll);
        resolve(Number(state.slice(3)) || 0);
      } else if (state.startsWith("err:")) {
        clearInterval(poll);
        reject(new Error("Paged.js failed: " + state.slice(4)));
      }
    }, 350);
  });
}

function once(el: any, event: string, timeoutMs: number, timeoutMsg: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      el.removeEventListener(event, handler);
      reject(new Error(timeoutMsg));
    }, timeoutMs);
    const handler = () => {
      clearTimeout(timer);
      el.removeEventListener(event, handler);
      resolve();
    };
    el.addEventListener(event, handler);
  });
}
