import test from "node:test";
import assert from "node:assert/strict";
import {reviewShortcut} from "../src/shortcuts.ts";
import {markerPosition} from "../src/selection.ts";

const key=(key,extra={})=>({key,code:key===" "?"Space":key,repeat:false,isComposing:false,ctrlKey:false,altKey:false,metaKey:false,shiftKey:false,...extra});
const state={active:true,answerVisible:false,editing:false,dialogOpen:false,focusedButton:false,spaceRates:true};

test("Space/Enter reveal then select Good; ratings require reveal",()=>{
  assert.deepEqual(reviewShortcut(key(" "),state),{action:"reveal"});
  assert.deepEqual(reviewShortcut(key("Enter"),{...state,answerVisible:true}),{action:"rate",rating:3});
  assert.equal(reviewShortcut(key("1"),state),null);
  for(let rating=1;rating<=4;rating++)assert.deepEqual(reviewShortcut(key(String(rating)),{...state,answerVisible:true}),{action:"rate",rating});
});
test("Typing, dialogs, held keys, IME and focused native buttons never rate",()=>{
  for(const patch of [{editing:true},{dialogOpen:true},{focusedButton:true},{active:false}])
    assert.equal(reviewShortcut(key("Enter"),{...state,answerVisible:true,...patch}),null);
  assert.equal(reviewShortcut(key("1",{repeat:true}),{...state,answerVisible:true}),null);
  assert.equal(reviewShortcut(key("1",{isComposing:true}),{...state,answerVisible:true}),null);
  assert.equal(reviewShortcut(key("1",{ctrlKey:true}),{...state,answerVisible:true}),null);
  assert.equal(reviewShortcut(key(" "),{...state,answerVisible:true,spaceRates:false}),null);
});
test("Undo, bury/suspend and deck selection match Anki",()=>{
  for(const [input,action] of [["u","undo"],["-","bury_card"],["=","bury_note"],["@","suspend_card"],["!","suspend_note"],["*","mark"],["e","edit"],["r","replay"],["/","decks"],["s","overview"]])
    assert.deepEqual(reviewShortcut(key(input),state),{action});
  assert.deepEqual(reviewShortcut(key("z",{ctrlKey:true}),state),{action:"undo"});
});
test("Selection marker stays inside the viewport at edges",()=>{
  assert.deepEqual(markerPosition({right:995,top:2},1000,700),{left:960,top:8});
  assert.deepEqual(markerPosition({right:200,top:200},1000,700),{left:204,top:164});
});

test("Custom Anki answer keys replace the default keys",()=>{
  const custom={...state,answerVisible:true,answerKeys:["j","k","l",";"]};
  assert.deepEqual(reviewShortcut(key("l"),custom),{action:"rate",rating:3});
  assert.equal(reviewShortcut(key("3"),custom),null);
});
