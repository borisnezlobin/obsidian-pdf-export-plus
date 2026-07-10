// Turn Obsidian's rendered end-of-document footnotes into inline note metadata
// that the export webview can place at the bottom of each page. Obsidian renders a reference as
//   <sup class="footnote-ref"><a href="#fn-ID">n</a></sup>
// and its definition as a <li id="fn-ID"> inside <section class="footnotes">.
// We leave a visible superscript call at the reference and store the definition
// next to it in a hidden span. After Paged.js paginates normal body content, the
// webview maps each call to its page and appends that page's footnotes manually.

// Phosphor "arrow-u-up-left" — a return arrow, matching the user's icon set.
const RETURN_ICON =
  '<svg class="pdf-fn-return-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">' +
  '<path d="M232,144a64.07,64.07,0,0,1-64,64H80a8,8,0,0,1,0-16h88a48,48,0,0,0,0-96H51.31l34.35,34.34a8,8,0,0,1-11.32,11.32l-48-48a8,8,0,0,1,0-11.32l48-48A8,8,0,0,1,85.66,45.66L51.31,80H168A64.07,64.07,0,0,1,232,144Z"/></svg>';

export function endnotesToFootnotes(root: HTMLElement): number {
  const doc = root.ownerDocument;

  const defsById = new Map<string, HTMLElement>();
  root.querySelectorAll("section.footnotes li[id]").forEach((li) => {
    defsById.set(li.id, li as HTMLElement);
  });

  let moved = 0;
  root.querySelectorAll("sup.footnote-ref").forEach((sup) => {
    const link = sup.querySelector('a[href^="#"]');
    if (!link) return;
    const id = (link.getAttribute("href") || "").slice(1);
    const li = defsById.get(id);
    if (!li) return;

    const source = (li.querySelector("p") as HTMLElement) || li;
    source.querySelectorAll(".footnote-backref").forEach((b) => b.remove());

    moved++;
    const backId = `pdf-fnback-${moved}`;
    const footnoteId = String(moved);

    const ref = doc.createElement("sup");
    ref.className = "pdf-footnote-ref";
    ref.id = backId;
    ref.setAttribute("data-pdf-footnote-ref", footnoteId);
    ref.textContent = footnoteId;

    const span = doc.createElement("span");
    span.className = "pdf-footnote-data";
    span.setAttribute("data-pdf-footnote", footnoteId);
    span.innerHTML = source.innerHTML.trim();

    // A return link, appended to the footnote, that jumps back to the reference.
    const ret = doc.createElement("a");
    ret.className = "pdf-fn-return";
    ret.setAttribute("href", `#${backId}`);
    ret.setAttribute("aria-label", "Return to reference");
    ret.innerHTML = RETURN_ICON;
    span.appendChild(doc.createTextNode(" "));
    span.appendChild(ret);

    sup.replaceWith(ref, span);
  });

  root.querySelectorAll("section.footnotes").forEach((s) => s.remove());
  return moved;
}
