import {api,element,input,notify} from "./api";
void chrome.storage.local.get("backendPort").then(s=>input("port").value=String(s.backendPort||8766));
element<HTMLFormElement>("pair").onsubmit=async event=>{
  event.preventDefault();
  try{
    const port=Number(input("port").value);
    if(!Number.isInteger(port)||port<1024||port>65535)throw new Error("Choose a valid port.");
    const response=await fetch(`http://127.0.0.1:${port}/pair`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code:input("code").value.trim()}),signal:AbortSignal.timeout(10000)});
    const result=await response.json();if(!result.ok)throw new Error(result.error);
    await chrome.storage.local.set({backendPort:port,backendToken:result.result.token});input("code").value="";
    element("status").textContent="Paired. Checking Anki…";await check();
  }catch(error){notify(error);}
};
async function check(){
  try{
    const health=await api<{bridge:{connected:boolean;profile?:string;error?:string};model:string}>("/health");
    if(!health.bridge.connected)throw new Error(health.bridge.error||"Open Anki and install the bundled add-on.");
    element("status").textContent=`Anki connected: ${health.bridge.profile}. Checking Codex…`;
    const codex=await api<Record<string,unknown>>("/codex/status");
    element("status").textContent=`Anki connected: ${health.bridge.profile}.\n${JSON.stringify(codex)}\nModel: ${health.model}`;
  }catch(error){notify(error);}
}
element("check").onclick=check;
element("forget").onclick=async()=>{await chrome.storage.local.remove("backendToken");element("status").textContent="Pairing removed from this extension.";};
