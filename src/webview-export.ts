import { PDFDocument, PDFName, PDFNumber, PDFString } from "pdf-lib";
import { req } from "./node";
import { buildPageCss } from "./page-css";
import { PdfFootnotesSettings } from "./settings";
import { VIVLIOSTYLE_SOURCE } from "./vivliostyle-bundle";

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
const LAYOUT_TIMEOUT = 30000;

export async function paginateInWebview(
  host: HTMLElement,
  bodyHtml: string,
  settings: PdfFootnotesSettings,
  onProgress: ProgressFn,
): Promise<PaginationResult> {
  const authorStyles = [buildPageCss(settings)];

  onProgress("Opening preview...");
  const webview = document.createElement("webview") as any;
  webview.src = "data:text/html;charset=utf-8," + encodeURIComponent(
    "<!doctype html><html><head><meta charset=utf-8></head><body><div id=viv-viewport data-vivliostyle-viewer-viewport></div></body></html>",
  );
  webview.setAttribute(
    "style",
    "position:absolute;inset:0;width:100%;height:100%;display:flex;border:0;background:#aaa;",
  );
  host.appendChild(webview);
  webview.addEventListener("console-message", (event: any) => {
    if (event.message === "-- time slice --") return;
    console.log("[PDF Footnotes webview]", event.message);
  });
  await once(webview, "dom-ready", DOM_READY_TIMEOUT, "The preview page didn't load.");
  if (typeof webview.setZoomFactor === "function") webview.setZoomFactor(1);

  onProgress("Preparing document...");
  const payload = {
    bodyHtml,
    styles: authorStyles,
    title: document.title,
  };
  await webview.executeJavaScript(`
    (function () {
      var payload = JSON.parse(decodeURIComponent("${encodeURIComponent(JSON.stringify(payload))}"));
      window.__pdfPayload = payload;
      window.__vivDone = false;
      window.__vivError = "";
      document.documentElement.style.height = "100%";
      var viewport = document.getElementById("viv-viewport");
      viewport.style.position = "absolute";
      viewport.style.inset = "0";
      viewport.style.overflow = "auto";
    })();
  `);

  onProgress("Loading Vivliostyle...");
  await webview.executeJavaScript(VIVLIOSTYLE_SOURCE);

  onProgress("Paginating with Vivliostyle...");
  await webview.executeJavaScript(`
    (function () {
      try {
        var payload = window.__pdfPayload;
        var source = document.implementation.createHTMLDocument(payload.title || "PDF");
        source.documentElement.setAttribute("lang", document.documentElement.lang || "en");
        source.body.innerHTML = payload.bodyHtml;

        var viewport = document.getElementById("viv-viewport");
        var viewer = new window.VivliostyleCore.CoreViewer(
          { viewportElement: viewport, window: window, debug: false },
          {
            autoResize: false,
            renderAllPages: true,
            pageViewMode: window.VivliostyleCore.PageViewMode.SINGLE_PAGE,
            fitToScreen: false,
            allowScripts: false,
            pixelRatio: 1
          }
        );
        window.__vivViewer = viewer;
        viewer.addListener("error", function (event) {
          var content = event && event.content;
          window.__vivError = String(content && (content.error || content.messages) || "Vivliostyle layout failed");
        });
        viewer.addListener("readystatechange", function () {
          if (viewer.readyState !== window.VivliostyleCore.ReadyState.COMPLETE) return;
          window.__vivPages = viewer.getPageSizes().length;
          window.__vivDone = true;
        });
        viewer.loadDocument(
          { url: location.href },
          {
            documentObject: source,
            authorStyleSheet: payload.styles.map(function (text) { return { text: text }; })
          }
        );
      } catch (error) {
        window.__vivError = String(error && error.stack || error);
      }
    })();
  `);

  const pageCount = await waitForLayout(webview);
  const outputText = await safeEval(
    webview,
    `(document.getElementById("viv-viewport").textContent || "").replace(/\\s+/g, " ").trim()`,
    "",
  );
  const imageReport = await safeEval<string[]>(
    webview,
    `Array.prototype.slice.call(document.querySelectorAll("#viv-viewport img")).map(function (img) {
      var r = img.getBoundingClientRect();
      return (img.alt || "(img)").slice(0, 36) + " | " + Math.round(r.width) + "x" + Math.round(r.height);
    })`,
    [],
  );
  const footnotePolicyReport = await safeEval<string[]>(
    webview,
    `Array.prototype.slice.call(document.querySelectorAll("#viv-viewport .-vivliostyle-footnote-content, #viv-viewport [role=doc-footnote]")).map(function (note, i) {
      return "#" + (i + 1) + " native=true text=" + JSON.stringify((note.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 80));
    })`,
    [],
  );

  if (settings.debugDump) writeDebugDump(bodyHtml, authorStyles, pageCount);
  onProgress(`Preview ready - ${pageCount} page${pageCount === 1 ? "" : "s"}.`);
  return { webview, pageCount, outputText, removedHidden: [], imageReport, footnotePolicyReport };
}

interface PdfDestination {
  id: string;
  pageIndex: number;
  xPt: number;
  yTopPt: number;
}

// Print preparation flattens the interactive Vivliostyle viewer into a plain
// stack of fixed-size pages laid out 1:1 with the PDF sheets. Vivliostyle's
// screen rendering scales pages for the display (zoom/transform driven by
// devicePixelRatio); any residue of that machinery at print time rescales the
// whole document, so every scaling input is explicitly neutralized inline
// (style-attribute !important outranks every stylesheet rule, including
// Vivliostyle's own @media print resets).
export async function printWebviewToPdf(webview: any, settings: PdfFootnotesSettings): Promise<Uint8Array> {
  const destinations: PdfDestination[] = await webview.executeJavaScript(`
    (function () {
      // Root overflow is clipped because Chromium's print pipeline shrinks the
      // whole document to fit any horizontally overflowing content into the
      // sheet; clipping removes the scrollable overflow so pages print 1:1.
      [document.documentElement, document.body].forEach(function (el) {
        el.style.setProperty("height", "auto", "important");
        el.style.setProperty("overflow", "clip", "important");
        el.style.setProperty("margin", "0", "important");
        el.style.setProperty("padding", "0", "important");
      });
      var viewport = document.getElementById("viv-viewport");
      viewport.style.setProperty("display", "block", "important");
      viewport.style.setProperty("position", "static", "important");
      viewport.style.setProperty("height", "auto", "important");
      viewport.style.setProperty("overflow", "clip", "important");
      // display:block defeats the spread container's flex row, which would
      // otherwise lay the revealed pages out side by side.
      document.querySelectorAll("[data-vivliostyle-outer-zoom-box], [data-vivliostyle-spread-container]").forEach(function (el) {
        el.style.setProperty("display", "block", "important");
        el.style.setProperty("height", "auto", "important");
        el.style.setProperty("width", "auto", "important");
        el.style.setProperty("margin", "0", "important");
        el.style.setProperty("zoom", "1", "important");
        el.style.setProperty("transform", "none", "important");
      });
      // Vivliostyle keeps a hidden 2x-viewport-sized measurement workspace
      // ([data-vivliostyle-layout-box]) in the DOM. Chromium derives its print
      // shrink factor from the document's preferred width, so that workspace
      // rescales every sheet. Pagination is complete here; prune everything
      // except the viewport > zoom box > spread > page containers chain (kept
      // intact so Vivliostyle's descendant selectors still match the pages).
      var zoomBox = document.querySelector("[data-vivliostyle-outer-zoom-box]");
      var spread = document.querySelector("[data-vivliostyle-spread-container]");
      Array.from(document.body.children).forEach(function (child) {
        if (child !== viewport) child.remove();
      });
      Array.from(viewport.children).forEach(function (child) {
        if (child !== zoomBox) child.remove();
      });
      if (zoomBox) Array.from(zoomBox.children).forEach(function (child) {
        if (child !== spread) child.remove();
      });
      if (spread) Array.from(spread.children).forEach(function (child) {
        if (!child.matches("[data-vivliostyle-page-container]")) child.remove();
      });

      var pages = Array.from(document.querySelectorAll("[data-vivliostyle-page-container]"));
      pages.forEach(function (page, index) {
        page.style.setProperty("display", "block", "important");
        page.style.setProperty("visibility", "visible", "important");
        page.style.setProperty("margin", "0", "important");
        page.style.setProperty("zoom", "1", "important");
        page.style.setProperty("transform", "none", "important");
        page.style.setProperty("max-height", "none", "important");
        page.style.setProperty("break-after", index < pages.length - 1 ? "page" : "auto", "important");
      });

      // PDF destinations only materialize for painted elements. The plain
      // pdf-fn ids sit on Vivliostyle's hidden layout copies, while the painted
      // page content carries encoded ids (…:0023pdf-fn-N). Strip ids from every
      // unpainted copy, promote the painted elements to the plain ids, and
      // point the links at those short same-document fragments (long encoded
      // fragments against the data: base URI are treated as external URIs).
      var isPainted = function (el) {
        return !!el.closest("[data-vivliostyle-page-container]") && !el.closest("[data-vivliostyle-layout-box]");
      };
      document.querySelectorAll("[id]").forEach(function (el) {
        if (/(?:^|:0023)pdf-fn(?:ref)?-\\d+$/.test(el.getAttribute("id")) && !isPainted(el)) el.removeAttribute("id");
      });
      document.querySelectorAll("[data-vivliostyle-page-container] [id]").forEach(function (el) {
        var match = (el.getAttribute("id") || "").match(/:0023(pdf-fn(?:ref)?-\\d+)$/);
        if (match && isPainted(el)) el.setAttribute("id", match[1]);
      });
      document.querySelectorAll('a[href*="pdf-fn"]').forEach(function (link) {
        var match = (link.getAttribute("href") || "").match(/(?:#|:0023)(pdf-fn(?:ref)?-\\d+)$/);
        if (match) link.setAttribute("href", "#" + match[1]);
      });

      // Chromium's print emits /Dest name references on the link annotations
      // but never the destination table itself, so report each target's page
      // and position for pdf-lib to write the table into the finished PDF.
      // 0.75 converts layout px to PDF points. First DOM match per id is the
      // visible copy (Vivliostyle nests a zero-size twin anchor inside it).
      var destinations = [];
      var seen = {};
      document.querySelectorAll('[id^="pdf-fn"]').forEach(function (el) {
        var id = el.getAttribute("id");
        if (!/^pdf-fn(?:ref)?-\\d+$/.test(id) || seen[id]) return;
        var container = el.closest("[data-vivliostyle-page-container]");
        if (!container) return;
        seen[id] = true;
        var r = el.getBoundingClientRect();
        var c = container.getBoundingClientRect();
        destinations.push({
          id: id,
          pageIndex: pages.indexOf(container),
          xPt: (r.left - c.left) * 0.75,
          yTopPt: (r.top - c.top) * 0.75
        });
      });
      return destinations;
    })();
  `);
  const data = await webview.printToPDF({
    pageSize: settings.pageSize,
    printBackground: settings.printBackground,
    preferCSSPageSize: true,
    scale: 1,
    margins: { marginType: "none" },
    generateTaggedPDF: true,
  });
  if (!data || data.length < 10_000) {
    throw new Error(`The renderer returned an invalid or blank PDF (${data?.length || 0} bytes).`);
  }
  return await addNamedDestinations(data as Uint8Array, destinations);
}

// Chromium's link annotations reference named destinations (/Dest /pdf-fn-N)
// that its print pipeline never defines. Write both destination flavors into
// the catalog — the /Dests dictionary resolves name-object references and the
// /Names tree resolves string references — pointing each name at its measured
// page position.
async function addNamedDestinations(data: Uint8Array, destinations: PdfDestination[]): Promise<Uint8Array> {
  const valid = (destinations || []).filter(
    (d) => d && typeof d.id === "string" && Number.isFinite(d.pageIndex) && Number.isFinite(d.yTopPt),
  );
  if (!valid.length) return data;

  const doc = await PDFDocument.load(data, { updateMetadata: false });
  const pages = doc.getPages();
  const context = doc.context;
  const destsDict = context.obj({});
  const nameTreePairs: (PDFString | ReturnType<typeof context.obj>)[] = [];
  const sorted = [...valid].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const dest of sorted) {
    const page = pages[dest.pageIndex];
    if (!page) continue;
    const top = Math.max(0, Math.min(page.getHeight(), page.getHeight() - dest.yTopPt + 8));
    const destArray = context.obj([page.ref, PDFName.of("XYZ"), null, PDFNumber.of(top), null]);
    destsDict.set(PDFName.of(dest.id), destArray);
    nameTreePairs.push(PDFString.of(dest.id), destArray);
  }
  const namesLeaf = context.obj({});
  namesLeaf.set(PDFName.of("Names"), context.obj(nameTreePairs));
  const namesDict = context.obj({});
  namesDict.set(PDFName.of("Dests"), namesLeaf);
  doc.catalog.set(PDFName.of("Dests"), destsDict);
  doc.catalog.set(PDFName.of("Names"), namesDict);
  return await doc.save({ useObjectStreams: false });
}

export async function measureContentHeight(_webview: any): Promise<number> {
  return 0;
}

// Measures everything that determines print geometry and link destinations in
// the guest document, so autotest reports can prove (not guess) why a PDF came
// out wrong: device pixel ratio, Vivliostyle's internal pixelRatio, generated
// @page rules, zoom/transform up the ancestor chain, per-page part boxes, and
// the href/id pairs that must become PDF destinations.
export async function collectPrintDiagnostics(webview: any): Promise<any> {
  return await safeEval(
    webview,
    `(function () {
      function num(x) { return typeof x === "number" ? Math.round(x * 100) / 100 : null; }
      function rect(el) {
        var r = el.getBoundingClientRect();
        return { x: num(r.x), y: num(r.y), w: num(r.width), h: num(r.height) };
      }
      function styleInfo(el) {
        var cs = getComputedStyle(el);
        return {
          tag: el.tagName.toLowerCase(),
          attrs: Array.prototype.map.call(el.attributes, function (a) {
            return a.name + (a.value ? "=" + String(a.value).slice(0, 40) : "");
          }).join(" ").slice(0, 300),
          zoom: cs.zoom,
          transform: cs.transform,
          width: cs.width,
          height: cs.height,
          currentCSSZoom: typeof el.currentCSSZoom === "number" ? el.currentCSSZoom : null,
          inline: (el.getAttribute("style") || "").slice(0, 260),
          rect: rect(el)
        };
      }
      function dumpPage(container) {
        if (!container) return null;
        var parts = Array.prototype.slice.call(container.querySelectorAll(
          "[data-vivliostyle-bleed-box], [data-vivliostyle-page-box], [data-vivliostyle-page-area]," +
          " [data-vivliostyle-page-area-container], [data-vivliostyle-page-margin-box]"
        ));
        return {
          pageIndex: container.getAttribute("data-vivliostyle-page-index"),
          info: styleInfo(container),
          parts: parts.slice(0, 12).map(styleInfo),
          footnoteRects: Array.prototype.slice.call(container.querySelectorAll(".pdf-footnote")).slice(0, 5).map(rect)
        };
      }
      var viewer = window.__vivViewer;
      var containers = Array.prototype.slice.call(document.querySelectorAll("[data-vivliostyle-page-container]"));
      var footnotePage = containers.filter(function (c) { return c.querySelector(".pdf-footnote"); })[0] || null;
      var chain = [];
      for (var el = containers[0]; el; el = el.parentElement) chain.push(styleInfo(el));
      var pageRuleStyles = Array.prototype.slice.call(document.querySelectorAll("style")).filter(function (s) {
        return (s.textContent || "").indexOf("@page") >= 0;
      }).map(function (s) {
        return { id: s.id, attrs: Array.prototype.map.call(s.attributes, function (a) { return a.name; }).join(" "),
                 text: (s.textContent || "").slice(0, 400) };
      });
      var links = Array.prototype.slice.call(document.querySelectorAll("a[href]")).map(function (a) {
        return {
          href: (a.getAttribute("href") || "").slice(0, 140),
          resolved: (a.href || "").slice(0, 160),
          text: (a.textContent || "").trim().slice(0, 24),
          inPage: !!a.closest("[data-vivliostyle-page-container]")
        };
      }).filter(function (l) { return l.href.indexOf("#") >= 0 || l.href.indexOf("pdf-fn") >= 0; });
      var ids = Array.prototype.slice.call(document.querySelectorAll("[id]")).filter(function (el) {
        var id = el.id;
        return id.indexOf("pdf-fn") >= 0 || id.indexOf("fn") >= 0 || id.indexOf("note") >= 0;
      }).map(function (el) {
        var container = el.closest("[data-vivliostyle-page-container]");
        var parent = el.parentElement;
        return {
          id: el.id.length > 60 ? el.id.slice(0, 24) + "..." + el.id.slice(-24) : el.id,
          painted: !!container && !el.closest("[data-vivliostyle-layout-box]"),
          pageIndex: container ? container.getAttribute("data-vivliostyle-page-index") : null,
          tag: el.tagName.toLowerCase(),
          parent: parent ? (parent.tagName.toLowerCase() + " " + (parent.className || "").toString().slice(0, 40)) : null,
          rect: rect(el)
        };
      });
      var wideElements = Array.prototype.slice.call(document.querySelectorAll("*")).filter(function (el) {
        var r = el.getBoundingClientRect();
        return r.width > 810 || r.right > 810 || el.scrollWidth > 810;
      }).slice(0, 20).map(function (el) {
        return {
          tag: el.tagName.toLowerCase(),
          attrs: Array.prototype.map.call(el.attributes, function (a) {
            return a.name + (a.value ? "=" + String(a.value).slice(0, 30) : "");
          }).join(" ").slice(0, 140),
          rect: rect(el),
          scrollWidth: el.scrollWidth
        };
      });
      return {
        devicePixelRatio: window.devicePixelRatio,
        innerSize: [window.innerWidth, window.innerHeight],
        docScroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
        bodyScroll: [document.body.scrollWidth, document.body.scrollHeight],
        wideElements: wideElements,
        baseURI: (document.baseURI || "").slice(0, 100),
        viewerPixelRatio: viewer ? viewer.pixelRatio : null,
        viewerPageSizes: viewer && viewer.pageSizes ? viewer.pageSizes.slice(0, 2).map(function (s) {
          return { w: num(s.width), h: num(s.height) };
        }) : null,
        pageRuleStyles: pageRuleStyles,
        containerCount: containers.length,
        ancestorChainFromFirstPage: chain,
        firstPage: dumpPage(containers[0]),
        footnotePage: dumpPage(footnotePage),
        linksSample: links.slice(0, 50),
        idsSample: ids.slice(0, 50)
      };
    })()`,
    { error: "diagnostics failed" },
  );
}

function waitForLayout(webview: any): Promise<number> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = setInterval(async () => {
      if (Date.now() - started > LAYOUT_TIMEOUT) {
        clearInterval(poll);
        reject(new Error("Vivliostyle timed out while laying out the pages."));
        return;
      }
      const state = await safeEval<string>(
        webview,
        `window.__vivError ? "err:" + window.__vivError : window.__vivDone ? "ok:" + (window.__vivPages || 0) : "wait"`,
        "wait",
      );
      if (state.startsWith("ok:")) {
        clearInterval(poll);
        resolve(Number(state.slice(3)) || 0);
      } else if (state.startsWith("err:")) {
        clearInterval(poll);
        reject(new Error(state.slice(4)));
      }
    }, 300);
  });
}

async function safeEval<T>(webview: any, script: string, fallback: T): Promise<T> {
  try {
    return (await webview.executeJavaScript(script)) as T;
  } catch {
    return fallback;
  }
}

function writeDebugDump(bodyHtml: string, styles: string[], pageCount: number): void {
  try {
    const fs = req("fs");
    const os = req("os");
    const path = req("path");
    const html = `<!doctype html><meta charset="utf-8"><style>${styles.join("\n")}</style><body>${bodyHtml}</body>`;
    fs.writeFileSync(path.join(os.homedir(), "Downloads", "pdf-footnotes-vivliostyle-source.html"), html, "utf8");
    fs.writeFileSync(
      path.join(os.homedir(), "Downloads", "pdf-footnotes-debug-report.txt"),
      `PDF Footnotes Vivliostyle report\npages: ${pageCount}\n`,
      "utf8",
    );
  } catch (error) {
    console.warn("[PDF Footnotes] debug dump failed", error);
  }
}

function once(el: any, event: string, timeoutMs: number, timeoutMessage: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      el.removeEventListener(event, handler);
      reject(new Error(timeoutMessage));
    }, timeoutMs);
    const handler = () => {
      clearTimeout(timer);
      el.removeEventListener(event, handler);
      resolve();
    };
    el.addEventListener(event, handler);
  });
}
