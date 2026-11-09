import {build} from "esbuild";
import {cp,mkdir,readdir,rm,copyFile,writeFile,readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const out=path.resolve(root,"dist","extension");
if(path.relative(root,out)!==path.join("dist","extension"))throw new Error("Unsafe output path");
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
const pages=["background","popup","settings","capture","review","pdf","ocr"];
await build({entryPoints:pages.map(p=>path.join(root,"extension/src",p+".ts")),outdir:out,bundle:true,format:"esm",target:"chrome130",logLevel:"warning",legalComments:"linked"});
await build({entryPoints:[path.join(root,"extension/src/content.ts")],outfile:path.join(out,"content.js"),bundle:true,format:"iife",target:"chrome130"});
for(const entry of await readdir(path.join(root,"extension/src")))if(/\.(html|css)$/.test(entry))await copyFile(path.join(root,"extension/src",entry),path.join(out,entry));
await copyFile(path.join(root,"extension/manifest.json"),path.join(out,"manifest.json"));
async function copy(source,destination){await cp(path.join(root,"node_modules",source),path.join(out,"vendor",destination),{recursive:true});}
await copy("pdfjs-dist/build/pdf.worker.mjs","pdf/pdf.worker.mjs");
const viewerCSS=await readFile(path.join(root,"node_modules/pdfjs-dist/web/pdf_viewer.css"),"utf8");
const textStart=viewerCSS.indexOf(".textLayer {"),textEnd=viewerCSS.indexOf(".annotationLayer {",textStart);
if(textStart<0||textEnd<textStart)throw new Error("PDF.js text-layer stylesheet structure changed");
await writeFile(path.join(out,"vendor/pdf/text-layer.css"),"/* PDF.js text layer; Apache-2.0. See licenses/pdfjs-dist-LICENSE. */\n"+viewerCSS.slice(textStart,textEnd));
for(const name of ["cmaps","standard_fonts","wasm"])await copy("pdfjs-dist/"+name,"pdf/"+name);
await copy("tesseract.js/dist/worker.min.js","ocr/worker.min.js");
await copy("tesseract.js-core","ocr/core");
await mkdir(path.join(out,"vendor/ocr/lang"),{recursive:true});
for(const language of ["eng","fra"])await copy(`@tesseract.js-data/${language}/4.0.0_best_int/${language}.traineddata.gz`,`ocr/lang/${language}.traineddata.gz`);
const packages=["pdfjs-dist","tesseract.js","tesseract.js-core","@tesseract.js-data/eng","@tesseract.js-data/fra"];
let notices="Third-party assets bundled locally.\n\n";
for(const name of packages){
  const directory=path.join(root,"node_modules",name),metadata=JSON.parse(await readFile(path.join(directory,"package.json"),"utf8"));
  notices+=`${name} ${metadata.version}: ${metadata.license||"See upstream license"}\n`;
  for(const file of await readdir(directory))if(/^licen[cs]e|^notice/i.test(file)){
    const target=name.replaceAll("/","_")+"-"+file;await mkdir(path.join(out,"licenses"),{recursive:true});await cp(path.join(directory,file),path.join(out,"licenses",target),{recursive:true});
  }
}
await writeFile(path.join(out,"THIRD-PARTY.txt"),notices);
console.log("Built dist/extension with local PDF and English/French OCR assets.");
