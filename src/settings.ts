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
  applyLedeStyles: boolean; // plugin-owned, font-agnostic drop cap
  dropCapLines: number;
  applyParagraphStyles: boolean; // indent/spacing shaping, usable on its own
  professionalExport: boolean;
  professionalFontFamily: string;
  professionalFontSizePt: number;
  professionalLineHeight: number;
  professionalParagraphSpacingEm: number;
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
  includeTitle: true,
  applyLedeStyles: false,
  dropCapLines: 3,
  applyParagraphStyles: false,
  professionalExport: false,
  professionalFontFamily: "Times New Roman",
  professionalFontSizePt: 12,
  professionalLineHeight: 2,
  professionalParagraphSpacingEm: 0,
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
      .setDesc("Add a font-agnostic drop cap to the opening paragraph. Theme and snippet first-letter rules are not imported.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.applyLedeStyles).onChange(async (v) => {
          this.plugin.settings.applyLedeStyles = v;
          await save();
        })
      );

    new Setting(containerEl)
      .setName("Drop cap size")
      .setDesc("Number of text lines occupied by the opening letter.")
      .addSlider((slider) =>
        slider.setLimits(2, 6, 1).setDynamicTooltip().setValue(this.plugin.settings.dropCapLines).onChange(async (v) => {
          this.plugin.settings.dropCapLines = v;
          await save();
        })
      );

    new Setting(containerEl)
      .setName("Paragraph shaping")
      .setDesc(
        "Indent first lines, control the space between paragraphs, and keep deliberate blank-line gaps from the note."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.applyParagraphStyles).onChange(async (v) => {
          this.plugin.settings.applyParagraphStyles = v;
          await save();
        })
      );

    new Setting(containerEl)
      .setName("Force professional export")
      .setDesc("Use a clean, theme-independent print style for every export. You can still adjust the typography below.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.professionalExport).onChange(async (v) => {
          this.plugin.settings.professionalExport = v;
          await save();
        })
      );

    new Setting(containerEl)
      .setName("Professional font")
      .setDesc('A font installed on your computer, such as "Times New Roman", Georgia, or Arial.')
      .addText((t) =>
        t.setValue(this.plugin.settings.professionalFontFamily).onChange(async (v) => {
          this.plugin.settings.professionalFontFamily = v.trim() || DEFAULT_SETTINGS.professionalFontFamily;
          await save();
        })
      );

    new Setting(containerEl)
      .setName("Professional font size")
      .setDesc("Body text size in points.")
      .addSlider((slider) =>
        slider.setLimits(9, 16, 0.5).setDynamicTooltip().setValue(this.plugin.settings.professionalFontSizePt).onChange(async (v) => {
          this.plugin.settings.professionalFontSizePt = v;
          await save();
        })
      );

    new Setting(containerEl)
      .setName("Professional line spacing")
      .setDesc("2.0 is conventional double spacing; 1.5 is more compact.")
      .addSlider((slider) =>
        slider.setLimits(1, 2.5, 0.1).setDynamicTooltip().setValue(this.plugin.settings.professionalLineHeight).onChange(async (v) => {
          this.plugin.settings.professionalLineHeight = v;
          await save();
        })
      );

    new Setting(containerEl)
      .setName("Paragraph spacing")
      .setDesc("Extra space after paragraphs, in lines. Use 0 for manuscript-style indented paragraphs.")
      .addSlider((slider) =>
        slider.setLimits(0, 2, 0.1).setDynamicTooltip().setValue(this.plugin.settings.professionalParagraphSpacingEm).onChange(async (v) => {
          this.plugin.settings.professionalParagraphSpacingEm = v;
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
