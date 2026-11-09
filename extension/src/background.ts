import type {Draft} from "./api";

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
  const stored=await chrome.storage.local.get("draftIds");
  const ids:string[]=Array.isArray(stored.draftIds)?stored.draftIds:[];
  ids.push(id);
  if(ids.length>15)await chrome.storage.local.remove(ids.splice(0,ids.length-15).map(old=>"draft:"+old));
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
      return {ok:true,result:{id,url:chrome.runtime.getURL("capture.html")+"#draft="+id+"&modal=1"}};
    }
    if(!own(sender))throw new Error("This operation is available only inside the extension.");
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
