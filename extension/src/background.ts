import type {Draft,Job,CaptureTask} from "./api";

const waiting=(status:string)=>["queued","running","saving"].includes(status);
const attention=(status:string)=>["failed","needs_confirmation"].includes(status);
let storageWork:Promise<unknown>=Promise.resolve();
function serial<T>(work:()=>Promise<T>):Promise<T>{
  const result=storageWork.then(work,work);storageWork=result.catch(()=>{});return result;
}
async function tasks():Promise<CaptureTask[]>{const stored=await chrome.storage.local.get("captureJobs");return Array.isArray(stored.captureJobs)?stored.captureJobs:[];}
async function badge(jobs:CaptureTask[]){
  const failed=jobs.some(job=>attention(job.status));
  const pending=jobs.filter(job=>waiting(job.status)).length;
  await chrome.action.setBadgeText({text:failed?"!":pending?String(pending):""});
  await chrome.action.setBadgeBackgroundColor({color:failed?"#a53c32":"#315b43"});
  if(pending){if(!await chrome.alarms.get("capture-jobs"))await chrome.alarms.create("capture-jobs",{periodInMinutes:.5});}
  else await chrome.alarms.clear("capture-jobs");
}
async function history(){
  const previous=await tasks();
  const updates=await Promise.all(previous.filter(job=>waiting(job.status)).map(async task=>{
    try{const response=await request("/jobs/"+task.id,"GET",undefined);return response.ok?{...task,status:response.result.status,error:response.result.error||""}:task;}catch{return task;}
  }));
  return serial(async()=>{
    const latest=await tasks();
    for(const update of updates){const index=latest.findIndex(task=>task.id===update.id&&task.queued_at===update.queued_at&&waiting(task.status));if(index>=0)latest[index]=update;}
    await chrome.storage.local.set({captureJobs:latest});await badge(latest);return latest;
  });
}
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==="capture-jobs")return history().then(()=>{}).catch(()=>{});});
chrome.runtime.onStartup.addListener(()=>void history().catch(()=>{}));
void history().catch(()=>{});

const own=(sender:chrome.runtime.MessageSender)=>sender.url?.startsWith(chrome.runtime.getURL(""));
async function request(path:string,method:string,data:unknown) {
  if(!/^\/(health|decks|matches|captures|jobs\/[\w-]+|review\/(start|current|action|end|info|open|options)|notes\/(edit|get)|media|codex\/status)$/.test(path))throw new Error("Unknown local operation");
  const settings=await chrome.storage.local.get(["backendPort","backendToken"]);
  const port=Number(settings.backendPort||8766);
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error("Invalid backend port");
  const headers:Record<string,string>={"Content-Type":"application/json"};
  if(settings.backendToken)headers.Authorization="Bearer "+settings.backendToken;
  let response:Response;
  try{response=await fetch(`http://127.0.0.1:${port}${path}`,{method,headers,body:method==="POST"?JSON.stringify(data||{}):undefined,signal:AbortSignal.timeout(25000)});}
  catch{throw new Error("Start the anki.auto backend, then check your connection in Settings.");}
  const result=await response.json();
  return {...result,status:response.status};
}

async function draftStore(draft:Draft) {
  const id=crypto.randomUUID();
  const stored=await chrome.storage.local.get(["draftIds","captureJobs"]);
  const ids:string[]=Array.isArray(stored.draftIds)?stored.draftIds:[];
  ids.push(id);
  const retained=new Set((Array.isArray(stored.captureJobs)?stored.captureJobs:[]).map((job:CaptureTask)=>job.draft_id));
  const removed:string[]=[];
  for(const old of [...ids])if(ids.length>15&&!retained.has(old)){ids.splice(ids.indexOf(old),1);removed.push("draft:"+old);}
  if(removed.length)await chrome.storage.local.remove(removed);
  await chrome.storage.local.set({["draft:"+id]:{...draft,created:Date.now()},draftIds:ids,lastDraft:id});
  return id;
}

chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
  (async()=>{
    if(sender.id!==chrome.runtime.id)throw new Error("Untrusted sender");
    if(msg.kind==="state")return {ok:true,result:{enabled:Boolean((await chrome.storage.local.get("enabled")).enabled)}};
    if(msg.kind==="capture"){
      const source=msg.draft as Draft;
      if(typeof source?.expression!=="string"||!source.expression.trim()||source.expression.length>1000)throw new Error("Select up to 1,000 characters.");
      const draft:Draft={expression:source.expression.trim(),context:String(source.context||"").slice(0,8000),
        source_url:String(source.source_url||sender.url||"").slice(0,4000),source_title:String(source.source_title||"").slice(0,500),
        detected_language:["en","fr"].includes(source.detected_language||"")?source.detected_language:"",host_tab:sender.tab?.id};
      const id=await draftStore(draft);
      const url=chrome.runtime.getURL("capture.html")+"#draft="+id+"&modal=1";
      let displayed=false;
      if(sender.tab?.id!==undefined){try{const response=await chrome.tabs.sendMessage(sender.tab.id,{kind:"display_capture",id,url},{frameId:0});displayed=Boolean(response?.displayed);}catch{}}
      return {ok:true,result:{id,url,displayed}};
    }
    if(!own(sender))throw new Error("This operation is available only inside the extension.");
    if(msg.kind==="queue_capture"){
      if(typeof msg.id!=="string"||!/^[-\w]{1,100}$/.test(msg.id))throw new Error("Invalid capture draft");
      const response=await request("/captures","POST",msg.draft);
      if(!response.ok)return response;
      const job=response.result as Job;
      await serial(async()=>{
        const jobs=(await tasks()).filter(task=>task.id!==job.id&&task.draft_id!==msg.id);
        jobs.unshift({id:job.id,draft_id:msg.id,expression:String(msg.draft.expression),deck_name:String(msg.deck_name||""),status:job.status,error:job.error||"",queued_at:Date.now()});
        let completed=0;const kept=jobs.filter(task=>waiting(task.status)||attention(task.status)||++completed<=30);
        await chrome.storage.local.set({["draft:"+msg.id]:{...msg.draft,job_id:job.id},lastDraft:msg.id,captureJobs:kept});
        await badge(kept);
      });
      return response;
    }
    if(msg.kind==="capture_history")return {ok:true,result:await history()};
    if(msg.kind==="api")return request(msg.path,msg.method,msg.data);
    if(msg.kind==="create_draft"){
      const id=await draftStore(msg.draft);
      await chrome.tabs.create({url:chrome.runtime.getURL("capture.html")+"#draft="+id});
      return {ok:true,result:{id}};
    }
    if(msg.kind==="close_capture"){
      const data=await chrome.storage.local.get("draft:"+msg.id);
      const draft=data["draft:"+msg.id] as Draft|undefined;
      if(draft?.host_tab!==undefined){
        try{await chrome.tabs.sendMessage(draft.host_tab,{kind:"dismiss_capture",id:msg.id});}catch{}
      }
      return {ok:true,result:{closed:true}};
    }
    if(msg.kind==="screenshot"){
      const image=await chrome.tabs.captureVisibleTab({format:"png"});
      const id=crypto.randomUUID();
      await chrome.storage.session.set({["shot:"+id]:image});
      const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
      await chrome.tabs.create({url:chrome.runtime.getURL("ocr.html")+"#id="+id+"&source="+encodeURIComponent(tab?.url||"")});
      return {ok:true,result:{opened:true}};
    }
    throw new Error("Unknown extension operation");
  })().then(reply).catch(error=>reply({ok:false,error:error.message}));
  return true;
});

chrome.runtime.onInstalled.addListener(()=>chrome.runtime.openOptionsPage());
