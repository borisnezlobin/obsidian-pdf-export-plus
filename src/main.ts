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
    const saved = (await this.loadData()) ?? {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    const savedVersion: number = saved.settingsVersion ?? 0;
    if (savedVersion < DEFAULT_SETTINGS.settingsVersion) {
      // v1: pre-release settings had the title heading disabled by default.
      if (savedVersion < 1) this.settings.includeTitle = true;
      // v2: drop caps became opt-in.
      if (savedVersion < 2) this.settings.applyLedeStyles = false;
      this.settings.settingsVersion = DEFAULT_SETTINGS.settingsVersion;
      await this.saveData(this.settings);
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
