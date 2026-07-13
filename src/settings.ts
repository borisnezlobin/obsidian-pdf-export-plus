import { App, PluginSettingTab, Setting } from "obsidian";
import type PdfFootnotesPlugin from "./main";

export interface PdfFootnotesSettings {
  pageSize: string;
  marginTop: number; // mm
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  showPageNumbers: boolean;
  printBackground: boolean;
  footnoteFontPt: number;
  includeTitle: boolean;
  applyLedeStyles: boolean; // forward ::first-letter/::first-line CSS (drop caps, bold lede)
  exportFolder: string; // absolute path; "" -> ~/Downloads
  openAfterExport: boolean;
  debugDump: boolean;
}

// Defaults lean on Better Export PDF's config (A4, page-number footer,
// printBackground off) with readable margins. All are adjustable.
export const DEFAULT_SETTINGS: PdfFootnotesSettings = {
  pageSize: "A4",
  marginTop: 18,
  marginBottom: 16,
  marginLeft: 12,
  marginRight: 12,
  showPageNumbers: true,
  printBackground: false,
  footnoteFontPt: 8.5,
  includeTitle: false,
  applyLedeStyles: true,
  exportFolder: "",
  openAfterExport: true,
  debugDump: false,
};

export class PdfFootnotesSettingTab extends PluginSettingTab {
  plugin: PdfFootnotesPlugin;

  constructor(app: App, plugin: PdfFootnotesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const save = () => this.plugin.saveSettings();

    new Setting(containerEl)
      .setName("Page size")
      .setDesc("A4, Letter, Legal, A3, A5, or Tabloid.")
      .addDropdown((d) =>
        d
          .addOptions({ A4: "A4", Letter: "Letter", Legal: "Legal", A3: "A3", A5: "A5", Tabloid: "Tabloid" })
          .setValue(this.plugin.settings.pageSize)
          .onChange(async (v) => {
            this.plugin.settings.pageSize = v;
            await save();
          })
      );

    const marginSetting = (
      name: string,
      key: "marginTop" | "marginBottom" | "marginLeft" | "marginRight"
    ) =>
      new Setting(containerEl).setName(name).setDesc("Millimetres.").addText((t) =>
        t.setValue(String(this.plugin.settings[key])).onChange(async (v) => {
          const n = Number(v);
          if (!Number.isNaN(n)) {
            this.plugin.settings[key] = n;
            await save();
          }
        })
      );
    marginSetting("Margin — top", "marginTop");
    marginSetting("Margin — bottom", "marginBottom");
    marginSetting("Margin — left", "marginLeft");
    marginSetting("Margin — right", "marginRight");

    new Setting(containerEl)
      .setName("Title heading")
      .setDesc("Add the note's title (or its `title` frontmatter) as a heading at the top.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.includeTitle).onChange(async (v) => {
          this.plugin.settings.includeTitle = v;
          await save();
        })
      );

    new Setting(containerEl)
      .setName("Drop caps & first-line styles")
      .setDesc("Apply ::first-letter and ::first-line rules from your CSS snippets (drop caps, bold opening lines) to exports.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.applyLedeStyles).onChange(async (v) => {
          this.plugin.settings.applyLedeStyles = v;
          await save();
        })
      );

    new Setting(containerEl)
      .setName("Page numbers")
      .setDesc('Show a centered "page / total" footer, like Better Export PDF.')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showPageNumbers).onChange(async (v) => {
          this.plugin.settings.showPageNumbers = v;
          await save();
        })
      );

    new Setting(containerEl)
      .setName("Print background colors")
      .setDesc("Off matches Better Export PDF's default (cleaner for print).")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.printBackground).onChange(async (v) => {
          this.plugin.settings.printBackground = v;
          await save();
        })
      );

    new Setting(containerEl)
      .setName("Footnote font size")
      .setDesc("Point size for the page-bottom footnotes.")
      .addText((t) =>
        t.setValue(String(this.plugin.settings.footnoteFontPt)).onChange(async (v) => {
          const n = Number(v);
          if (!Number.isNaN(n) && n > 0) {
            this.plugin.settings.footnoteFontPt = n;
            await save();
          }
        })
      );

    new Setting(containerEl)
      .setName("Export folder")
      .setDesc("Absolute path to save PDFs. Leave empty to use your Downloads folder.")
      .addText((t) =>
        t
          .setPlaceholder("~/Downloads")
          .setValue(this.plugin.settings.exportFolder)
          .onChange(async (v) => {
            this.plugin.settings.exportFolder = v.trim();
            await save();
          })
      );

    new Setting(containerEl)
      .setName("Open after export")
      .setDesc("Open the PDF in your default viewer once it's created.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.openAfterExport).onChange(async (v) => {
          this.plugin.settings.openAfterExport = v;
          await save();
        })
      );

    new Setting(containerEl)
      .setName("Debug: save the pre-print HTML")
      .setDesc(
        "Writes the exact HTML + CSS sent to the print engine to ~/Downloads/pdf-footnotes-debug.html, for troubleshooting layout issues."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.debugDump).onChange(async (v) => {
          this.plugin.settings.debugDump = v;
          await save();
        })
      );
  }
}
