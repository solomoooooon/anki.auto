import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {build} from "esbuild";
import {JSDOM} from "jsdom";
import {randomUUID} from "node:crypto";
const flush=()=>new Promise(resolve=>setTimeout(resolve,25));
async function page(name,handler,stored={},hash=""){
  const html=await readFile(new URL(`../src/${name}.html`,import.meta.url),"utf8");
  const dom=new JSDOM(html,{url:`https://extension.invalid/${name}.html${hash}`,runScripts:"outside-only",pretendToBeVisual:true});
  const w=dom.window,messages=[];
  Object.defineProperty(w.crypto,"randomUUID",{value:randomUUID});
  w.ResizeObserver=class{observe(){}disconnect(){}};
  w.chrome={storage:{local:{get:async()=>stored,set:async values=>Object.assign(stored,values)}},runtime:{sendMessage:async msg=>{messages.push(msg);return await handler(msg);}}};
  const source=await build({entryPoints:[`extension/src/${name}.ts`],bundle:true,write:false,format:"iife",target:"es2022"});
  w.eval(source.outputFiles[0].text);await flush();
  return {dom,w,messages,stored};
}
test("Connection settings show a readable status without JSON or model identifiers",async()=>{
  const {dom,w}=await page("settings",async msg=>({ok:true,result:msg.path==="/health"?{bridge:{connected:true,profile:"User 1"},model:"gpt-5.6-luna"}:{authenticated:true,model:"gpt-5.6-luna"}}));
  try{
    w.document.getElementById("check").click();await flush();
    const status=w.document.getElementById("status").textContent;
    assert.match(status,/User 1/);assert.match(status,/ready/i);
    assert.doesNotMatch(status,/[{}]|authenticated|gpt-5/);
  }finally{dom.window.close();}
});
test("Modal closes after queue acceptance without waiting for generation",async()=>{
  const stored={"draft:test":{expression:"valorous",context:"a valorous soldier",source_url:"https://example.com",source_title:"Article",deck_id:7,language:"en"}};
  const {dom,w,messages}=await page("capture",async msg=>{
    if(msg.kind==="close_capture")return {ok:true,result:{closed:true}};
    if(msg.kind==="queue_capture"||msg.path==="/captures")return {ok:true,result:{id:"job1",status:"queued",result:null,error:""}};
    if(msg.path==="/decks")return {ok:true,result:{profile:"Test",collection_id:"collection1",decks:[{id:7,name:"WORDS",counts:{}}]}};
    if(msg.path==="/matches")return {ok:true,result:{matches:[],fingerprint:"f",ack_token:"a"}};
    if(msg.path?.startsWith("/jobs/"))return new Promise(()=>{});
    throw new Error("Unexpected operation: "+JSON.stringify(msg));
  },stored,"#draft=test&modal=1");
  try{
    w.document.getElementById("capture-form").dispatchEvent(new w.Event("submit",{bubbles:true,cancelable:true}));await flush();await flush();
    assert.ok(messages.some(msg=>msg.kind==="close_capture"),"accepted background job must close the modal immediately");
    assert.equal(stored["draft:test"].job_id,"job1");
  }finally{dom.window.close();}
});
test("Capture modal keeps optional long fields collapsed by default",async()=>{
  const html=await readFile(new URL("../src/capture.html",import.meta.url),"utf8");
  const dom=new JSDOM(html);
  try{
    const details=dom.window.document.getElementById("definition").closest("details");
    assert.ok(details,"custom definition should not enlarge the default capture form");
    assert.equal(details.open,false);
  }finally{dom.window.close();}
});
test("Article overlay fits the capture form and rejects sizing messages from other windows",async()=>{
  const dom=new JSDOM("<p>A valorous soldier</p>",{url:"https://article.example",runScripts:"outside-only"}),w=dom.window;
  const original=w.Element.prototype.attachShadow;
  w.Element.prototype.attachShadow=function(){return original.call(this,{mode:"open"});};
  let listener;
  w.chrome={runtime:{getURL:path=>"chrome-extension://extension/"+path,sendMessage:async()=>({ok:true,result:{enabled:false}}),onMessage:{addListener:fn=>listener=fn}},storage:{onChanged:{addListener(){}}}};
  const source=await build({entryPoints:["extension/src/content.ts"],bundle:true,write:false,format:"iife"});
  try{
    w.eval(source.outputFiles[0].text);
    listener({kind:"display_capture",id:"test",url:"chrome-extension://extension/capture.html#draft=test"},{},()=>{});
    const frame=w.document.documentElement.lastElementChild.shadowRoot.querySelector("iframe");
    const resize=source=>w.dispatchEvent(new w.MessageEvent("message",{origin:"chrome-extension://extension",source,data:{kind:"anki-auto-size",id:"test",width:460,height:380}}));
    resize(w);assert.equal(frame.style.height,"");
    resize(frame.contentWindow);assert.equal(frame.style.height,"380px");assert.equal(frame.style.width,"460px");
  }finally{w.close();}
});
test("A failed queue request keeps the capture open and its draft intact",async()=>{
  const stored={"draft:test":{expression:"valorous",context:"",source_url:"",source_title:"",deck_id:7,language:"en"}};
  const {dom,w,messages}=await page("capture",async msg=>{
    if(msg.path==="/decks")return {ok:true,result:{profile:"Test",collection_id:"collection1",decks:[{id:7,name:"WORDS",counts:{}}]}};
    if(msg.path==="/matches")return {ok:true,result:{matches:[],fingerprint:"f",ack_token:"a"}};
    if(msg.kind==="queue_capture")return {ok:false,error:"Open Anki, then try again."};
    throw new Error("Unexpected operation");
  },stored,"#draft=test&modal=1");
  try{
    w.document.getElementById("capture-form").dispatchEvent(new w.Event("submit",{bubbles:true,cancelable:true}));await flush();
    assert.equal(messages.some(msg=>msg.kind==="close_capture"),false);
    assert.match(w.document.getElementById("status").textContent,/Open Anki/);
    assert.equal(w.document.getElementById("fields").disabled,false);
    assert.equal(stored["draft:test"].expression,"valorous");
    assert.ok(stored["draft:test"].request_id);
  }finally{w.close();}
});
test("Near-match confirmation stays open and must be acknowledged before background submission",async()=>{
  const stored={"draft:test":{expression:"valorous",context:"",source_url:"",source_title:"",deck_id:7,language:"en"}};
  const {dom,w,messages}=await page("capture",async msg=>{
    if(msg.path==="/decks")return {ok:true,result:{profile:"Test",collection_id:"collection1",decks:[{id:7,name:"WORDS",counts:{}}]}};
    if(msg.path==="/matches")return {ok:true,result:{matches:[{note_id:42,term:"valorous",front:"brave",score:1}],fingerprint:"f",ack_token:"confirmed"}};
    if(msg.kind==="queue_capture")return {ok:true,result:{id:"job1",status:"queued",result:null,error:""}};
    if(msg.kind==="close_capture")return {ok:true,result:{closed:true}};
    throw new Error("Unexpected operation");
  },stored,"#draft=test&modal=1");
  try{
    w.document.getElementById("capture-form").dispatchEvent(new w.Event("submit",{bubbles:true,cancelable:true}));await flush();
    assert.equal(messages.some(msg=>msg.kind==="queue_capture"),false);
    assert.equal(w.document.getElementById("matches").hidden,false);
    w.document.getElementById("continue").click();await flush();await flush();
    assert.equal(messages.find(msg=>msg.kind==="queue_capture").draft.duplicate_ack,"confirmed");
    assert.ok(messages.some(msg=>msg.kind==="close_capture"));
  }finally{w.close();}
});
test("Popup keeps older unresolved captures accessible after newer successes",async()=>{
  const jobs=Array.from({length:9},(_,index)=>({id:"j"+index,draft_id:"d"+index,expression:index===8?"Older failed capture":"new word "+index,deck_name:"WORDS",status:index===8?"needs_confirmation":"done",error:index===8?'{"error":"rate_limit"}':"",queued_at:index}));
  const {dom,w}=await page("popup",async msg=>{
    if(msg.kind==="capture_history")return {ok:true,result:jobs};
    throw new Error("Unexpected operation");
  });
  try{
    assert.ok(w.document.querySelector('a[href="capture.html#draft=d8"]'),"every unresolved capture must have a recovery link");
    assert.doesNotMatch(w.document.getElementById("jobs").textContent,/[{}]|rate_limit/,"raw failure JSON must stay out of the popup");
  }
  finally{w.close();}
});
