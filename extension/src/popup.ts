import {element,input,message,notify,userError,type CaptureTask} from "./api";
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
async function history(){
  try{
    const jobs=await message<CaptureTask[]>({kind:"capture_history"});
    element("recent").hidden=!jobs.length;element("jobs").replaceChildren();
    const labels:Record<string,string>={queued:"Queued",running:"Preparing…",saving:"Saving…",done:"Saved",failed:"Needs attention",needs_confirmation:"Confirm near match",cancelled:"Cancelled"};
    const priority=(job:CaptureTask)=>["failed","needs_confirmation"].includes(job.status)?0:["queued","running","saving"].includes(job.status)?1:2;
    for(const job of [...jobs].sort((a,b)=>priority(a)-priority(b))){
      const link=document.createElement("a");link.href="capture.html#draft="+job.draft_id;link.target="_blank";link.className="capture-job";
      const term=document.createElement("strong");term.textContent=job.expression;
      const state=document.createElement("span");state.textContent=`${labels[job.status]||"Pending"}${job.deck_name?" · "+job.deck_name:""}`;
      if(job.error){const error=document.createElement("small");error.textContent=userError(job.error);link.append(term,state,error);}else link.append(term,state);
      element("jobs").append(link);
    }
    if(jobs.some(job=>["queued","running","saving"].includes(job.status)))setTimeout(()=>void history(),2000);
  }catch(error){notify(error);}
}
void history();
