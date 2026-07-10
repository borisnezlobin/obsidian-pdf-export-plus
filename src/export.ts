import { App, TFile } from "obsidian";
import { req } from "./node";
import { renderNoteToHtml } from "./render";
import { PdfFootnotesSettings } from "./settings";
import { endnotesToFootnotes } from "./transform";

export interface PreparedNote {
  bodyHtml: string;
  footnoteCount: number;
  sourceText: string;
}

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// How many of the source's sentences are missing from the paginated output.
// Sentence-presence (not char count) is robust against Paged.js inserting
// footnote marker numbers, which would otherwise mask real dropped paragraphs.
function words(text: string): string[] {
  return normalizeText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

// Detect genuinely dropped content by finding the longest run of consecutive
// source word-trigrams absent from the output. A real dropped paragraph is a
// long consecutive run; footnote/heading boundary mismatches are only 1-2
// trigrams, so this doesn't cry wolf the way sentence-prefix matching did.
export function detectDroppedText(sourceText: string, outputText: string): { maxRun: number; excerpt: string } {
  const src = words(sourceText);
  const out = words(outputText);
  const outTrigrams = new Set<string>();
  for (let i = 0; i + 2 < out.length; i++) outTrigrams.add(out[i] + " " + out[i + 1] + " " + out[i + 2]);

  let maxRun = 0;
  let run = 0;
  let runStart = 0;
  let maxStart = 0;
  for (let i = 0; i + 2 < src.length; i++) {
    const tg = src[i] + " " + src[i + 1] + " " + src[i + 2];
    if (!outTrigrams.has(tg)) {
      if (run === 0) runStart = i;
      run++;
      if (run > maxRun) {
        maxRun = run;
        maxStart = runStart;
      }
    } else {
      run = 0;
    }
  }
  const excerpt = maxRun > 0 ? src.slice(maxStart, maxStart + Math.min(maxRun + 2, 16)).join(" ") : "";
  return { maxRun, excerpt };
}

// Write a diagnostic report (debug mode) so a single export reveals exactly
// what was dropped and why, without a live debugging session.
export function writeDebugReport(
  fileName: string,
  info: {
    pageCount: number;
    removedHidden: string[];
    imageReport: string[];
    footnotePolicyReport: string[];
    droppedRun: number;
    droppedExcerpt: string;
  }
): void {
  try {
    const fs = req("fs");
    const os = req("os");
    const path = req("path");
    const lines = [
      `PDF Footnotes debug report — ${fileName}`,
      `pages: ${info.pageCount}`,
      ``,
      `IMAGES in output (${info.imageReport.length}):`,
      ...info.imageReport.map((s) => "  " + s),
      ``,
      `FOOTNOTE POLICIES in output (${info.footnotePolicyReport.length}):`,
      ...info.footnotePolicyReport.map((s) => "  " + s),
      ``,
      `HIDDEN elements removed before pagination (${info.removedHidden.length}):`,
      ...info.removedHidden.map((s) => "  " + s),
      ``,
      `LONGEST dropped run: ${info.droppedRun} consecutive trigrams${info.droppedRun >= 8 ? " (LIKELY REAL LOSS)" : " (noise — content present)"}`,
      info.droppedExcerpt ? `  around: "${info.droppedExcerpt}"` : "",
    ];
    const outPath = path.join(os.homedir(), "Downloads", "pdf-footnotes-debug-report.txt");
    fs.writeFileSync(outPath, lines.join("\n"), "utf8");
    console.log(`[PDF Footnotes] debug report written to ${outPath}`);
  } catch (e) {
    console.warn("[PDF Footnotes] debug report failed", e);
  }
}

// Render the note to HTML and move its footnotes inline so Paged.js can float
// them to page bottoms. Optionally prepend the note's title as an H1.
export async function prepareNote(
  app: App,
  file: TFile,
  includeTitle: boolean
): Promise<PreparedNote> {
  const markdown = await app.vault.read(file);
  const container = await renderNoteToHtml(app, markdown, file.path);
  const footnoteCount = endnotesToFootnotes(container);

  if (includeTitle) {
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
    const title = (frontmatter?.title as string) || file.basename;
    const sizer = container.querySelector(".markdown-preview-sizer") ?? container;
    const h1 = createEl("h1", { cls: "pdf-footnotes-title", text: title });
    sizer.insertBefore(h1, sizer.firstChild);
  }

  return {
    bodyHtml: container.outerHTML,
    footnoteCount,
    sourceText: normalizeText(container.textContent ?? ""),
  };
}

export function defaultOutputPath(file: TFile, settings: PdfFootnotesSettings): string {
  const os = req("os");
  const path = req("path");
  const folder =
    settings.exportFolder && settings.exportFolder.trim()
      ? settings.exportFolder.replace(/^~(?=\/)/, os.homedir())
      : path.join(os.homedir(), "Downloads");
  return path.join(folder, `${file.basename}.pdf`);
}

// The Electron shell/dialog, whether exposed directly or via @electron/remote.
function electronDialog(): any {
  const e = req("electron");
  return e.remote?.dialog ?? e.dialog ?? null;
}
function electronShell(): any {
  const e = req("electron");
  return e.remote?.shell ?? e.shell ?? null;
}

export interface SaveChoice {
  path: string | null;
  usedDialog: boolean;
}

// Native save dialog (Electron via @electron/remote), same as Better Export PDF.
// If remote isn't available, fall back to the default path so export still works.
export async function chooseSavePath(defaultPath: string): Promise<SaveChoice> {
  const dialog = electronDialog();
  if (!dialog) return { path: defaultPath, usedDialog: false };
  const result = await dialog.showSaveDialog({
    title: "Export to PDF",
    defaultPath,
    filters: [
      { name: "PDF", extensions: ["pdf"] },
      { name: "All Files", extensions: ["*"] },
    ],
    properties: ["showOverwriteConfirmation", "createDirectory"],
  });
  return { path: result.canceled || !result.filePath ? null : result.filePath, usedDialog: true };
}

export function writePdf(outputPath: string, data: Uint8Array, open: boolean): void {
  const fs = req("fs");
  const path = req("path");
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, Buffer.from(data));
  if (open) {
    try {
      electronShell()?.openPath(outputPath);
    } catch (e) {
      console.warn("[PDF Footnotes] openPath failed", e);
    }
  }
}

export function revealPdf(outputPath: string): void {
  try {
    electronShell()?.showItemInFolder(outputPath);
  } catch (e) {
    console.warn("[PDF Footnotes] showItemInFolder failed", e);
  }
}
