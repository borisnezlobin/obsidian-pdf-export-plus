import {
  App,
  ButtonComponent,
  DropdownComponent,
  Modal,
  Notice,
  Setting,
  TFile,
  ToggleComponent,
  setIcon,
} from "obsidian";
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
import { installedFonts } from "./fonts";
import { DEFAULT_SETTINGS, PdfFootnotesSettings } from "./settings";
import { paginateInWebview, printWebviewToPdf } from "./webview-export";

// A BEPDF-style export dialog: it renders a live paginated PREVIEW (the actual
// Paged.js output, footnotes at page bottoms), lets you adjust options, and
// exports that exact preview to PDF via a native save dialog.
export class ExportModal extends Modal {
  private static fontPickerCount = 0;
  private file: TFile;
  private opts: PdfFootnotesSettings;
  private preparedByRenderOptions = new Map<string, PreparedNote>();
  private webview: any = null;
  private statusEl!: HTMLElement;
  private previewHost!: HTMLElement;
  private exportBtn!: ButtonComponent;
  private busy = false;
  private rebuildRequested = false;
  private previewRevision = 0;
  private persist: (settings: PdfFootnotesSettings) => Promise<void>;
  private persistTimer: number | null = null;
  private dirty = false;
  private cleanupCallbacks: Array<() => void> = [];

  constructor(
    app: App,
    file: TFile,
    settings: PdfFootnotesSettings,
    persist: (settings: PdfFootnotesSettings) => Promise<void>
  ) {
    super(app);
    this.file = file;
    this.opts = { ...settings };
    this.persist = persist;
  }

  // Option changes are saved as they happen, so closing the modal without
  // exporting still keeps the settings. Coalesced so dragging a slider does
  // not write the settings file on every step.
  private schedulePersist() {
    this.dirty = true;
    if (this.persistTimer !== null) window.clearTimeout(this.persistTimer);
    this.persistTimer = window.setTimeout(() => {
      this.persistTimer = null;
      this.dirty = false;
      void this.persist({ ...this.opts });
    }, 400);
  }

  private flushPersist() {
    if (this.persistTimer !== null) {
      window.clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (!this.dirty) return;
    this.dirty = false;
    void this.persist({ ...this.opts });
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

    const workspace = contentEl.createDiv();
    workspace.style.flex = "1 1 auto";
    workspace.style.minHeight = "0";
    workspace.style.display = "flex";
    workspace.style.gap = "14px";
    workspace.style.marginTop = "14px";

    const sidebar = workspace.createDiv({ cls: "pdfx-sidebar" });
    this.buildControls(sidebar);

    // The preview and the button row share a column so the sidebar runs the
    // full height of the dialog and the status text starts at the preview's
    // left edge rather than under the sidebar.
    const previewColumn = workspace.createDiv();
    previewColumn.style.flex = "1 1 auto";
    previewColumn.style.width = "0";
    previewColumn.style.minWidth = "0";
    previewColumn.style.minHeight = "0";
    previewColumn.style.display = "flex";
    previewColumn.style.flexDirection = "column";

    this.previewHost = previewColumn.createDiv();
    this.previewHost.style.position = "relative";
    this.previewHost.style.flex = "1 1 auto";
    this.previewHost.style.minHeight = "0";
    this.previewHost.style.overflow = "hidden";
    this.previewHost.style.borderRadius = "6px";
    this.previewHost.style.background = "#fff";
    this.previewHost.style.boxShadow = "inset 0 0 0 1px var(--background-modifier-border)";

    this.buildButtons(previewColumn);
    void this.buildPreview();
  }

  onClose() {
    this.flushPersist();
    this.teardownWebview();
    this.cleanupCallbacks.splice(0).forEach((cleanup) => cleanup());
    this.contentEl.empty();
  }

  private buildControls(parent: HTMLElement) {
    const page = this.addSection(parent, { title: "Page setup" });
    this.addDropdownRow(page.body, {
      name: "Page size",
      options: { A4: "A4", Letter: "Letter", Legal: "Legal", A3: "A3", A5: "A5", Tabloid: "Tabloid" },
      value: this.opts.pageSize,
      defaultValue: DEFAULT_SETTINGS.pageSize,
      onChange: (v) => {
        this.opts.pageSize = v;
        void this.buildPreview();
      },
    });
    this.addToggleRow(page.body, "Page numbers", this.opts.showPageNumbers, (v) => {
      this.opts.showPageNumbers = v;
      void this.buildPreview();
    });
    this.addToggleRow(page.body, "Title heading", this.opts.includeTitle, (v) => {
      this.opts.includeTitle = v;
      void this.buildPreview();
    });
    this.addToggleRow(page.body, "Background colors", this.opts.printBackground, (v) => {
      this.opts.printBackground = v;
    });

    // Declared before the professional section so switching that on can flip
    // this section's own switch — it always implies paragraph shaping.
    const paragraphs = this.addSection(parent, {
      title: "Paragraph shaping",
      description: "First-line indents and the space between paragraphs.",
      toggle: {
        value: this.opts.applyParagraphStyles,
        onChange: (v) => {
          this.opts.applyParagraphStyles = v;
          void this.buildPreview();
        },
      },
    });
    this.addSliderRow(paragraphs.body, {
      name: "Paragraph spacing",
      min: 0,
      max: 2,
      step: 0.1,
      value: this.opts.professionalParagraphSpacingEm,
      defaultValue: DEFAULT_SETTINGS.professionalParagraphSpacingEm,
      format: (v) => (v === 0 ? "none, indented" : `${v.toFixed(1)} em`),
      onChange: (v) => {
        this.opts.professionalParagraphSpacingEm = v;
        void this.buildPreview();
      },
    });

    const dropCaps = this.addSection(parent, {
      title: "Drop caps",
      description: "Enlarge the first letter of the opening paragraph.",
      toggle: {
        value: this.opts.applyLedeStyles,
        onChange: (v) => {
          this.opts.applyLedeStyles = v;
          void this.buildPreview();
        },
      },
    });
    this.addSliderRow(dropCaps.body, {
      name: "Height",
      min: 2,
      max: 6,
      step: 1,
      value: this.opts.dropCapLines,
      defaultValue: DEFAULT_SETTINGS.dropCapLines,
      format: (v) => `${v} lines`,
      onChange: (v) => {
        this.opts.dropCapLines = v;
        void this.buildPreview();
      },
    });

    const typography = this.addSection(parent, {
      title: "Professional style",
      description: "Theme-independent typography for the whole document.",
      toggle: {
        value: this.opts.professionalExport,
        onChange: (v) => {
          this.opts.professionalExport = v;
          // Professional typography assumes shaped paragraphs, so switching it
          // on switches those on too — the section above stays editable.
          if (v && !this.opts.applyParagraphStyles) {
            this.opts.applyParagraphStyles = true;
            paragraphs.setToggle(true);
          }
          void this.buildPreview();
        },
      },
    });
    this.addFontRow(typography.body, {
      name: "Font",
      placeholder: DEFAULT_SETTINGS.professionalFontFamily,
      value: this.opts.professionalFontFamily,
      defaultValue: DEFAULT_SETTINGS.professionalFontFamily,
      onChange: (v) => {
        this.opts.professionalFontFamily = v.trim() || DEFAULT_SETTINGS.professionalFontFamily;
        void this.buildPreview();
      },
    });
    this.addSliderRow(typography.body, {
      name: "Font size",
      min: 9,
      max: 16,
      step: 0.5,
      value: this.opts.professionalFontSizePt,
      defaultValue: DEFAULT_SETTINGS.professionalFontSizePt,
      format: (v) => `${v} pt`,
      onChange: (v) => {
        this.opts.professionalFontSizePt = v;
        void this.buildPreview();
      },
    });
    this.addSliderRow(typography.body, {
      name: "Line spacing",
      min: 1,
      max: 2.5,
      step: 0.1,
      value: this.opts.professionalLineHeight,
      defaultValue: DEFAULT_SETTINGS.professionalLineHeight,
      format: (v) => `${v.toFixed(1)}×`,
      onChange: (v) => {
        this.opts.professionalLineHeight = v;
        void this.buildPreview();
      },
    });

    const loose = parent.createDiv({ cls: "pdfx-loose" });
    this.addToggleRow(loose, "Open after export", this.opts.openAfterExport, (v) => {
      this.opts.openAfterExport = v;
    });
  }

  // A collapsible section of related options. With `toggle`, the section's own
  // switch owns the rows beneath it: they indent under a rule and grey out when
  // it is off.
  private addSection(
    parent: HTMLElement,
    opts: {
      title: string;
      description?: string;
      toggle?: { value: boolean; onChange: (value: boolean) => void };
    }
  ): { body: HTMLElement; setToggle: (value: boolean) => void } {
    const section = parent.createDiv({ cls: "pdfx-section" });
    // A div rather than a <button>: Obsidian's button styling wins on
    // specificity and would give every header a card's background and border.
    const header = section.createDiv({
      cls: "pdfx-section-header",
      attr: { role: "button", tabindex: "0", "aria-expanded": "true" },
    });
    const chevron = header.createSpan({ cls: "pdfx-section-chevron" });
    setIcon(chevron, "chevron-down");
    header.createSpan({ cls: "pdfx-section-title", text: opts.title });

    const body = section.createDiv({ cls: "pdfx-section-body" });
    if (opts.description) body.createDiv({ cls: "pdfx-section-desc", text: opts.description });
    const rows = body.createDiv({ cls: "pdfx-section-rows" });

    const collapse = () => {
      const collapsed = !section.hasClass("is-collapsed");
      section.toggleClass("is-collapsed", collapsed);
      header.setAttr("aria-expanded", String(!collapsed));
    };
    header.addEventListener("click", collapse);
    header.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        collapse();
      }
    });

    let setToggle = (_: boolean) => {};
    if (opts.toggle) {
      rows.addClass("pdfx-section-children");
      rows.toggleClass("is-disabled", !opts.toggle.value);
      // The switch sits inside the clickable header, so its clicks must not
      // also collapse the section.
      const slot = header.createDiv({ cls: "pdfx-section-switch" });
      slot.addEventListener("click", (event) => event.stopPropagation());
      const emit = this.saving(opts.toggle.onChange);
      const toggle = new ToggleComponent(slot).setValue(opts.toggle.value).onChange((v) => {
        rows.toggleClass("is-disabled", !v);
        emit(v);
      });
      setToggle = (value: boolean) => {
        toggle.setValue(value);
        rows.toggleClass("is-disabled", !value);
      };
    }
    return { body: rows, setToggle };
  }

  private saving<T>(onChange: (value: T) => void): (value: T) => void {
    return (value: T) => {
      onChange(value);
      this.schedulePersist();
    };
  }

  private addRow(parent: HTMLElement, name: string, stacked: boolean) {
    const row = parent.createDiv({ cls: stacked ? "pdfx-row pdfx-row-stacked" : "pdfx-row" });
    const head = row.createDiv({ cls: "pdfx-row-head" });
    head.createSpan({ cls: "pdfx-row-name", text: name });
    const control = row.createDiv({ cls: "pdfx-row-control" });
    return { head, control };
  }

  // Shows only while the value differs from the shipped default, so the panel
  // stays quiet until something has actually been changed.
  private addResetButton(head: HTMLElement, isDefault: () => boolean, reset: () => void) {
    const button = head.createEl("button", {
      cls: "pdfx-reset",
      attr: { type: "button", "aria-label": "Reset to default" },
    });
    setIcon(button, "rotate-ccw");
    button.addEventListener("click", reset);
    const sync = () => button.toggleClass("is-hidden", isDefault());
    sync();
    return sync;
  }

  private addToggleRow(parent: HTMLElement, name: string, value: boolean, onChange: (v: boolean) => void) {
    const { control } = this.addRow(parent, name, false);
    new ToggleComponent(control).setValue(value).onChange(this.saving(onChange));
  }

  private addDropdownRow(
    parent: HTMLElement,
    o: {
      name: string;
      options: Record<string, string>;
      value: string;
      defaultValue: string;
      onChange: (v: string) => void;
    }
  ) {
    const { head, control } = this.addRow(parent, o.name, true);
    const emit = this.saving(o.onChange);
    const dropdown = new DropdownComponent(control).addOptions(o.options).setValue(o.value);
    const sync = this.addResetButton(
      head,
      () => dropdown.getValue() === o.defaultValue,
      () => {
        dropdown.setValue(o.defaultValue);
        sync();
        emit(o.defaultValue);
      }
    );
    dropdown.onChange((v) => {
      sync();
      emit(v);
    });
  }

  private addFontRow(
    parent: HTMLElement,
    o: {
      name: string;
      placeholder: string;
      value: string;
      defaultValue: string;
      onChange: (v: string) => void;
    }
  ) {
    const { head, control } = this.addRow(parent, o.name, true);
    const emit = this.saving(o.onChange);
    const pickerId = ++ExportModal.fontPickerCount;
    const listId = `pdfx-font-list-${pickerId}`;
    const picker = control.createDiv({ cls: "pdfx-font-picker" });
    const input = picker.createEl("input", {
      type: "text",
      cls: "pdfx-text pdfx-font-input",
      attr: {
        role: "combobox",
        "aria-autocomplete": "list",
        "aria-controls": listId,
        "aria-expanded": "false",
      },
    });
    input.placeholder = o.placeholder;
    input.value = o.value;
    const list = picker.createDiv({
      cls: "pdfx-font-list",
      attr: { id: listId, role: "listbox" },
    });
    list.hidden = true;
    const families = installedFonts(o.value);
    let committedValue = o.value.trim() || o.defaultValue;
    let visibleFamilies: string[] = [];
    let activeIndex = -1;

    const preview = () => {
      const family = (input.value.trim() || o.defaultValue).replace(/["\\\n\r]/g, "");
      input.style.fontFamily = `"${family}", serif`;
    };
    preview();

    const closeList = () => {
      list.hidden = true;
      activeIndex = -1;
      input.setAttr("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
    };

    const activate = (index: number) => {
      if (!visibleFamilies.length) return;
      activeIndex = Math.max(0, Math.min(index, visibleFamilies.length - 1));
      const options = Array.from(list.querySelectorAll<HTMLElement>('[role="option"]'));
      options.forEach((option, optionIndex) => {
        const active = optionIndex === activeIndex;
        option.toggleClass("is-active", active);
        if (active) {
          input.setAttr("aria-activedescendant", option.id);
          option.scrollIntoView({ block: "nearest" });
        }
      });
    };

    const commit = (value: string) => {
      const next = value.trim() || o.defaultValue;
      const changed = next !== committedValue;
      committedValue = next;
      input.value = next;
      preview();
      sync();
      closeList();
      if (changed) emit(next);
    };

    const renderOptions = (query: string, showAll: boolean) => {
      const normalizedQuery = showAll ? "" : query.trim().toLocaleLowerCase();
      visibleFamilies = families
        .filter((family) => !normalizedQuery || family.toLocaleLowerCase().includes(normalizedQuery))
        .sort((a, b) => {
          if (!normalizedQuery) return a.localeCompare(b);
          const aStarts = a.toLocaleLowerCase().startsWith(normalizedQuery);
          const bStarts = b.toLocaleLowerCase().startsWith(normalizedQuery);
          return aStarts === bStarts ? a.localeCompare(b) : aStarts ? -1 : 1;
        });
      list.empty();
      if (!visibleFamilies.length) {
        list.createDiv({
          cls: "pdfx-font-empty",
          text: "No matching installed fonts. Press Enter to use this name.",
        });
        activeIndex = -1;
        input.removeAttribute("aria-activedescendant");
        return;
      }
      visibleFamilies.forEach((family, index) => {
        const option = list.createDiv({
          cls: "pdfx-font-option",
          text: family,
          attr: {
            id: `pdfx-font-option-${pickerId}-${index}`,
            role: "option",
            "aria-selected": String(family.toLocaleLowerCase() === committedValue.toLocaleLowerCase()),
          },
        });
        option.style.fontFamily = `"${family.replace(/["\\\n\r]/g, "")}", sans-serif`;
        option.addEventListener("pointerdown", (event) => event.preventDefault());
        option.addEventListener("click", () => commit(family));
      });
      const selectedIndex = visibleFamilies.findIndex(
        (family) => family.toLocaleLowerCase() === committedValue.toLocaleLowerCase(),
      );
      activate(selectedIndex >= 0 ? selectedIndex : 0);
    };

    const openList = (showAll: boolean) => {
      renderOptions(input.value, showAll);
      list.hidden = false;
      input.setAttr("aria-expanded", "true");
      window.requestAnimationFrame(() => {
        if (!list.hidden) activate(activeIndex);
      });
    };

    const sync = this.addResetButton(
      head,
      () => committedValue === o.defaultValue,
      () => commit(o.defaultValue),
    );

    input.addEventListener("focus", () => openList(true));
    input.addEventListener("click", () => openList(true));
    input.addEventListener("input", () => {
      preview();
      openList(false);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (list.hidden) {
          openList(true);
        } else {
          activate(activeIndex + (event.key === "ArrowDown" ? 1 : -1));
        }
      } else if (event.key === "Enter") {
        event.preventDefault();
        commit(activeIndex >= 0 ? visibleFamilies[activeIndex] : input.value);
      } else if (event.key === "Escape" && !list.hidden) {
        event.preventDefault();
        input.value = committedValue;
        preview();
        closeList();
      } else if (event.key === "Tab") {
        commit(input.value);
      }
    });

    const closeWhenClickingOutside = (event: PointerEvent) => {
      if (!picker.contains(event.target as Node) && !list.hidden) commit(input.value);
    };
    document.addEventListener("pointerdown", closeWhenClickingOutside);
    this.cleanupCallbacks.push(() => document.removeEventListener("pointerdown", closeWhenClickingOutside));
  }

  private addSliderRow(
    parent: HTMLElement,
    o: {
      name: string;
      min: number;
      max: number;
      step: number;
      value: number;
      defaultValue: number;
      format: (v: number) => string;
      onChange: (v: number) => void;
    }
  ) {
    const { head, control } = this.addRow(parent, o.name, true);
    const emit = this.saving(o.onChange);
    const readout = head.createSpan({ cls: "pdfx-row-value" });
    const input = control.createEl("input", { type: "range", cls: "pdfx-slider" });
    input.min = String(o.min);
    input.max = String(o.max);
    input.step = String(o.step);
    input.value = String(o.value);
    readout.setText(o.format(o.value));

    const sync = this.addResetButton(
      head,
      () => Number(input.value) === o.defaultValue,
      () => {
        input.value = String(o.defaultValue);
        readout.setText(o.format(o.defaultValue));
        sync();
        emit(o.defaultValue);
      }
    );
    // Track the label live while dragging, but only rebuild the preview once
    // the handle is released.
    input.addEventListener("input", () => {
      readout.setText(o.format(Number(input.value)));
      sync();
    });
    input.addEventListener("change", () => emit(Number(input.value)));
  }

  private buildButtons(parent: HTMLElement) {
    const bar = new Setting(parent);
    bar.settingEl.style.flex = "0 0 auto";
    bar.settingEl.style.padding = "14px 0 0";
    bar.settingEl.style.borderTop = "0";
    bar.settingEl.style.alignItems = "center";
    // The status shares the button row, sitting in the Setting's info slot so
    // it stays left-aligned opposite Cancel/Export.
    bar.infoEl.style.display = "flex";
    bar.infoEl.style.alignItems = "center";
    bar.infoEl.style.minHeight = "0";
    this.statusEl = bar.infoEl.createDiv();
    this.statusEl.style.color = "var(--text-muted)";
    this.statusEl.style.fontSize = "0.9em";
    this.statusEl.style.lineHeight = "1.3";
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
    const revision = ++this.previewRevision;
    if (this.busy) {
      this.rebuildRequested = true;
      return;
    }
    this.busy = true;
    const opts = { ...this.opts };
    this.exportBtn.setDisabled(true);
    this.teardownWebview();
    this.previewHost.empty();

    try {
      const renderKey = `${opts.includeTitle}`;
      let prepared = this.preparedByRenderOptions.get(renderKey);
      if (!prepared) {
        this.setStatus("Rendering note…");
        prepared = await prepareNote(this.app, this.file, opts.includeTitle, opts.applyLedeStyles);
        this.preparedByRenderOptions.set(renderKey, prepared);
      }
      const { webview, pageCount, outputText, removedHidden, imageReport, footnotePolicyReport } = await paginateInWebview(
        this.previewHost,
        prepared.bodyHtml,
        opts,
        (stage) => this.setStatus(stage)
      );
      if (revision !== this.previewRevision) {
        webview.remove();
        return;
      }
      this.webview = webview;
      // Keep the guest surface viewport-sized and scroll inside it. A webview
      // as tall as every page exceeds Electron's compositing limits and turns
      // white after the first screenful.
      webview.style.position = "absolute";
      webview.style.inset = "0";
      webview.style.width = "100%";
      webview.style.height = "100%";
      webview.style.display = "flex";

      const ready = `Preview ready: ${pageCount} page${pageCount === 1 ? "" : "s"}.`;

      // Integrity check: only warn on a genuinely dropped contiguous chunk (a
      // long run of consecutive source trigrams absent from the output).
      // Boundary mismatches from footnotes/headings produce only 1-2 and are
      // ignored, so the warning no longer cries wolf.
      const { maxRun, excerpt } = outputText
        ? detectDroppedText(prepared.sourceText, outputText)
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
          `Possible missing passage: "${excerpt.slice(0, 60)}…". Review the preview before exporting.`,
          true
        );
        console.warn(`[PDF Footnotes] possible dropped passage (run=${maxRun}):`, excerpt);
        this.exportBtn.setDisabled(true);
      } else {
        this.setStatus(ready);
        this.exportBtn.setDisabled(false);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.setStatus(`Preview failed: ${msg} (see console: Cmd+Opt+I)`, true);
      console.error("[PDF Footnotes] preview failed:", e);
    } finally {
      this.busy = false;
      if (this.rebuildRequested) {
        this.rebuildRequested = false;
        void this.buildPreview();
      }
    }
  }

  private async doExport() {
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
      const data = await printWebviewToPdf(this.webview, this.opts);
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
