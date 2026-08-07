import { Plugin } from "obsidian";
import { ExportModal } from "./export-modal";
import { DEFAULT_SETTINGS, PdfFootnotesSettings, PdfFootnotesSettingTab } from "./settings";

export default class PdfFootnotesPlugin extends Plugin {
  settings: PdfFootnotesSettings;

  async onload() {
    await this.loadSettings();

    this.addCommand({
      id: "export-pdf-footnotes",
      name: "Export to PDF",
      icon: "file-down",
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (!checking) {
          // The modal edits a copy; hand back whatever the user left it on so
          // the next export starts from the same place, exported or not.
          new ExportModal(this.app, file, this.settings, async (opts) => {
            this.settings = Object.assign(this.settings, opts);
            await this.saveSettings();
          }).open();
        }
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
