import { App, Component, MarkdownRenderer } from "obsidian";

// Render the note the way Reading view / PDF export does, into a detached
// element we can post-process. Uses Obsidian's own renderer so footnotes,
// links, math, and embeds match the app.
export async function renderNoteToHtml(
  app: App,
  markdown: string,
  sourcePath: string
): Promise<HTMLElement> {
  // Match Obsidian's reading-view nesting so theme/snippet selectors that target
  // .markdown-preview-sizer / .markdown-preview-section resolve as they do live.
  const container = document.createElement("div");
  container.className = "markdown-preview-view markdown-rendered print-root";
  const sizer = container.createDiv("markdown-preview-sizer markdown-preview-section");

  const component = new Component();
  component.load();
  try {
    await MarkdownRenderer.render(app, markdown, sizer, sourcePath, component);
  } finally {
    component.unload();
  }
  stripHidden(container);
  hoistImageEmbeds(container);
  await inlineImages(app, container, sourcePath);
  return container;
}

// MarkdownRenderer puts image embeds INLINE inside a paragraph
// (`<p>…text…<br><span class="internal-embed"><img></span>…</p>`). Paged.js
// can't move an inline image to the next page when it doesn't fit, so a tall
// image lands at the page bottom and overflows (clipped in print). Lift each
// image embed out into its own block sibling so Paged.js can move it.
//
// The image can sit anywhere in the paragraph — before its caption, after body
// text, or between. So SPLIT the paragraph at the image into
// [before] [image block] [after], preserving document order (an earlier
// version that always moved the image to the paragraph's end flipped
// image-then-caption pairs).
function hoistImageEmbeds(container: HTMLElement): void {
  const doc = container.ownerDocument;
  const embeds = Array.from(container.querySelectorAll(".internal-embed.image-embed, .image-embed, .media-embed"));
  for (const embed of embeds) {
    if (!embed.querySelector("img")) continue;
    const p = embed.closest("p");
    if (!p || !p.parentElement) continue;

    // Move everything after the embed into a new trailing paragraph.
    const after = doc.createElement("p");
    let node = embed.nextSibling;
    while (node) {
      const next = node.nextSibling;
      after.appendChild(node);
      node = next;
    }

    // p (content before) → image block → after (content after).
    p.after(embed);
    embed.after(after);

    trimEdgeBrsAndPrune(p);
    trimEdgeBrsAndPrune(after);
  }
}

function trimEdgeBrsAndPrune(p: HTMLElement): void {
  while (p.firstChild && p.firstChild.nodeName === "BR") p.removeChild(p.firstChild);
  while (p.lastChild && p.lastChild.nodeName === "BR") p.removeChild(p.lastChild);
  if (!(p.textContent || "").trim() && !p.querySelector("img")) p.remove();
}

// Remove elements that won't print anyway: the hidden YAML frontmatter block
// MarkdownRenderer emits, and anything with display:none. Besides being clutter,
// a display:none element has a null offsetParent, which crashes Paged.js's
// layout pass and drops surrounding content.
function stripHidden(container: HTMLElement): void {
  container
    .querySelectorAll('.frontmatter, pre.frontmatter, [style*="display: none"], [style*="display:none"]')
    .forEach((el) => el.remove());
}

// Obsidian renders embedded images with `app://` resource URLs that resolve in
// the main window but NOT inside the export <webview> — so those images silently
// fail to load (they vanish). Replace each with a self-contained data: URI.
// Vault embeds (`![[img.png]]`) are resolved to their file and read directly
// (the reliable path); anything else falls back to fetching its src.
async function inlineImages(app: App, container: HTMLElement, sourcePath: string): Promise<void> {
  const imgs = Array.from(container.querySelectorAll("img"));
  let viaEmbed = 0;
  let viaFetch = 0;
  let failed = 0;

  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute("src") ?? "";
      if (src.startsWith("data:")) return;

      // Preferred: resolve the vault embed to its file and read the bytes.
      const link =
        img.closest(".internal-embed")?.getAttribute("src") ||
        img.getAttribute("alt") ||
        img.getAttribute("data-src");
      if (link) {
        const file = app.metadataCache.getFirstLinkpathDest(link, sourcePath);
        if (file) {
          try {
            const bytes = await app.vault.readBinary(file);
            img.setAttribute("src", `data:${mimeForExtension(file.extension)};base64,${arrayBufferToBase64(bytes)}`);
            img.removeAttribute("srcset");
            viaEmbed++;
            return;
          } catch (e) {
            console.warn("[PDF Footnotes] could not read embed", link, e);
          }
        }
      }

      // Fallback: fetch whatever src the renderer produced (app:// or https).
      if (!src) {
        failed++;
        return;
      }
      try {
        const blob = await (await fetch(src)).blob();
        img.setAttribute("src", await blobToDataUri(blob));
        img.removeAttribute("srcset");
        viaFetch++;
      } catch (e) {
        failed++;
        console.warn("[PDF Footnotes] could not inline image", src.slice(0, 80), e);
      }
    })
  );

  console.log(
    `[PDF Footnotes] images: ${imgs.length} found, ${viaEmbed} via vault, ${viaFetch} via fetch, ${failed} FAILED`
  );
}

function mimeForExtension(ext: string): string {
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    avif: "image/avif",
    bmp: "image/bmp",
  };
  return map[ext.toLowerCase()] ?? "application/octet-stream";
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// The app's stylesheets, one string per sheet, so the exported PDF matches
// Obsidian's typography. Mirrors Better Export PDF's getAllStyles (skips the
// Svelte UI sheets and any that can't be read).
export function collectStyleSheets(): string[] {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    const id = (sheet.ownerNode as HTMLElement | null)?.id;
    if (id && id.startsWith("svelte-")) continue;
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    if (!rules) continue;
    const parts: string[] = [];
    for (const rule of Array.from(rules)) parts.push(rule.cssText);
    if (parts.length) out.push(parts.join("\n"));
  }
  return out;
}

// Kept for older debug builds, but pagination no longer unwraps print CSS into
// the live preview. Obsidian's print rules include structural app hiding rules,
// and applying those on screen can hide Paged.js's own measurement containers.
export function collectPrintStyles(): string[] {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    if (!rules) continue;
    for (const rule of Array.from(rules)) {
      if (rule.constructor.name !== "CSSMediaRule") continue;
      const media = rule as CSSMediaRule;
      if (!media.conditionText.includes("print")) continue;
      const inner = Array.from(media.cssRules)
        .map((r) => r.cssText)
        // CRITICAL: drop any rule that HIDES something. Obsidian's print CSS
        // includes `body > :not(.print){display:none}`, and un-wrapping it to
        // apply on screen hides Paged.js's own (transient, body-level) layout
        // nodes — nulling their offsetParent and crashing pagination, which
        // silently drops content. We only want the print typography here
        // (spacing, sizes), never the structural hide rules.
        .filter((css) => !/display\s*:\s*none/i.test(css))
        .join("\n");
      if (inner) out.push(inner);
    }
  }
  return out;
}

// Snapshot only the theme identity needed for CSS variables and reading-view
// typography. Do not carry over app-window chrome classes such as mod-macos,
// is-frameless, is-hidden-frameless, or plugin UI state; those can activate
// layout/visibility rules that break Paged.js measurements.
export interface ThemeContext {
  bodyClass: string;
}

export function captureThemeContext(): ThemeContext {
  const keep = new Set([
    "theme-light",
    "theme-dark",
    "css-settings-manager",
    "is-mobile",
    "is-phone",
    "is-tablet",
  ]);
  const classes = Array.from(document.body.classList).filter((cls) => keep.has(cls) || cls.startsWith("theme-"));
  if (!classes.some((cls) => cls === "theme-light" || cls === "theme-dark")) classes.push("theme-light");
  return {
    bodyClass: Array.from(new Set(classes)).join(" "),
  };
}
