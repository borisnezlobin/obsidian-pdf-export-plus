import { req } from "./node";
import { buildPageCss } from "./page-css";
import { captureThemeContext, collectPrintStyles, collectStyleSheets } from "./render";
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
const LAYOUT_TIMEOUT = 120000;

export async function paginateInWebview(
  host: HTMLElement,
  bodyHtml: string,
  settings: PdfFootnotesSettings,
  onProgress: ProgressFn,
): Promise<PaginationResult> {
  const theme = captureThemeContext();
  const authorStyles = [...collectStyleSheets(), ...collectPrintStyles(), buildPageCss(settings)];

  onProgress("Opening preview...");
  const webview = document.createElement("webview") as any;
  webview.src = "app://obsidian.md/help.html";
  webview.nodeintegration = true;
  webview.setAttribute("nodeintegration", "on");
  webview.setAttribute(
    "style",
    "position:absolute;inset:0;width:100%;height:100%;display:flex;border:0;background:#aaa;",
  );
  host.appendChild(webview);
  webview.addEventListener("console-message", (event: any) =>
    console.log("[PDF Footnotes webview]", event.message),
  );
  await once(webview, "dom-ready", DOM_READY_TIMEOUT, "The preview page didn't load.");

  onProgress("Preparing document...");
  const payload = {
    bodyHtml,
    bodyClass: theme.bodyClass,
    bodyStyle: theme.bodyStyle,
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
      document.body.className = payload.bodyClass;
      document.body.setAttribute("style", payload.bodyStyle || "");
      document.body.classList.add("theme-light");
      document.body.classList.remove("theme-dark");
      document.body.innerHTML = '<div id="viv-viewport" data-vivliostyle-viewer-viewport></div>';
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
        source.body.className = payload.bodyClass;
        source.body.setAttribute("style", payload.bodyStyle || "");
        source.body.innerHTML = payload.bodyHtml;

        var viewport = document.getElementById("viv-viewport");
        var viewer = new window.VivliostyleCore.CoreViewer(
          { viewportElement: viewport, window: window, debug: false },
          {
            autoResize: false,
            renderAllPages: true,
            pageViewMode: window.VivliostyleCore.PageViewMode.SINGLE_PAGE,
            fitToScreen: true,
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
      return "#" + (i + 1) + " native=true text=\"" + (note.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 80) + "\"";
    })`,
    [],
  );

  if (settings.debugDump) writeDebugDump(bodyHtml, authorStyles, pageCount);
  onProgress(`Preview ready - ${pageCount} page${pageCount === 1 ? "" : "s"}.`);
  return { webview, pageCount, outputText, removedHidden: [], imageReport, footnotePolicyReport };
}

export async function printWebviewToPdf(webview: any, settings: PdfFootnotesSettings): Promise<Uint8Array> {
  const data = await webview.printToPDF({
    pageSize: settings.pageSize,
    printBackground: settings.printBackground,
    preferCSSPageSize: true,
    scale: 1,
    margins: { marginType: "none" },
  });
  return data as Uint8Array;
}

export async function measureContentHeight(_webview: any): Promise<number> {
  return 0;
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
