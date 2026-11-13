import {api} from "./api";
import {applyCardTheme,currentTheme} from "./theme";
export {applyCardTheme} from "./theme";
// Card templates are data: render in a scriptless iframe and only load local Anki media.
export async function cardDocument(html:string,css:string,audio:string[]):Promise<string>{
  const doc=new DOMParser().parseFromString(html.replace(/\[anki:play:[qa]:\d+\]/g,""),"text/html");
  doc.querySelectorAll("script,iframe,object,embed,link,meta,base,form,input,textarea,button,video,source,svg,anki-play-button").forEach(node=>node.remove());
  const media=async(name:string)=>{
    try{const value=await api<{mime:string;data:string}>("/media",{name:decodeURIComponent(name)});return `data:${value.mime};base64,${value.data}`;}catch{return "";}
  };
  const tasks:Promise<void>[]=[];
  for(const node of doc.querySelectorAll("*")){
    for(const attr of Array.from(node.attributes)){
      if(attr.name.startsWith("on")||["href","srcset","action","formaction","target","autofocus","contenteditable"].includes(attr.name))node.removeAttribute(attr.name);
      if(attr.name==="style")node.setAttribute("style",cleanCSS(attr.value));
    }
    if(node.hasAttribute("src")){
      const name=node.getAttribute("src")||"";node.removeAttribute("src");
      if(!/^[a-z]+:|^\/\//i.test(name)&&!name.includes("/"))tasks.push(media(name).then(url=>{if(url)node.setAttribute("src",url);}));
    }
  }
  doc.querySelectorAll("style").forEach(node=>node.textContent=cleanCSS(node.textContent||""));
  for(const name of audio){
    const player=doc.createElement("audio");player.controls=true;player.preload="auto";
    doc.body.append(player);tasks.push(media(name).then(url=>{player.src=url;}));
  }
  await Promise.all(tasks);
  const style=doc.createElement("style");style.textContent=`body{margin:0;padding:36px 24px;font:24px/1.5 system-ui;text-align:center;overflow-wrap:anywhere}img{max-width:100%;height:auto}audio{display:block;max-width:100%;margin:12px auto}${cleanCSS(css)}`;
  doc.head.append(style);doc.body.classList.add("card");applyCardTheme(doc,currentTheme());
  return "<!doctype html>"+doc.documentElement.outerHTML;
}
function cleanCSS(value:string){return value.replace(/@import[^;]*(;|$)/gi,"").replace(/url\s*\([^)]*\)/gi,"none");}
