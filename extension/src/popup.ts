import {element,input,message,notify} from "./api";
void chrome.storage.local.get(["enabled","lastDraft"]).then(state=>{
  input("enabled").checked=Boolean(state.enabled);
  if(state.lastDraft){element("resume").hidden=false;element("resume").onclick=()=>chrome.tabs.create({url:"capture.html#draft="+state.lastDraft});}
});
input("enabled").onchange=()=>void chrome.storage.local.set({enabled:input("enabled").checked});
element("screenshot").onclick=()=>void message({kind:"screenshot"}).then(()=>window.close()).catch(notify);
element("pdf").onclick=async()=>{
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  await chrome.tabs.create({url:chrome.runtime.getURL("pdf.html")+"#url="+encodeURIComponent(tab?.url||"")});window.close();
};
