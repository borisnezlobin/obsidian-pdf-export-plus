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
    await MarkdownRenderer.render(app, separateTrailingListParagraphs(markdown), sizer, sourcePath, component);
  } finally {
    component.unload();
  }
  stripHidden(container);
  hoistImageEmbeds(container);
  await inlineImages(app, container, sourcePath);
  return container;
}

// Obsidian's detached MarkdownRenderer can absorb an unindented line directly
// after a list into the final <li>, even though Reading view presents it as a
// separate paragraph. Make that boundary explicit before rendering.
function separateTrailingListParagraphs(markdown: string): string {
  const lines = markdown.split("\n");
  const isListItem = (line: string) => /^\s*(?:[-+*]|\d+[.)])\s+\S/.test(line);
  for (let i = lines.length - 1; i > 0; i--) {
    if (lines[i].trim() && !/^\s/.test(lines[i]) && !isListItem(lines[i]) && isListItem(lines[i - 1])) {
      lines.splice(i, 0, "");
    }
  }
  return lines.join("\n");
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

// Un-wrap every `@media print { … }` block so its rules apply during the
// on-screen preview too — this is where the user's theme/snippet puts
// print-only styling (e.g. --p-spacing), which decides how content paginates.
// Uses the CSSOM (CSSMediaRule.cssRules) rather than regex, so multiple print
// blocks per sheet are handled correctly. Safe to apply globally only because
// the note is rendered inside a `.print` wrapper (Obsidian's core print rule
// hides non-".print" body children).
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
        .map((r) =>
          r.cssText.replace(/--line-height(?:-customize|-normal)?\s*:[^;}]+;?/gi, ""),
        )
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

// Snapshot of the main Obsidian window's chrome, so the webview can reproduce
// the exact theme context: the head carries theme/snippet <link> stylesheets
// that can't be read via cssRules (cross-origin), and CSS variables live on the
// body theme classes.
export interface ThemeContext {
  headHtml: string;
  bodyClass: string;
  bodyStyle: string;
}

// Pseudo-element styling that draws real content — MathJax CHTML paints every
// math glyph via `mjx-c::before { content: "…" }` — lives only in stylesheet
// rules, so element snapshots alone leave math as empty boxes. Capture the few
// properties that reproduce painted pseudo content.
const PSEUDO_PROPERTIES = [
  "content", "font-family", "font-size", "font-style", "font-weight", "color",
  "display", "letter-spacing", "vertical-align", "width", "min-width",
  "padding-left", "padding-right", "margin-left", "margin-right",
];

function capturePseudoDeclarations(element: HTMLElement, pseudo: "::before" | "::after"): string {
  const computed = getComputedStyle(element, pseudo);
  const content = computed.getPropertyValue("content");
  if (!content || content === "none" || content === "normal") return "";
  return PSEUDO_PROPERTIES
    .map((property) => [property, computed.getPropertyValue(property)] as const)
    .filter(([, value]) => value)
    .map(([property, value]) => `${property}:${value}`)
    .join(";");
}

// ::first-line and ::first-letter style whole layout fragments, which computed
// element snapshots cannot represent. Forward the matching rules verbatim
// (lede bolding, drop caps, and similar custom print CSS keep working in the
// export), and report the font families they use so their @font-face rules can
// be inlined too. Rules inside @media print blocks are unwrapped, matching how
// collectPrintStyles treats print-only styling.
function collectFragmentPseudoRules(root: HTMLElement): { css: string; families: Set<string> } {
  const out: string[] = [];
  const families = new Set<string>();
  const visit = (rules: CSSRuleList | null) => {
    for (const rule of Array.from(rules ?? [])) {
      if (rule.constructor.name === "CSSMediaRule") {
        const media = rule as CSSMediaRule;
        if (media.conditionText.includes("print")) visit(media.cssRules);
        continue;
      }
      if (rule.constructor.name !== "CSSStyleRule") continue;
      const styleRule = rule as CSSStyleRule;
      const selector = styleRule.selectorText || "";
      if (!/::first-(?:line|letter)/.test(selector)) continue;
      const applies = selector.split(",").some((part) => {
        const base = part.replace(/::first-(?:line|letter)/g, "").trim();
        try {
          return base ? !!root.querySelector(base) || root.matches(base) : false;
        } catch {
          return false;
        }
      });
      if (!applies) continue;
      out.push(styleRule.cssText);
      for (const family of styleRule.style.getPropertyValue("font-family").split(",")) {
        const name = family.trim().replace(/^["']|["']$/g, "").toLowerCase();
        if (name) families.add(name);
      }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      visit(sheet.cssRules);
    } catch {
      /* cross-origin sheet */
    }
  }
  return { css: out.join("\n"), families };
}

// Web fonts the export webview must be able to load on its own: MathJax's
// glyph fonts (math pseudo-content renders with them) plus any family that the
// forwarded fragment pseudo rules reference (e.g. a drop-cap face). Font files
// are inlined as data: URIs.
async function collectExportFontFaces(extraFamilies: Set<string>): Promise<string> {
  const faces: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules ?? [])) {
      if (rule.constructor.name !== "CSSFontFaceRule") continue;
      const css = rule.cssText;
      const family = (rule as CSSFontFaceRule).style
        .getPropertyValue("font-family")
        .trim()
        .replace(/^["']|["']$/g, "")
        .toLowerCase();
      if (!/MJX|MathJax/i.test(css) && !extraFamilies.has(family)) continue;
      faces.push(await inlineFontUrls(css));
    }
  }
  return faces.join("\n");
}

async function inlineFontUrls(fontFaceCss: string): Promise<string> {
  const urls = [...fontFaceCss.matchAll(/url\((['"]?)([^'")]+)\1\)/g)];
  let out = fontFaceCss;
  for (const [whole, , url] of urls) {
    if (url.startsWith("data:")) continue;
    try {
      const blob = await (await fetch(url)).blob();
      out = out.replace(whole, `url(${await blobToDataUri(blob)})`);
    } catch (e) {
      console.warn("[PDF Footnotes] could not inline font", url.slice(0, 80), e);
    }
  }
  return out;
}

// Freeze the note's browser-resolved appearance onto the exported elements.
// Vivliostyle should paginate the note, not parse Obsidian's entire application
// stylesheet (which contains UI-only selectors and newer CSS syntax). Keeping
// the snapshot inline preserves theme/snippet typography and component styling
// while giving the pagination document a small, deterministic CSS surface.
export async function snapshotComputedStyles(root: HTMLElement, applyLedeStyles: boolean): Promise<void> {
  const printStyle = document.createElement("style");
  printStyle.setAttribute("data-pdf-print-snapshot", "true");
  printStyle.textContent = collectPrintStyles().join("\n");
  document.head.appendChild(printStyle);
  const mount = document.createElement("div");
  mount.style.cssText =
    "position:fixed;left:-100000px;top:0;width:var(--file-line-width,700px);visibility:hidden;pointer-events:none;";
  document.body.appendChild(mount);
  mount.appendChild(root);

  const elements = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))];
  const kept = new Set([
    "background-color", "background-image", "border-bottom-color", "border-bottom-left-radius", "border-bottom-right-radius",
    "border-bottom-style", "border-bottom-width", "border-left-color", "border-left-style", "border-left-width", "border-right-color",
    "border-right-style", "border-right-width", "border-top-color", "border-top-left-radius", "border-top-right-radius",
    "border-top-style", "border-top-width", "box-shadow", "box-sizing", "color", "display", "fill", "font-family", "font-size",
    "font-style", "font-weight", "letter-spacing", "line-height", "list-style-image", "list-style-position", "list-style-type",
    "margin-bottom", "margin-left", "margin-right", "margin-top", "opacity", "padding-bottom", "padding-left", "padding-right",
    "padding-top", "stroke", "text-align", "text-decoration-color", "text-decoration-line", "text-decoration-style", "text-indent",
    "text-transform", "text-underline-offset", "vertical-align", "white-space", "word-break", "word-spacing", "overflow-wrap",
  ]);
  const snapshots: Array<Array<[string, string, string]>> = [];
  const pseudoSnapshots: Array<{ before: string; after: string }> = [];
  for (const element of elements) {
    const computed = getComputedStyle(element);
    const declarations: Array<[string, string, string]> = [];
    for (const property of Array.from(computed)) {
      if (!kept.has(property)) continue;
      const value = computed.getPropertyValue(property);
      if (value) declarations.push([property, value, computed.getPropertyPriority(property)]);
    }
    snapshots.push(declarations);
    pseudoSnapshots.push({
      before: capturePseudoDeclarations(element, "::before"),
      after: capturePseudoDeclarations(element, "::after"),
    });
  }

  mount.removeChild(root);
  mount.remove();
  printStyle.remove();
  const styleRules: string[] = [];
  const classByDeclarations = new Map<string, string>();
  elements.forEach((element, index) => {
    const declarations = snapshots[index]
      .map(([property, value, priority]) =>
        `${property}:${value}${priority ? ` !${priority}` : ""}`,
      )
      .join(";");
    const pseudo = pseudoSnapshots[index];
    const key = `${declarations}|${pseudo.before}|${pseudo.after}`;
    let className = classByDeclarations.get(key);
    if (!className) {
      className = `pdf-computed-${classByDeclarations.size}`;
      classByDeclarations.set(key, className);
      styleRules.push(`.${className}{${declarations}}`);
      if (pseudo.before) styleRules.push(`.${className}::before{${pseudo.before}}`);
      if (pseudo.after) styleRules.push(`.${className}::after{${pseudo.after}}`);
    }
    element.classList.add(className);
  });
  const fragmentPseudo = applyLedeStyles
    ? collectFragmentPseudoRules(root)
    : { css: "", families: new Set<string>() };
  const style = root.ownerDocument.createElement("style");
  style.setAttribute("data-pdf-computed-styles", "true");
  style.textContent = [
    await collectExportFontFaces(fragmentPseudo.families),
    styleRules.join("\n"),
    fragmentPseudo.css,
  ].join("\n");
  root.prepend(style);
}

export function captureThemeContext(): ThemeContext {
  return {
    headHtml: document.head.innerHTML,
    bodyClass: document.body.className,
    bodyStyle: document.body.getAttribute("style") ?? "",
  };
}
