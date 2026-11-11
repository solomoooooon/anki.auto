import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import vm from "node:vm";
import {randomUUID} from "node:crypto";
test("Queued captures persist before replying and expose background failures after the modal closes",async()=>{
  const storage={"draft:draft1":{expression:"valorous",source_url:"",source_title:"",context:""}};
  let listener,alarmListener,badge="",status="queued";
  const alarms=new Map();
  const event=()=>({addListener(){}});
  const chrome={
    runtime:{id:"extension",getURL:path=>"chrome-extension://extension/"+path,onMessage:{addListener:fn=>listener=fn},onInstalled:event(),onStartup:event()},
    storage:{local:{get:async()=>storage,set:async value=>Object.assign(storage,value),remove:async()=>{}},session:{}},
    alarms:{get:async name=>alarms.get(name),create:async(name,info)=>alarms.set(name,info),clear:async name=>alarms.delete(name),onAlarm:{addListener:fn=>alarmListener=fn}},
    action:{setBadgeText:async value=>badge=value.text,setBadgeBackgroundColor:async()=>{}},
  };
  const fetch=async(url,options)=>{
    const id=options.method==="POST"?JSON.parse(options.body).request_id:url.split("/").at(-1);
    const current=id==="job1"?status:"done";
    return {status:200,json:async()=>({ok:true,result:{id,status:current,error:current==="failed"?"Translation unavailable":"",result:null}})};
  };
  const source=await build({entryPoints:["extension/src/background.ts"],bundle:true,write:false,format:"iife",target:"es2022"});
  vm.runInNewContext(source.outputFiles[0].text,{chrome,fetch,URL,AbortSignal,crypto:{randomUUID},console});
  const send=message=>new Promise(resolve=>listener(message,{id:"extension",url:"chrome-extension://extension/capture.html"},resolve));
  const result=await send({kind:"queue_capture",id:"draft1",draft:{expression:"valorous",request_id:"job1",deck_id:7},deck_name:"WORDS"});
  assert.equal(result.ok,true);
  assert.equal(storage["draft:draft1"].job_id,"job1");
  assert.equal(storage.captureJobs[0].status,"queued");
  assert.ok(alarms.has("capture-jobs"));
  status="failed";await alarmListener({name:"capture-jobs"});await new Promise(resolve=>setTimeout(resolve,15));
  const history=await send({kind:"capture_history"});
  assert.equal(history.result[0].status,"failed");
  assert.equal(history.result[0].expression,"valorous");
  assert.equal(badge,"!");
  for(let index=0;index<34;index++)await send({kind:"queue_capture",id:"draft-new"+index,draft:{expression:"term"+index,request_id:"new"+index,deck_id:7},deck_name:"WORDS"});
  assert.ok(storage.captureJobs.some(job=>job.id==="job1"),"unresolved captures must survive pruning of completed history");
  assert.equal(storage.captureJobs.length,31);
});
