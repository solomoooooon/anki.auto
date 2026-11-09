import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {build} from "esbuild";
import {JSDOM} from "jsdom";
import {randomUUID} from "node:crypto";
const flush=()=>new Promise(resolve=>setTimeout(resolve,15));
const base={active:true,session:"session",revision:0,card_id:1,note_id:11,modified:0,front:"the dog",back:"le chien",css:"",home_deck:"French",language:"fr",fields:{},intervals:["1m","6m","1d","4d"],counts:{new:2,learning:0,review:0},can_undo:false,space_rates:true,marked:false,flag:0};
test("Delayed next-card media cannot expose rating actions for an unseen card",async()=>{
  const html=await readFile(new URL("../src/review.html",import.meta.url),"utf8");
  const dom=new JSDOM(html,{url:"https://extension.invalid/review.html",runScripts:"outside-only"}),w=dom.window;
  let actions=0;
  const deferred=[];
  w.matchMedia=()=>({matches:false});
  Object.defineProperty(w.crypto,"randomUUID",{value:randomUUID});
  w.chrome={storage:{local:{get:async()=>({}),set:async()=>{}}},runtime:{sendMessage:async message=>{
    let result;
    if(message.path==="/decks")result={profile:"Test",decks:[]};
    else if(message.path==="/review/current")result=base;
    else if(message.path==="/review/action"){actions++;result={...base,revision:1,card_id:2,front:'<img src="dog.png">the cat',back:"le chat"};}
    else if(message.path==="/media")return await new Promise(resolve=>deferred.push(()=>resolve({ok:true,result:{mime:"image/png",data:""}})));
    else throw new Error(message.path);
    return {ok:true,result};
  }}};
  const source=await build({entryPoints:["extension/src/review.ts"],bundle:true,write:false,format:"iife",target:"es2022"});
  const key=value=>w.document.body.dispatchEvent(new w.KeyboardEvent("keydown",{key:value,code:value===" "?"Space":"Digit"+value,bubbles:true,cancelable:true}));
  const loaded=()=>{const frame=w.document.getElementById("card");frame.contentDocument.documentElement.setAttribute("data-anki-render",frame.srcdoc.match(/data-anki-render="(\d+)"/)[1]);frame.dispatchEvent(new w.Event("load"));};
  try{
    w.eval(source.outputFiles[0].text);await flush();loaded();await flush();
    key(" ");await flush();loaded();await flush();key("3");await flush();
    assert.equal(actions,1);
    key(" ");key("3");await flush();
    assert.equal(actions,1,"unseen next card must not be rated while its image is loading");
    assert.equal(w.document.getElementById("ratings").hidden,true);
  }finally{deferred.forEach(resolve=>resolve());dom.window.close();}
});
