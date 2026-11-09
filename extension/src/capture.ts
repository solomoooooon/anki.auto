import {api,element,input,message,notify,LocalError,type Draft,type Decks,type Matches,type Job,type Saved} from "./api";

const params=new URLSearchParams(location.hash.slice(1));
const id=params.get("draft")||crypto.randomUUID();
const key="draft:"+id;
let draft:Draft={expression:"",context:"",source_url:"",source_title:""};
let matches:Matches|null=null,ack="",sequence=0,pendingSend=false,busy=false;
let saved:Saved|null=null;
let timer:ReturnType<typeof setTimeout>;
const form=element<HTMLFormElement>("capture-form");
const fieldset=element<HTMLFieldSetElement>("fields");
const deck=element<HTMLSelectElement>("deck"),language=element<HTMLSelectElement>("language");
const close=async()=>{await message({kind:"close_capture",id}).catch(()=>{});if(params.has("modal"))parent.postMessage({kind:"anki-auto-close",id},"*");else window.close();};
if(params.has("modal"))document.body.classList.add("modal-body");

function values():Draft {
  return {...draft,expression:input("expression").value.trim(),context:element<HTMLTextAreaElement>("context").value,
    deck_id:Number(deck.value),language:language.value,custom_definition:element<HTMLTextAreaElement>("definition").value.trim(),
    add_example:input("example").checked,example_front:element<HTMLTextAreaElement>("example-front").value.trim(),
    example_back:element<HTMLTextAreaElement>("example-back").value.trim(),duplicate_ack:ack};
}
function exampleControls() {
  const lang=language.value==="auto"?draft.detected_language:language.value;
  input("example").disabled=lang==="en";
  if(lang==="en")input("example").checked=false;
  const manual=Boolean(input("example").checked&&element<HTMLTextAreaElement>("definition").value.trim());
  element("manual-example").hidden=!manual;
  element<HTMLTextAreaElement>("example-front").required=manual;
  element<HTMLTextAreaElement>("example-back").required=manual;
}
async function persist(){draft={...values()};await chrome.storage.local.set({[key]:draft,lastDraft:id,lastDeck:Number(deck.value)||undefined});}
function showMatches(value:Matches) {
  matches=value;
  const show=value.matches.length>0&&!ack;
  element("matches").hidden=!show;
  element("capture-layout").classList.toggle("single",!show);
  element("match-list").replaceChildren();
  value.matches.forEach(match=>{
    const item=document.createElement("div");item.className="match-item";
    const term=document.createElement("div");term.className="match-term";term.textContent=match.term;
    const meaning=document.createElement("div");meaning.textContent=match.front;
    item.append(term,meaning);element("match-list").append(item);
  });
}
async function checkMatches(){
  const seq=++sequence,current=values();
  if(!current.expression||!current.deck_id){matches=null;return;}
  try{
    const response=await api<Matches>("/matches",{deck_id:current.deck_id,expression:current.expression});
    if(seq!==sequence)return;
    showMatches(response);
  }catch(error){if(seq===sequence)notify(error);}
}
function changed(event:Event) {
  if(busy)return;
  draft.request_id=crypto.randomUUID();delete draft.job_id;
  if(["expression","deck"].includes((event.target as HTMLElement).id)){ack="";matches=null;clearTimeout(timer);timer=setTimeout(checkMatches,300);}
  if((event.target as HTMLElement).id==="language"){ack="";matches=null;void checkMatches();}
  exampleControls();void persist();
  element("result").hidden=true;element("saved-actions").hidden=true;
}
form.addEventListener("input",changed);
deck.addEventListener("change",()=>{ack="";void checkMatches();void persist();});
element("continue").onclick=async()=>{if(!matches)return;ack=matches.ack_token;showMatches(matches);await persist();if(pendingSend){pendingSend=false;void send();}};
element("match-cancel").onclick=()=>{pendingSend=false;element("matches").hidden=true;element("capture-layout").classList.add("single");};
element("close").onclick=close;
element("cancel").onclick=close;
document.addEventListener("keydown",event=>{if(event.key==="Escape"&&!element<HTMLDialogElement>("edit-dialog").open)void close();});

function setBusy(value:boolean){busy=value;fieldset.disabled=value;element<HTMLButtonElement>("send").textContent=value?"Working…":"Send";}
function cardView(title:string,front:string,back:string){
  const section=document.createElement("section");section.className="saved-card";
  const h=document.createElement("h3");h.textContent=title;
  const dl=document.createElement("dl");
  for(const [label,value] of [["Front",front],["Back",back]]){const dt=document.createElement("dt"),dd=document.createElement("dd");dt.textContent=label;dd.textContent=value;dl.append(dt,dd);}
  section.append(h,dl);return section;
}
function showSaved(result:Saved){
  saved=result;element("result").replaceChildren(cardView("Vocabulary",result.front,result.back));
  if(result.example_front)element("result").append(cardView("Example",result.example_front,result.example_back));
  element("result").hidden=false;element("saved-actions").hidden=false;
  element("status").textContent=`${result.card_count} card${result.card_count===1?"":"s"} saved to ${result.deck_name}.`;
  if(draft.add_example&&result.language==="en")element("status").textContent+=" Example skipped for English vocabulary.";
  fieldset.disabled=true;busy=false;
}
async function poll(jobId:string){
  try{
    const job=await api<Job>("/jobs/"+jobId);
    if(job.status==="done"){showSaved(job.result as Saved);return;}
    if(job.status==="needs_confirmation"){
      setBusy(false);ack="";showMatches(job.result as Matches);pendingSend=true;
      notify(job.error);return;
    }
    if(["failed","cancelled"].includes(job.status)){setBusy(false);notify(job.error);return;}
    element("status").textContent=job.status==="saving"?"Saving to Anki…":"Preparing your card…";
    timer=setTimeout(()=>void poll(jobId),800);
  }catch(error){setBusy(false);notify(error);}
}
async function send(){
  if(busy||!form.reportValidity())return;
  pendingSend=true;
  try{
    await checkMatches();
    if(matches?.matches.length&&!ack){showMatches(matches);element("continue").focus();return;}
    const current=values();
    if(current.custom_definition&&current.language==="auto"&&!current.detected_language)throw new Error("Choose English or French when entering a custom definition.");
    draft={...current,request_id:draft.request_id||crypto.randomUUID()};
    await persist();setBusy(true);element("status").textContent="Preparing your card…";
    const job=await api<Job>("/captures",{...draft,retry:true});
    draft.job_id=job.id;await persist();void poll(job.id);
  }catch(error){
    setBusy(false);
    if(error instanceof LocalError&&error.status===409&&error.details){ack="";showMatches(error.details);pendingSend=true;}
    notify(error);
  }
}
form.onsubmit=event=>{event.preventDefault();void send();};
element("new-capture").onclick=()=>{location.href="capture.html";};
let editNote:{note_id:number;modified:number;fields:Record<string,string>}|null=null;
element("edit-saved").onclick=async()=>{
  if(!saved)return;
  try{
    editNote=await api("/notes/get",{note_id:saved.note_id});
    element("edit-fields").replaceChildren();
    for(const name of ["Front","Back","ExampleFront","ExampleBack"]){
      if(!editNote!.fields[name]&&name.startsWith("Example"))continue;
      const label=document.createElement("label");label.className="field";
      const span=document.createElement("span");span.textContent=name;
      const area=document.createElement("textarea");area.name=name;area.value=editNote!.fields[name]||"";
      label.append(span,area);element("edit-fields").append(label);
    }
    element<HTMLDialogElement>("edit-dialog").showModal();
  }catch(error){notify(error);}
};
element("edit-cancel").onclick=()=>element<HTMLDialogElement>("edit-dialog").close();
element<HTMLFormElement>("edit-form").onsubmit=async event=>{
  event.preventDefault();if(!editNote||!saved)return;
  try{
    const fields:Record<string,string>={};
    element("edit-fields").querySelectorAll("textarea").forEach(area=>{if(area.value!==editNote!.fields[area.name])fields[area.name]=area.value;});
    await api("/notes/edit",{note_id:editNote.note_id,modified:editNote.modified,fields});
    showSaved({...saved,front:fields.Front??saved.front,back:fields.Back??saved.back,
      example_front:fields.ExampleFront??saved.example_front,example_back:fields.ExampleBack??saved.example_back});
    element<HTMLDialogElement>("edit-dialog").close();
  }catch(error){notify(error,"edit-status");}
};

async function initialize(){
  const stored=await chrome.storage.local.get([key,"lastDeck"]);
  draft={...draft,...(stored[key] as Partial<Draft>||{})};
  input("expression").value=draft.expression;
  element<HTMLTextAreaElement>("context").value=draft.context;
  element<HTMLTextAreaElement>("definition").value=draft.custom_definition||"";
  element<HTMLTextAreaElement>("example-front").value=draft.example_front||"";
  element<HTMLTextAreaElement>("example-back").value=draft.example_back||"";
  language.value=draft.language||"auto";input("example").checked=Boolean(draft.add_example);
  ack=draft.duplicate_ack||"";exampleControls();
  try{
    const result=await api<Decks>("/decks");
    for(const item of result.decks){const option=document.createElement("option");option.value=String(item.id);option.textContent=item.name;deck.append(option);}
    deck.value=String(draft.deck_id||stored.lastDeck||"");
    if(draft.job_id){setBusy(true);void poll(draft.job_id);}else void checkMatches();
  }catch(error){notify(error);const a=document.createElement("a");a.href="settings.html";a.target="_blank";a.textContent="Open Settings";element("status").append(" ",a);}
}
void initialize();
