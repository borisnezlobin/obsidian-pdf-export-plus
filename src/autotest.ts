import { Plugin } from "obsidian";
import { detectDroppedText, prepareNote } from "./export";
import { req } from "./node";
import { PdfFootnotesSettings } from "./settings";
import { collectPrintDiagnostics, paginateInWebview, printWebviewToPdf } from "./webview-export";

// Development-only harness: when a marker file exists in the vault, the plugin
// exports the configured note on startup and writes the PDF plus a geometry/
// link instrumentation report to ~/Downloads/pdf-footnotes-autotest/. This lets
// an external script drive full export cycles (build -> install -> relaunch
// Obsidian -> read report) without clicking through the UI.
const MARKER_PATH = ".obsidian/pdf-footnotes-autotest.json";

interface AutotestConfig {
  note: string;
}

export async function maybeRunAutotest(plugin: Plugin, settings: PdfFootnotesSettings): Promise<void> {
  const app = plugin.app;
  let rawConfig: string;
  try {
    rawConfig = await app.vault.adapter.read(MARKER_PATH);
  } catch {
    return;
  }

  const fs = req("fs");
  const os = req("os");
  const path = req("path");
  const outDir = path.join(os.homedir(), "Downloads", "pdf-footnotes-autotest");
  fs.mkdirSync(outDir, { recursive: true });
  const writeStatus = (stage: string, extra: Record<string, unknown> = {}) => {
    fs.writeFileSync(path.join(outDir, "status.json"), JSON.stringify({ stage, at: new Date().toISOString(), ...extra }, null, 2));
  };

  let host: HTMLElement | null = null;
  try {
    writeStatus("starting");
    const config = JSON.parse(rawConfig) as AutotestConfig;
    const file = app.vault.getFileByPath(config.note);
    if (!file) throw new Error(`autotest note not found: ${config.note}`);

    writeStatus("rendering");
    const prepared = await prepareNote(app, file, settings.includeTitle, settings.applyLedeStyles);

    host = document.body.createDiv();
    host.setAttribute("style", "position:fixed;top:0;left:0;width:1000px;height:800px;z-index:9999;background:#fff;");
    writeStatus("paginating");
    const { webview, pageCount, outputText } = await paginateInWebview(host, prepared.bodyHtml, settings, (stage) =>
      writeStatus("paginating", { detail: stage })
    );

    writeStatus("probing-pre-print");
    const probeBeforePrint = await collectPrintDiagnostics(webview);
    const embedderZoomFactor = typeof webview.getZoomFactor === "function" ? webview.getZoomFactor() : null;

    writeStatus("printing");
    const data = await printWebviewToPdf(webview, settings);
    const probeAfterPrint = await collectPrintDiagnostics(webview);

    const pdfPath = path.join(outDir, "export.pdf");
    fs.writeFileSync(pdfPath, Buffer.from(data));

    const dropped = detectDroppedText(prepared.sourceText, outputText);
    fs.writeFileSync(
      path.join(outDir, "report.json"),
      JSON.stringify(
        {
          note: config.note,
          pageCount,
          footnoteCount: prepared.footnoteCount,
          droppedRun: dropped.maxRun,
          droppedExcerpt: dropped.excerpt,
          embedderZoomFactor,
          probeBeforePrint,
          probeAfterPrint,
        },
        null,
        2
      )
    );
    writeStatus("done", { pdfPath, pageCount, bytes: data.length });
  } catch (error) {
    const message = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
    writeStatus("error", { message });
  } finally {
    host?.remove();
    try {
      await app.vault.adapter.remove(MARKER_PATH);
    } catch {
      /* marker already gone */
    }
  }
}
