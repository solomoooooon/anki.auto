import {markerPosition,selectionContext} from "./selection";

let enabled=false;
let saved:Selection|null=null;
let savedText="",context="",draftId="";
const host=document.createElement("div");
host.style.cssText="all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
const root=host.attachShadow({mode:"closed"});
const style=document.createElement("style");
style.textContent=`button{position:fixed;width:32px;height:32px;border:0;border-radius:7px;background:#315b43;color:white;font:20px system-ui;cursor:pointer;pointer-events:auto;box-shadow:0 2px 12px #0003} .overlay{position:fixed;inset:0;pointer-events:auto;background:#0004;display:flex;align-items:center;justify-content:center;padding:18px} iframe{border:0;background:transparent;width:min(850px,100%);height:min(780px,95vh);border-radius:12px;box-shadow:0 20px 80px #0004} [hidden]{display:none!important}`;
const marker=document.createElement("button");marker.textContent="✓";marker.title="Add to Anki";marker.setAttribute("aria-label","Add selected text to Anki");marker.hidden=true;
const overlay=document.createElement("div");overlay.className="overlay";overlay.hidden=true;
root.append(style,marker,overlay);
document.documentElement.append(host);
function dismiss(){overlay.replaceChildren();overlay.hidden=true;marker.hidden=true;}
function display(id:string,url:string){
  draftId=id;const frame=document.createElement("iframe");frame.src=url;frame.title="Add vocabulary to Anki";
  overlay.replaceChildren(frame);overlay.hidden=false;marker.hidden=true;
}
function update(){
  if(!enabled||!overlay.hidden)return;
  const selection=window.getSelection();
  const target=document.activeElement;
  if(target instanceof HTMLInputElement && target.type==="password")return;
  const value=selection?.toString().trim()||"";
  if(!selection||!value||value.length>1000||!selection.rangeCount){marker.hidden=true;return;}
  const rect=selection.getRangeAt(0).getBoundingClientRect();
  if(rect.width===0&&rect.height===0){marker.hidden=true;return;}
  saved=selection;savedText=value;context=selectionContext(selection);
  const position=markerPosition(rect,innerWidth,innerHeight);
  marker.style.left=position.left+"px";marker.style.top=position.top+"px";marker.hidden=false;
}
marker.addEventListener("pointerdown",event=>event.preventDefault());
marker.addEventListener("click",async()=>{
  marker.disabled=true;
  try{
    const response=await chrome.runtime.sendMessage({kind:"capture",draft:{expression:savedText,context,
      source_url:location.href,source_title:document.title,detected_language:document.documentElement.lang.slice(0,2).toLowerCase()}});
    if(!response.ok)throw new Error(response.error);
    marker.hidden=true;
    if(!response.result.displayed)display(response.result.id,response.result.url);
  }catch(error){marker.title=error instanceof Error?error.message:"Open anki.auto from the toolbar";}
  finally{marker.disabled=false;}
});
let timer:ReturnType<typeof setTimeout>;
document.addEventListener("selectionchange",()=>{clearTimeout(timer);timer=setTimeout(update,120);});
document.addEventListener("mouseup",()=>setTimeout(update,0));
document.addEventListener("keyup",event=>{if(event.key==="Escape")dismiss();else update();});
window.addEventListener("scroll",update,{passive:true});
window.addEventListener("resize",update);
overlay.addEventListener("click",event=>{if(event.target===overlay)dismiss();});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==="local"&&changes.enabled){enabled=Boolean(changes.enabled.newValue);if(!enabled)dismiss();}});
chrome.runtime.onMessage.addListener((msg,_sender,reply)=>{
  if(msg.kind==="dismiss_capture"&&msg.id===draftId)dismiss();
  if(msg.kind==="display_capture"){display(msg.id,msg.url);reply({displayed:true});}
});
chrome.runtime.sendMessage({kind:"state"}).then(response=>{enabled=Boolean(response?.result?.enabled);}).catch(()=>{});
