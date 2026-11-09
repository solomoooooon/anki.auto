import {createWorker,OEM} from "tesseract.js";
import {element,input,message,notify} from "./api";
const image=element<HTMLImageElement>("image"),stage=element("stage"),box=element("crop");
const params=new URLSearchParams(location.hash.slice(1));
let start:{x:number;y:number}|null=null,rect:{left:number;top:number;width:number;height:number}|null=null;
async function show(url:string){image.src=url;await image.decode();stage.hidden=false;rect=null;box.hidden=true;element<HTMLButtonElement>("extract").disabled=false;}
function point(event:PointerEvent){const bounds=stage.getBoundingClientRect();return {x:Math.min(bounds.width,Math.max(0,event.clientX-bounds.left)),y:Math.min(bounds.height,Math.max(0,event.clientY-bounds.top))};}
stage.onpointerdown=event=>{start=point(event);stage.setPointerCapture(event.pointerId);event.preventDefault();};
stage.onpointermove=event=>{
  if(!start)return;const end=point(event);
  rect={left:Math.min(start.x,end.x),top:Math.min(start.y,end.y),width:Math.abs(end.x-start.x),height:Math.abs(end.y-start.y)};
  Object.assign(box.style,{left:rect.left+"px",top:rect.top+"px",width:rect.width+"px",height:rect.height+"px"});box.hidden=false;
};
stage.onpointerup=()=>{start=null;if(rect&&(rect.width<4||rect.height<4)){rect=null;box.hidden=true;}};
element("reset").onclick=()=>{rect=null;box.hidden=true;};
async function fileImage(file:File){if(!file.type.startsWith("image/"))return;const url=URL.createObjectURL(file);try{await show(url);}finally{URL.revokeObjectURL(url);}}
input("file").onchange=()=>{const file=input("file").files?.[0];if(file)void fileImage(file).catch(notify);};
document.addEventListener("paste",event=>{const file=Array.from(event.clipboardData?.files||[]).find(f=>f.type.startsWith("image/"));if(file){event.preventDefault();void fileImage(file).catch(notify);}});
element("extract").onclick=async()=>{
  const button=element<HTMLButtonElement>("extract");button.disabled=true;
  let worker:Awaited<ReturnType<typeof createWorker>>|undefined;
  try{
    const bounds=stage.getBoundingClientRect(),factor=image.naturalWidth/bounds.width;
    const area=rect||{left:0,top:0,width:bounds.width,height:bounds.height};
    const canvas=document.createElement("canvas");canvas.width=Math.round(area.width*factor);canvas.height=Math.round(area.height*factor);
    if(!canvas.width||!canvas.height)throw new Error("Choose a visible text area first.");
    canvas.getContext("2d")!.drawImage(image,area.left*factor,area.top*factor,canvas.width,canvas.height,0,0,canvas.width,canvas.height);
    worker=await createWorker("eng+fra",OEM.LSTM_ONLY,{workerPath:chrome.runtime.getURL("vendor/ocr/worker.min.js"),
      corePath:chrome.runtime.getURL("vendor/ocr/core/"),langPath:chrome.runtime.getURL("vendor/ocr/lang/"),workerBlobURL:false,
      logger:progress=>element("status").textContent=`${progress.status} ${Math.round(progress.progress*100)}%`});
    const result=await worker.recognize(canvas);
    element<HTMLTextAreaElement>("text").value=result.data.text.trim();element("status").textContent="Check the text, then select the words to capture.";
    element("text").focus();
  }catch(error){notify(error);}finally{await worker?.terminate();button.disabled=false;}
};
element("capture").onclick=async()=>{
  const area=element<HTMLTextAreaElement>("text");
  const expression=area.value.slice(area.selectionStart,area.selectionEnd).trim()||area.value.trim();
  if(!expression||expression.length>1000){notify("Select between 1 and 1,000 characters in the extracted text.");return;}
  try{await message({kind:"create_draft",draft:{expression,context:area.value.slice(0,8000),source_url:params.get("source")||"",source_title:"Screenshot text"}});}catch(error){notify(error);}
};
const id=params.get("id");if(id)void chrome.storage.session.get("shot:"+id).then(async state=>{const value=state["shot:"+id];if(typeof value==="string")await show(value);await chrome.storage.session.remove("shot:"+id);}).catch(notify);
