import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {JSDOM} from "jsdom";

const source=await build({entryPoints:["extension/src/card-document.ts"],bundle:true,write:false,format:"iife",globalName:"Cards",target:"es2022"});
const flush=()=>new Promise(resolve=>setTimeout(resolve,10));
async function page(theme="dark"){
  const dom=new JSDOM('<header class="header"></header><iframe id="card" class="study-frame"></iframe>',{url:"https://extension.invalid/review.html",runScripts:"outside-only"});
  const w=dom.window,stored={theme};let changed;
  w.matchMedia=()=>({matches:false,addEventListener(){}});
  w.chrome={storage:{local:{get:async()=>stored,set:async value=>Object.assign(stored,value)},onChanged:{addListener:fn=>changed=fn}}};
  w.Cards=w.eval(source.outputFiles[0].text+"\nCards;");await flush();
  return {dom,w,stored,change:value=>changed({theme:{newValue:value}},"local")};
}

test("Review card canvas follows the chosen theme despite Anki's white base styling",async()=>{
  const {dom,w}=await page();
  try{
    const html=await w.Cards.cardDocument('<b>to rent</b><span style="color:red">hint</span>',".card {background:white;color:black;font-size:28px}",[]);
    const card=new w.DOMParser().parseFromString(html,"text/html");
    assert.equal(card.documentElement.style.colorScheme,"dark");
    assert.equal(card.body.style.getPropertyPriority("background-color"),"important");
    assert.equal(card.body.style.getPropertyPriority("color"),"important");
    assert.ok(card.body.classList.contains("nightMode"));
    assert.equal(card.querySelector("b").textContent,"to rent");
    assert.equal(card.querySelector("span").style.color,"red","intentional field formatting is retained");
    assert.match(card.querySelector("style").textContent,/font-size:28px/);
  }finally{dom.window.close();}
});

test("Theme choice is saved and updates an already-revealed card without reloading it",async()=>{
  const {dom,w,stored,change}=await page();
  try{
    const frame=w.document.getElementById("card"),card=frame.contentDocument;
    card.body.innerHTML='<p id="answer">alugar</p>';
    w.Cards.applyCardTheme(card,"dark");
    const answer=card.getElementById("answer");
    const light=w.document.querySelector('[data-theme-option="light"]');
    assert.ok(light,"a visible light mode control is available");
    light.click();await flush();
    assert.equal(stored.theme,"light");
    assert.equal(w.document.documentElement.dataset.theme,"light");
    assert.equal(card.documentElement.style.colorScheme,"light");
    assert.equal(card.body.classList.contains("nightMode"),false);
    assert.equal(card.getElementById("answer"),answer,"switching themes must preserve the card DOM and answer");
    assert.equal(light.getAttribute("aria-pressed"),"true");
    change("dark");
    assert.equal(card.documentElement.style.colorScheme,"dark","changes in another extension page apply here too");
  }finally{dom.window.close();}
});
