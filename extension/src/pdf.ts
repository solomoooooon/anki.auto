import {getDocument,GlobalWorkerOptions,TextLayer,type PDFDocumentProxy} from "pdfjs-dist";
import {element,input,message,notify} from "./api";
import {markerPosition} from "./selection";
GlobalWorkerOptions.workerSrc=chrome.runtime.getURL("vendor/pdf/pdf.worker.mjs");
let doc:PDFDocumentProxy|undefined,source="",pageNumber=1,rendering=false;
let expression="",context="";
const canvas=element<HTMLCanvasElement>("canvas"),marker=element<HTMLButtonElement>("marker");
async function load(data:Uint8Array){
  try{
    element("status").textContent="Opening PDF…";
    if(doc)await doc.loadingTask.destroy();
    doc=await getDocument({data,cMapUrl:chrome.runtime.getURL("vendor/pdf/cmaps/"),cMapPacked:true,
      standardFontDataUrl:chrome.runtime.getURL("vendor/pdf/standard_fonts/"),wasmUrl:chrome.runtime.getURL("vendor/pdf/wasm/")}).promise;
    pageNumber=1;input("page").max=String(doc.numPages);element("pages").textContent="of "+doc.numPages;await render();
  }catch(error){notify(error);}
}
async function render(){
  if(!doc||rendering)return;rendering=true;marker.hidden=true;
  try{
    const page=await doc.getPage(pageNumber);
    const base=page.getViewport({scale:1});
    const scale=Math.min(1.7,(element("pdf").parentElement!.clientWidth-48)/base.width);
    const viewport=page.getViewport({scale});
    canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    const container=element("pdf");container.style.width=viewport.width+"px";container.style.height=viewport.height+"px";
    container.style.setProperty("--scale-factor",String(scale));container.style.setProperty("--total-scale-factor",String(scale));
    await page.render({canvas,viewport}).promise;
    const layer=element("text-layer");layer.replaceChildren();
    await new TextLayer({textContentSource:page.streamTextContent(),container:layer,viewport}).render();
    input("page").value=String(pageNumber);element("status").textContent="";element<HTMLButtonElement>("ocr").disabled=false;
  }catch(error){notify(error);}finally{rendering=false;}
}
input("file").onchange=async()=>{const file=input("file").files?.[0];if(file){source=file.name;await load(new Uint8Array(await file.arrayBuffer()));}};
input("page").onchange=()=>{if(doc&&!rendering){pageNumber=Math.min(doc.numPages,Math.max(1,Number(input("page").value)||1));void render();}};
element("previous").onclick=()=>{if(!rendering&&pageNumber>1){pageNumber--;void render();}};
element("next").onclick=()=>{if(doc&&!rendering&&pageNumber<doc.numPages){pageNumber++;void render();}};
document.addEventListener("selectionchange",()=>{
  const selection=getSelection();
  if(!selection?.rangeCount||!element("text-layer").contains(selection.anchorNode)){marker.hidden=true;return;}
  expression=selection.toString().trim();if(!expression||expression.length>1000){marker.hidden=true;return;}
  context=element("text-layer").textContent?.slice(0,8000)||"";
  const pos=markerPosition(selection.getRangeAt(0).getBoundingClientRect(),innerWidth,innerHeight);
  marker.style.left=pos.left+"px";marker.style.top=pos.top+"px";marker.hidden=false;
});
marker.onpointerdown=event=>event.preventDefault();
marker.onclick=async()=>{try{await message({kind:"create_draft",draft:{expression,context,source_url:source,source_title:`PDF · page ${pageNumber}`}});marker.hidden=true;}catch(error){notify(error);}};
element("ocr").onclick=async()=>{
  const id=crypto.randomUUID();await chrome.storage.session.set({["shot:"+id]:canvas.toDataURL("image/png")});
  await chrome.tabs.create({url:"ocr.html#id="+id+"&source="+encodeURIComponent(source)});
};
const initial=new URLSearchParams(location.hash.slice(1)).get("url");
if(initial&&/^(https?:|file:)/.test(initial)){
  source=initial;
  void fetch(initial).then(r=>{if(!r.ok)throw new Error("Download the PDF, then open it with the file picker.");return r.arrayBuffer();})
    .then(data=>load(new Uint8Array(data))).catch(()=>notify("Open a downloaded PDF with the file picker. Some sites require their own viewer."));
}
