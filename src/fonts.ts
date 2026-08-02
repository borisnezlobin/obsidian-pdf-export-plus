// Families worth offering for a printed document, across macOS and Windows.
// The list is a starting point, not a limit: the font field stays free text so
// any installed family can be typed in.
const CANDIDATE_FAMILIES = [
  "Adobe Caslon Pro", "Arial", "Athelas", "Avenir", "Avenir Next", "Baskerville", "Bembo", "Bodoni 72",
  "Book Antiqua", "Bookman Old Style", "Calibri", "Cambria", "Candara", "Caslon", "Centaur",
  "Century Schoolbook", "Charis SIL", "Charter", "Consolas", "Constantia", "Courier New", "Crimson Text",
  "Didot", "EB Garamond", "Franklin Gothic Book", "Futura", "Garamond", "Georgia", "Gill Sans",
  "Helvetica", "Helvetica Neue", "Hoefler Text", "IBM Plex Sans", "IBM Plex Serif", "Inter",
  "Iowan Old Style", "Lato", "Libre Baskerville", "Literata", "Lora", "Lucida Bright", "Menlo",
  "Merriweather", "Minion Pro", "New York", "Open Sans", "Optima", "PT Serif", "Palatino",
  "Palatino Linotype", "Perpetua", "Roboto", "Roboto Slab", "Rockwell", "Sabon", "Segoe UI",
  "Source Sans Pro", "Source Serif Pro", "Spectral", "Tahoma", "Times New Roman", "Trebuchet MS",
  "Verdana", "Vollkorn", "Warnock Pro",
];

const PROBE_TEXT = "MMMMMMMMWWWWWWWWliiiil18";
const FALLBACKS = ["monospace", "serif", "sans-serif"];

// A family is installed when asking for it changes the measured text width
// against every generic fallback; if it is missing, the fallback renders and
// the widths match exactly.
function isInstalled(context: CanvasRenderingContext2D, family: string): boolean {
  return FALLBACKS.every((fallback) => {
    context.font = `72px ${fallback}`;
    const baseline = context.measureText(PROBE_TEXT).width;
    context.font = `72px "${family}", ${fallback}`;
    return context.measureText(PROBE_TEXT).width !== baseline;
  });
}

export function installedFonts(current: string): string[] {
  const context = document.createElement("canvas").getContext("2d");
  const families = context
    ? CANDIDATE_FAMILIES.filter((family) => isInstalled(context, family))
    : CANDIDATE_FAMILIES;
  const trimmed = current.trim();
  if (trimmed && !families.some((family) => family.toLowerCase() === trimmed.toLowerCase())) {
    families.push(trimmed);
  }
  return families.sort((a, b) => a.localeCompare(b));
}
