import {api,element,notify,type CardSnapshot,type Decks} from "./api";
import {reviewShortcut} from "./shortcuts";
import {cardDocument,applyCardTheme} from "./card-document";
import {currentTheme} from "./theme";
let snapshot:CardSnapshot|null=null,answerVisible=false,busy=false,blocked=false,started=performance.now(),renderSequence=0;
let pending:Record<string,unknown>|null=null;
let pollTimer:ReturnType<typeof setTimeout>;
const frame=element<HTMLIFrameElement>("card"),editor=element<HTMLDialogElement>("editor"),info=element<HTMLDialogElement>("info");
let editingNote:{note_id:number;modified:number;fields:Record<string,string>}|null=null;
const labels=["Again","Hard","Good","Easy"];
function locked(value:boolean){busy=value;document.querySelectorAll<HTMLButtonElement>("#ratings button,#reveal,#undo,#edit").forEach(button=>button.disabled=value);}
function failure(error:unknown){blocked=true;locked(false);notify(error);element("resume").hidden=false;element("end").hidden=false;element("retry").hidden=!pending;}
async function show(value:CardSnapshot){
  clearTimeout(pollTimer);++renderSequence;frame.onload=null;frame.hidden=true;frame.srcdoc="";
  snapshot=value;answerVisible=false;blocked=false;pending=null;locked(true);
  element("status").textContent="";for(const id of ["resume","retry","end"])element(id).hidden=true;
  element("chooser").hidden=value.active;element("study").hidden=!value.active;
  element("more-menu").hidden=true;element("more").setAttribute("aria-expanded","false");
  if(!value.active){element("recover").hidden=!value.recovery;element("finish-old").hidden=!value.recovery;locked(false);return;}
  started=performance.now();element<HTMLButtonElement>("undo").disabled=!value.can_undo;
  element("home").textContent=value.card_id?value.home_deck:"Combined queue";
  element("counts").textContent=`${value.counts.new} new · ${value.counts.learning} learning · ${value.counts.review} review`;
  element("empty").hidden=Boolean(value.card_id);
  element("reveal").hidden=!value.card_id;element("ratings").hidden=true;
  element<HTMLButtonElement>("edit").disabled=!value.card_id;
  if(!value.card_id){
    element("empty").textContent=value.finished?"You’re done for now.":`Next learning card around ${new Date((value.next_due||Date.now()/1000)*1000).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}. Keep this tab open, or return later.`;
    if(!value.finished)pollTimer=setTimeout(()=>void refresh(),Math.min(15000,Math.max(1000,((value.next_due||0)*1000-Date.now()))));
    locked(false);element<HTMLButtonElement>("undo").disabled=!value.can_undo;
    return;
  }
  element<HTMLSelectElement>("flag").value=String(value.flag);
  element<HTMLButtonElement>("more").textContent=value.marked?"More ★":"More M";
  element("ratings").querySelectorAll("button").forEach((button,index)=>{button.querySelector("small")!.textContent=`${value.answer_keys?.[index]||index+1} · ${value.intervals[index]||""}`;button.setAttribute("aria-label",labels[index]+" "+(value.intervals[index]||""));});
  await renderCard();
  locked(false);element<HTMLButtonElement>("undo").disabled=!value.can_undo;
}
async function renderCard(){
  if(!snapshot?.card_id)return;
  const seq=++renderSequence,value=snapshot;
  frame.hidden=true;
  const html=await cardDocument(answerVisible?value.back:value.front,value.css,(answerVisible?value.answer_audio:value.question_audio)||[]);
  if(seq!==renderSequence)return;
  await new Promise<void>(resolve=>{frame.onload=()=>{
    if(seq!==renderSequence){resolve();return;}
    const document=frame.contentDocument;if(!document)return;
    if(document.documentElement.getAttribute("data-anki-render")!==String(seq))return;
    applyCardTheme(document,currentTheme());
    frame.hidden=false;
    const fit=()=>{
      // Measure content from a collapsed viewport; otherwise each reveal adds height.
      frame.style.height="1px";
      frame.style.height=Math.max(220,document.documentElement.scrollHeight)+"px";
    };
    fit();
    document.addEventListener("keydown",onKey);
    const images=document.querySelectorAll("img");images.forEach(img=>img.onload=fit);
    resolve();
  };
  frame.srcdoc=html.replace("<html",`<html data-anki-render="${seq}"`);
  });
}
async function refresh(){try{await show(await api<CardSnapshot>("/review/current"));}catch(error){failure(error);}}
async function rateAction(action:string,extra:Record<string,unknown>={}){
  if(busy||blocked||!snapshot?.active)return;
  if(action==="rate"&&!answerVisible)return;
  pending={action,...extra,session:snapshot.session,revision:snapshot.revision,card_id:snapshot.card_id,action_id:crypto.randomUUID(),elapsed_ms:Math.round(performance.now()-started)};
  await transmit();
}
async function transmit(){
  if(!pending||busy)return;locked(true);element("retry").hidden=true;
  try{await show(await api<CardSnapshot>("/review/action",pending));}catch(error){failure(error);}
}
async function reveal(){
  if(busy||blocked||!snapshot?.card_id||answerVisible)return;
  locked(true);answerVisible=true;element("reveal").hidden=true;
  try{await renderCard();element("ratings").hidden=false;locked(false);}catch(error){failure(error);}
}
async function end(){
  if(busy)return;locked(true);
  try{await api("/review/end",{session:snapshot?.session});await loadDecks();await refresh();}catch(error){failure(error);}
}
async function edit(){
  if(!snapshot?.card_id||busy||blocked)return;
  try{
    editingNote=await api("/notes/get",{note_id:snapshot.note_id});element("edit-fields").replaceChildren();
    for(const [name,value] of Object.entries(editingNote!.fields)){
      const label=document.createElement("label");label.className="field";const title=document.createElement("span");title.textContent=name;
      const area=document.createElement("textarea");area.name=name;area.value=value;label.append(title,area);element("edit-fields").append(label);
    }
    element("edit-status").textContent="";editor.showModal();
  }catch(error){failure(error);}
}
element<HTMLFormElement>("edit-form").onsubmit=async event=>{
  event.preventDefault();if(!editingNote)return;
  const fields:Record<string,string>={};element("edit-fields").querySelectorAll("textarea").forEach(area=>{if(area.value!==editingNote!.fields[area.name])fields[area.name]=area.value;});
  editor.close();await rateAction("edit",{fields});
};
element("edit-cancel").onclick=()=>editor.close();element("info-close").onclick=()=>info.close();
async function act(action:string){
  if(action==="reveal"){await reveal();return;}
  if(action==="overview"||action==="decks"){await end();return;}
  if(action==="more"){const menu=element("more-menu");menu.hidden=!menu.hidden;element("more").setAttribute("aria-expanded",String(!menu.hidden));return;}
  if(action==="edit"){await edit();return;}
  if(["replay","pause","backward","forward"].includes(action)){
    const audio=Array.from(frame.contentDocument?.querySelectorAll("audio")||[]);
    for(const player of audio){if(action==="replay"){player.currentTime=0;await player.play().catch(()=>{});}else if(action==="pause"){if(player.paused)await player.play().catch(()=>{});else player.pause();}else player.currentTime=Math.max(0,player.currentTime+(action==="backward"?-5:5));}return;
  }
  if(busy||blocked)return;
  if(action==="info"||action==="previous_info"){
    try{
      const result=await api<Record<string,unknown>>("/review/info",{previous:action==="previous_info"});element("info-fields").replaceChildren();
      for(const [key,value] of Object.entries(result)){const dt=document.createElement("dt"),dd=document.createElement("dd");dt.textContent=key.replaceAll("_"," ");dd.textContent=String(value);element("info-fields").append(dt,dd);}info.showModal();
    }catch(error){notify(error);}return;
  }
  if(action==="native_edit"||action==="options"){try{await api(action==="options"?"/review/options":"/review/open",{});}catch(error){notify(error);}return;}
  await rateAction(action);
}
function onKey(event:KeyboardEvent){
  const target=event.target as HTMLElement|null;
  const editing=Boolean(target?.closest("input,textarea,select,[contenteditable=true]"));
  const command=reviewShortcut(event,{active:Boolean(snapshot?.active)&&!busy&&!blocked,answerVisible,editing,
    dialogOpen:editor.open||info.open,focusedButton:Boolean(target?.closest("button,a")),spaceRates:snapshot?.space_rates??true,answerKeys:snapshot?.answer_keys});
  if(!command)return;event.preventDefault();if(command.action==="rate")void rateAction("rate",{rating:command.rating});else void act(command.action);
}
document.addEventListener("keydown",onKey);
element("reveal").onclick=reveal;element("undo").onclick=()=>void act("undo");element("edit").onclick=edit;element("more").onclick=()=>void act("more");
element("overview").onclick=end;element("end").onclick=end;element("finish-old").onclick=end;element("retry").onclick=transmit;
element("ratings").querySelectorAll<HTMLButtonElement>("button").forEach(button=>button.onclick=()=>void rateAction("rate",{rating:Number(button.dataset.rating)}));
element("more-menu").querySelectorAll<HTMLButtonElement>("[data-action]").forEach(button=>button.onclick=()=>void act(button.dataset.action!));
element<HTMLSelectElement>("flag").onchange=event=>void rateAction("flag",{flag:Number((event.target as HTMLSelectElement).value)});
async function resume(){try{await show(await api<CardSnapshot>("/review/start",{resume:true}));}catch(error){failure(error);}}
element("resume").onclick=resume;element("recover").onclick=resume;
async function loadDecks(){
  const result=await api<Decks>("/decks"),stored=await chrome.storage.local.get("reviewDecks");element("profile").textContent=result.profile;
  element("decks").replaceChildren();
  for(const deck of result.decks){
    const row=document.createElement("label");row.className="deck-row";
    const checkbox=document.createElement("input");checkbox.type="checkbox";checkbox.name="deck";checkbox.value=String(deck.id);checkbox.checked=Array.isArray(stored.reviewDecks)&&stored.reviewDecks.includes(deck.id);
    const name=document.createElement("span");name.textContent=deck.name;const counts=document.createElement("small");counts.textContent=`${deck.counts.new} new · ${deck.counts.learning} learning · ${deck.counts.review} review`;
    row.append(checkbox,name,counts);element("decks").append(row);
  }
}
element("all").onclick=()=>document.querySelectorAll<HTMLInputElement>("input[name=deck]").forEach(c=>c.checked=true);
element("none").onclick=()=>document.querySelectorAll<HTMLInputElement>("input[name=deck]").forEach(c=>c.checked=false);
element<HTMLFormElement>("decks-form").onsubmit=async event=>{
  event.preventDefault();if(busy)return;
  const deck_ids=Array.from(document.querySelectorAll<HTMLInputElement>("input[name=deck]:checked"),node=>Number(node.value));
  if(!deck_ids.length){notify("Select at least one deck.");return;}
  locked(true);
  try{await chrome.storage.local.set({reviewDecks:deck_ids});await show(await api<CardSnapshot>("/review/start",{deck_ids}));}catch(error){failure(error);}
};
void loadDecks().then(refresh).catch(failure);
