// Convert Obsidian's endnote markup to DPUB-ARIA footnotes. Vivliostyle owns
// both pagination and footnote layout, so references and definitions remain
// semantic source content rather than being moved after pages are generated.

const RETURN_ICON =
  '<svg class="pdf-fn-return-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">' +
  '<path d="M232,144a64.07,64.07,0,0,1-64,64H80a8,8,0,0,1,0-16h88a48,48,0,0,0,0-96H51.31l34.35,34.34a8,8,0,0,1-11.32,11.32l-48-48a8,8,0,0,1,0-11.32l48-48A8,8,0,0,1,85.66,45.66L51.31,80H168A64.07,64.07,0,0,1,232,144Z"/></svg>';

export function endnotesToFootnotes(root: HTMLElement): number {
  const doc = root.ownerDocument;
  const definitions = new Map<string, HTMLElement>();
  root.querySelectorAll("section.footnotes li[id]").forEach((li) => definitions.set(li.id, li as HTMLElement));

  const footnotes: HTMLElement[] = [];
  let count = 0;
  root.querySelectorAll("sup.footnote-ref").forEach((sup) => {
    const oldLink = sup.querySelector('a[href^="#"]');
    const source = oldLink ? definitions.get((oldLink.getAttribute("href") || "").slice(1)) : null;
    if (!source) return;

    count++;
    const refId = `pdf-fnref-${count}`;
    const noteId = `pdf-fn-${count}`;

    const ref = doc.createElement("a");
    ref.className = "pdf-footnote-ref";
    ref.id = refId;
    ref.href = `#${noteId}`;
    ref.setAttribute("role", "doc-noteref");
    const marker = doc.createElement("sup");
    marker.textContent = String(count);
    ref.appendChild(marker);

    const note = doc.createElement("aside");
    note.className = "pdf-footnote";
    note.id = noteId;
    note.setAttribute("role", "doc-footnote");
    const label = doc.createElement("span");
    label.className = "pdf-footnote-label";
    label.textContent = `${count}. `;
    note.appendChild(label);
    const body = (source.querySelector("p") as HTMLElement) || source;
    const clone = body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(".footnote-backref").forEach((el) => el.remove());
    while (clone.firstChild) note.appendChild(clone.firstChild);

    const back = doc.createElement("a");
    back.className = "pdf-fn-return";
    back.href = `#${refId}`;
    back.setAttribute("role", "doc-backlink");
    back.setAttribute("aria-label", "Return to reference");
    back.innerHTML = RETURN_ICON;
    note.appendChild(doc.createTextNode(" "));
    note.appendChild(back);

    sup.replaceWith(ref);
    footnotes.push(note);
  });

  root.querySelectorAll("section.footnotes").forEach((section) => section.remove());
  footnotes.forEach((note) => root.appendChild(note));
  return count;
}
