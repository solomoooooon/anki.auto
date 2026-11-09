import {access,readFile,stat} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../dist/extension");
const manifest=JSON.parse(await readFile(path.join(root,"manifest.json"),"utf8"));
const required=[manifest.background.service_worker,manifest.action.default_popup,manifest.options_page,
  ...manifest.content_scripts.flatMap(s=>s.js),...manifest.web_accessible_resources.flatMap(s=>s.resources),
  "capture.html","review.html","pdf.html","ocr.html","vendor/pdf/pdf.worker.mjs","vendor/ocr/worker.min.js",
  "vendor/ocr/core/tesseract-core-simd-lstm.wasm.js","vendor/ocr/lang/eng.traineddata.gz","vendor/ocr/lang/fra.traineddata.gz","vendor/pdf/text-layer.css"];
for(const name of required)await access(path.join(root,name));
for(const name of ["capture","review","pdf","ocr","settings","popup"]){
  const html=await readFile(path.join(root,name+".html"),"utf8");
  for(const [,url] of html.matchAll(/(?:src|href)="([^"#]+)"/g))if(!/^[a-z]+:/.test(url))await access(path.join(root,url.split("#")[0]));
}
for(const language of ["eng","fra"])if((await stat(path.join(root,`vendor/ocr/lang/${language}.traineddata.gz`))).size<100000)throw new Error("Missing OCR data");
const pdfCSS=await readFile(path.join(root,"vendor/pdf/text-layer.css"),"utf8");
for(const variable of ["--font-height","--scale-x","--rotate","--text-scale-factor"])if(!pdfCSS.includes(`var(${variable})`))throw new Error("PDF text selection geometry is missing "+variable);
const pdfHTML=await readFile(path.join(root,"pdf.html"),"utf8");
if(!pdfHTML.includes('href="vendor/pdf/text-layer.css"'))throw new Error("PDF text layer stylesheet is not connected to reader");
console.log("Artifact smoke check passed: entry pages, manifest resources, PDF worker and local OCR assets.");
