import { App, ButtonComponent, Modal, Notice, Setting, TFile } from "obsidian";
import {
  chooseSavePath,
  defaultOutputPath,
  detectDroppedText,
  PreparedNote,
  prepareNote,
  revealPdf,
  writeDebugReport,
  writePdf,
} from "./export";
import { PdfFootnotesSettings } from "./settings";
import { paginateInWebview, printWebviewToPdf } from "./webview-export";

// A BEPDF-style export dialog: it renders a live paginated PREVIEW (the actual
// Paged.js output, footnotes at page bottoms), lets you adjust options, and
// exports that exact preview to PDF via a native save dialog.
export class ExportModal extends Modal {
  private file: TFile;
  private opts: PdfFootnotesSettings;
  private prepared: PreparedNote | null = null;
  private webview: any = null;
  private statusEl!: HTMLElement;
  private previewHost!: HTMLElement;
  private exportBtn!: ButtonComponent;
  private busy = false;

  constructor(app: App, file: TFile, settings: PdfFootnotesSettings) {
    super(app);
    this.file = file;
    this.opts = { ...settings };
  }

  onOpen() {
    this.modalEl.style.width = "min(1100px, 94vw)";
    this.modalEl.style.height = "min(900px, 92vh)";
    const { contentEl } = this;
    contentEl.empty();
    contentEl.style.height = "100%";
    contentEl.style.display = "flex";
    contentEl.style.flexDirection = "column";
    contentEl.style.overflow = "hidden";

    const header = contentEl.createDiv();
    header.style.flex = "0 0 auto";
    header.createEl("h3", { text: `Export "${this.file.basename}" to PDF` });
    header.createEl("p", {
      text: "Footnotes are placed on the page where they are referenced.",
      cls: "setting-item-description",
    });

    this.buildControls(contentEl);

    this.previewHost = contentEl.createDiv();
    this.previewHost.style.flex = "1 1 auto";
    this.previewHost.style.minHeight = "240px";
    this.previewHost.style.margin = "12px 0 8px";
    this.previewHost.style.overflow = "hidden";
    this.previewHost.style.borderRadius = "6px";
    this.previewHost.style.background = "#fff";
    this.previewHost.style.boxShadow = "inset 0 0 0 1px var(--background-modifier-border)";

    this.statusEl = contentEl.createDiv();
    this.statusEl.style.flex = "0 0 auto";
    this.statusEl.style.minHeight = "1.4em";
    this.statusEl.style.color = "var(--text-muted)";
    this.statusEl.style.fontSize = "0.9em";

    this.buildButtons(contentEl);
    void this.buildPreview();
  }

  onClose() {
    this.teardownWebview();
    this.contentEl.empty();
  }

  private buildControls(parent: HTMLElement) {
    const row = parent.createDiv();
    row.style.flex = "0 0 auto";
    row.style.display = "grid";
    row.style.gridTemplateColumns = "repeat(5, minmax(130px, 1fr))";
    row.style.gap = "1px";
    row.style.marginTop = "14px";
    row.style.border = "1px solid var(--background-modifier-border)";
    row.style.borderRadius = "6px";
    row.style.overflow = "hidden";
    row.style.background = "var(--background-modifier-border)";

    const compact = (setting: Setting): Setting => {
      setting.settingEl.style.minWidth = "0";
      setting.settingEl.style.padding = "10px 12px";
      setting.settingEl.style.border = "0";
      setting.settingEl.style.background = "var(--background-primary)";
      setting.settingEl.style.alignItems = "center";
      setting.nameEl.style.fontSize = "0.85em";
      setting.nameEl.style.whiteSpace = "nowrap";
      return setting;
    };

    compact(new Setting(row)).setName("Page size").addDropdown((d) =>
      d
        .addOptions({ A4: "A4", Letter: "Letter", Legal: "Legal", A3: "A3", A5: "A5", Tabloid: "Tabloid" })
        .setValue(this.opts.pageSize)
        .onChange((v) => {
          this.opts.pageSize = v;
          void this.buildPreview();
        })
    );
    compact(new Setting(row)).setName("Page numbers").addToggle((t) =>
      t.setValue(this.opts.showPageNumbers).onChange((v) => {
        this.opts.showPageNumbers = v;
        void this.buildPreview();
      })
    );
    compact(new Setting(row)).setName("Title heading").addToggle((t) =>
      t.setValue(this.opts.includeTitle).onChange((v) => {
        this.opts.includeTitle = v;
        this.prepared = null; // title is baked into the rendered HTML — re-render
        void this.buildPreview();
      })
    );
    compact(new Setting(row))
      .setName("Backgrounds")
      .addToggle((t) => t.setValue(this.opts.printBackground).onChange((v) => (this.opts.printBackground = v)));
    compact(new Setting(row))
      .setName("Open after export")
      .addToggle((t) => t.setValue(this.opts.openAfterExport).onChange((v) => (this.opts.openAfterExport = v)));
  }

  private buildButtons(parent: HTMLElement) {
    const bar = new Setting(parent);
    bar.settingEl.style.flex = "0 0 auto";
    bar.settingEl.style.padding = "10px 0 0";
    bar.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
    bar.addButton((b) => {
      this.exportBtn = b;
      b.setButtonText("Export PDF").setCta().setDisabled(true).onClick(() => this.doExport());
    });
  }

  private setStatus(text: string, error = false) {
    this.statusEl.setText(text);
    this.statusEl.style.color = error ? "var(--text-error)" : "var(--text-muted)";
  }

  // Render (or re-render) the paginated preview after an option change.
  private async buildPreview() {
    if (this.busy) return;
    this.busy = true;
    this.exportBtn.setDisabled(true);
    this.teardownWebview();
    this.previewHost.empty();

    try {
      if (!this.prepared) {
        this.setStatus("Rendering note…");
        this.prepared = await prepareNote(this.app, this.file, this.opts.includeTitle);
      }
      const { webview, pageCount, outputText, removedHidden, imageReport, footnotePolicyReport } = await paginateInWebview(
        this.previewHost,
        this.prepared.bodyHtml,
        this.opts,
        (stage) => this.setStatus(stage)
      );
      this.webview = webview;
      // Keep the guest surface viewport-sized and scroll inside it. A webview
      // as tall as every page exceeds Electron's compositing limits and turns
      // white after the first screenful.
      webview.style.height = "100%";

      const ready = `Preview ready — ${pageCount} page${pageCount === 1 ? "" : "s"}, ${this.prepared.footnoteCount} footnote${
        this.prepared.footnoteCount === 1 ? "" : "s"
      } at page bottoms. Scroll the preview to review, then Export.`;

      // Integrity check: only warn on a genuinely dropped contiguous chunk (a
      // long run of consecutive source trigrams absent from the output).
      // Boundary mismatches from footnotes/headings produce only 1-2 and are
      // ignored, so the warning no longer cries wolf.
      const { maxRun, excerpt } = outputText
        ? detectDroppedText(this.prepared.sourceText, outputText)
        : { maxRun: 0, excerpt: "" };
      if (this.opts.debugDump) {
        writeDebugReport(this.file.basename, {
          pageCount,
          removedHidden,
          imageReport,
          footnotePolicyReport,
          droppedRun: maxRun,
          droppedExcerpt: excerpt,
        });
      }
      if (maxRun >= 8) {
        this.setStatus(
          `Possible missing passage: "${excerpt.slice(0, 60)}…". Review the paginated preview before exporting.`,
          true
        );
        console.warn(`[PDF Footnotes] possible dropped passage (run=${maxRun}):`, excerpt);
      } else {
        this.setStatus(ready);
      }
      this.exportBtn.setDisabled(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.setStatus(`Preview failed: ${msg} (see console: Cmd+Opt+I)`, true);
      console.error("[PDF Footnotes] preview failed:", e);
    } finally {
      this.busy = false;
    }
  }

  private async doExport() {
    console.log("[PDF Footnotes] Export clicked. webview?", !!this.webview, "busy?", this.busy);
    if (this.busy) return;
    if (!this.webview) {
      this.setStatus("Preview isn't ready yet — please wait a moment.", true);
      return;
    }
    this.busy = true;
    this.exportBtn.setButtonText("Exporting…").setDisabled(true);
    try {
      this.setStatus("Choose where to save…");
      const choice = await chooseSavePath(defaultOutputPath(this.file, this.opts));
      if (!choice.path) {
        this.setStatus("Export cancelled.");
        this.resetExportButton();
        return;
      }
      this.setStatus("Printing to PDF…");
      console.log("[PDF Footnotes] printing to", choice.path);
      const data = await printWebviewToPdf(this.webview, this.opts);
      console.log("[PDF Footnotes] printToPDF returned", data?.length, "bytes");
      writePdf(choice.path, data, this.opts.openAfterExport);
      new Notice("PDF exported.");
      this.renderDone(choice.path, data.length);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.setStatus(`Export failed: ${msg} (see console: Cmd+Opt+I)`, true);
      console.error("[PDF Footnotes] export failed:", e);
      this.resetExportButton();
    }
  }

  private resetExportButton() {
    this.busy = false;
    this.exportBtn.setButtonText("Export PDF").setDisabled(false);
  }

  private renderDone(outputPath: string, bytes: number) {
    this.teardownWebview();
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "PDF exported" });
    const p = contentEl.createEl("p", { text: outputPath });
    p.style.userSelect = "text";
    p.style.fontFamily = "var(--font-monospace)";
    p.style.fontSize = "0.85em";
    p.style.wordBreak = "break-all";
    contentEl.createEl("p", { text: `${(bytes / 1024).toFixed(0)} KB`, cls: "setting-item-description" });
    const bar = new Setting(contentEl);
    bar.addButton((b) => b.setButtonText("Show in folder").onClick(() => revealPdf(outputPath)));
    bar.addButton((b) => b.setButtonText("Done").setCta().onClick(() => this.close()));
  }

  private teardownWebview() {
    if (this.webview) {
      try {
        this.webview.remove();
      } catch {
        /* ignore */
      }
      this.webview = null;
    }
  }
}
