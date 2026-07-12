import esbuild from "esbuild";
import fs from "node:fs";

const bundle = await esbuild.build({
  stdin: {
    contents: `import * as Core from "@vivliostyle/core"; window.VivliostyleCore = Core;`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  write: false,
  minify: true,
});

const paragraph = (n) =>
  `<p data-sequence="${n}">Paragraph ${n}: The pagination test preserves every numbered sentence and every word across page boundaries. ` +
  `Custom typography, spacing, links, and footnotes must remain visible in the final PDF without clipping or overlap.</p>`;
const content = Array.from({ length: 34 }, (_, i) => paragraph(i + 1));
content.splice(
  7,
  0,
  `<p>First reference<a id="ref-1" href="#note-1" role="doc-noteref"><sup>1</sup></a> continues after the marker.</p>` +
    `<aside id="note-1" role="doc-footnote">1. A short page-local footnote. <a href="#ref-1">return</a></aside>`,
);
content.splice(
  20,
  0,
  `<p>Second reference<a id="ref-2" href="#note-2" role="doc-noteref"><sup>2</sup></a> continues after the marker.</p>` +
    `<aside id="note-2" role="doc-footnote">2. This longer footnote has enough text to wrap across several lines. It verifies that the footnote area grows from its contents instead of reserving a constant fraction of every page. <a href="#ref-2">return</a></aside>`,
);

const realSource = process.env.REAL_SOURCE;
let documentHtml = content.join("\n");
if (realSource) {
  const captured = fs.readFileSync(realSource, "utf8");
  const body = captured.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (!body) throw new Error(`No body found in ${realSource}`);
  documentHtml = body[1];
}

const pageCss = `
  @page { size: A4; margin: 18mm 18mm 22mm; @bottom-center { content: counter(page) " / " counter(pages); } @footnote { border-top: .5pt solid #888; margin-top: 8pt; padding-top: 6pt; } }
  body { margin: 0; font: 16px/${realSource ? "3" : "2.1"} Georgia, serif; color: #17202a; }
  p { margin: 0 0 1.1em; }
  img { display: block; max-width: 100%; max-height: 120mm; object-fit: contain; break-inside: avoid; }
  [role=doc-footnote] { float: footnote; font-size: 10pt; line-height: 1.35; }
  [role=doc-noteref] { vertical-align: super; font-size: 70%; }
`;
const payload = Buffer.from(JSON.stringify({ html: documentHtml, css: pageCss })).toString("base64");
const html = `<!doctype html><meta charset="utf-8"><style>html,body,#viewport{width:100%;height:100%;margin:0}#viewport{overflow:visible}</style><div id="viewport" data-vivliostyle-viewer-viewport></div><script>${bundle.outputFiles[0].text}</script><script>
const payload=JSON.parse(atob(${JSON.stringify(payload)}));
const source=document.implementation.createHTMLDocument("smoke");
source.body.innerHTML=payload.html;
const viewer=new VivliostyleCore.CoreViewer({viewportElement:document.getElementById("viewport"),window,debug:false},{renderAllPages:true,pageViewMode:VivliostyleCore.PageViewMode.SINGLE_PAGE,fitToScreen:false,allowScripts:false,pixelRatio:Number(new URLSearchParams(location.search).get("pixelRatio")||8)});
function words(text){return text.toLowerCase().normalize("NFKD").replace(/[^\\p{L}\\p{N}\\s]/gu," ").split(/\\s+/).filter(Boolean)}
function missingRun(sourceText,outputText){
  const sourceWords=words(sourceText), outputWords=words(outputText), seen=new Set();
  for(let i=0;i+2<outputWords.length;i++)seen.add(outputWords.slice(i,i+3).join(" "));
  let run=0,max=0,start=0,maxStart=0;
  for(let i=0;i+2<sourceWords.length;i++){
    if(!seen.has(sourceWords.slice(i,i+3).join(" "))){if(!run)start=i;run++;if(run>max){max=run;maxStart=start}}
    else run=0;
  }
  return {max,excerpt:sourceWords.slice(maxStart,maxStart+16).join(" ")};
}
function preparePrint(){
  document.documentElement.style.cssText+="height:auto!important;overflow:visible!important";
  document.body.style.cssText+="height:auto!important;overflow:visible!important";
  const viewport=document.getElementById("viewport");
  viewport.style.cssText+="display:block!important;position:static!important;height:auto!important;overflow:visible!important";
  document.querySelectorAll("[data-vivliostyle-outer-zoom-box],[data-vivliostyle-spread-container]").forEach(el=>el.style.cssText+="height:auto!important;width:100%!important");
  document.querySelectorAll("[data-vivliostyle-page-container]").forEach(el=>el.style.cssText+="display:block!important;visibility:visible!important");
  document.querySelectorAll('a[href*="pdf-fn"],a[href*="note-"],a[href*="ref-"]').forEach(link=>{
    const match=link.getAttribute("href").match(/(?:#|:0023)((?:pdf-fn(?:ref)?|note|ref)-\\d+)$/);
    if(match)link.setAttribute("href","#"+match[1]);
  });
  const ids=new Set(Array.from(document.querySelectorAll('a[href^="#"]')).map(link=>link.getAttribute("href").slice(1)));
  ids.forEach(id=>{
    const targets=Array.from(document.querySelectorAll('[id="'+id+'"]'));
    const target=targets.find(el=>el.closest("[data-vivliostyle-page-container]"));
    if(!target)return;
    targets.forEach(el=>el.removeAttribute("id"));
    const anchor=document.createElement("span");
    anchor.id=id;
    anchor.style.cssText="display:inline-block;width:0;height:0;overflow:hidden;vertical-align:top";
    target.parentNode.insertBefore(anchor,target);
  });
}
viewer.addListener("readystatechange",()=>{if(viewer.readyState===VivliostyleCore.ReadyState.COMPLETE){
  const integrity=missingRun(source.body.textContent||"",document.getElementById("viewport").textContent||"");
  document.documentElement.dataset.ready="true";
  document.documentElement.dataset.missingRun=String(integrity.max);
  document.documentElement.dataset.missingExcerpt=integrity.excerpt;
  document.documentElement.dataset.sourceWords=String(words(source.body.textContent||"").length);
  document.documentElement.dataset.outputWords=String(words(document.getElementById("viewport").textContent||"").length);
  document.documentElement.dataset.images=String(document.querySelectorAll("#viewport img").length);
  document.documentElement.dataset.footnotes=String(document.querySelectorAll("#viewport [role=doc-footnote],#viewport .-vivliostyle-footnote-content").length);
  document.title="READY-"+viewer.getPageSizes().length+"-RUN-"+integrity.max;
  if(location.search.includes("print=1"))preparePrint();
}});
viewer.addListener("error",event=>{document.title="ERROR-"+String(event?.content?.error||event?.content?.messages||"layout");});
viewer.loadDocument({url:location.href},{documentObject:source,authorStyleSheet:[{text:payload.css}]});
</script>`;
fs.writeFileSync("/tmp/pdf-footnotes-vivliostyle-smoke.html", html);
console.log("wrote /tmp/pdf-footnotes-vivliostyle-smoke.html");
