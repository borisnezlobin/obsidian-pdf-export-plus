import { Plugin } from "obsidian";
import { maybeRunAutotest } from "./autotest";
import { ExportModal } from "./export-modal";
import { DEFAULT_SETTINGS, PdfFootnotesSettings, PdfFootnotesSettingTab } from "./settings";

export default class PdfFootnotesPlugin extends Plugin {
  settings: PdfFootnotesSettings;

  async onload() {
    await this.loadSettings();
    this.app.workspace.onLayoutReady(() => void maybeRunAutotest(this, this.settings));

    this.addCommand({
      id: "export-pdf-footnotes",
      name: "Export to PDF (footnotes at page bottom)",
      icon: "file-down",
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (!checking) new ExportModal(this.app, file, this.settings).open();
        return true;
      },
    });

    this.addSettingTab(new PdfFootnotesSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
