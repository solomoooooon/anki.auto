export type Theme="light"|"dark";
const cacheKey="anki.auto.theme";
const isTheme=(value:unknown):value is Theme=>value==="light"||value==="dark";

export function currentTheme():Theme {
  return document.documentElement.dataset.theme==="dark"?"dark":"light";
}

// Override only the card canvas. Preserve template layout and intentional field colors.
export function applyCardTheme(doc:Document,theme:Theme){
  doc.documentElement.style.colorScheme=theme;
  doc.documentElement.dataset.theme=theme;
  for(const node of [doc.documentElement,doc.body]){
    node.style.setProperty("background-color","light-dark(#fff, #262a25)","important");
    node.style.setProperty("color","light-dark(#24332b, #edf1e9)","important");
  }
  for(const name of ["nightMode","night_mode"])doc.body.classList.toggle(name,theme==="dark");
}

function initialize(){
  const system=typeof matchMedia==="function"?matchMedia("(prefers-color-scheme:dark)"):null;
  let preference:Theme|null=null,revision=0;
  try{const cached=localStorage.getItem(cacheKey);if(isTheme(cached))preference=cached;}catch{/* Storage can be unavailable in embedded pages. */}
  function apply(theme:Theme){
    document.documentElement.dataset.theme=theme;
    document.querySelectorAll<HTMLElement>("[data-theme-option]").forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.themeOption===theme)));
    document.querySelectorAll<HTMLIFrameElement>("iframe.study-frame").forEach(frame=>{if(frame.contentDocument?.body)applyCardTheme(frame.contentDocument,theme);});
    try{if(preference)localStorage.setItem(cacheKey,preference);else localStorage.removeItem(cacheKey);}catch{/* Chrome storage remains the source of truth. */}
  }
  const effective=()=>preference||(system?.matches?"dark":"light");
  const controls=document.createElement("div");controls.className="theme-switch";controls.setAttribute("role","group");controls.setAttribute("aria-label","Color theme");
  for(const theme of ["light","dark"] as const){
    const button=document.createElement("button");button.type="button";button.dataset.themeOption=theme;button.textContent=theme==="light"?"Light":"Dark";
    button.onclick=()=>{++revision;preference=theme;apply(theme);void chrome.storage.local.set({theme});};
    controls.append(button);
  }
  document.querySelector(".header")?.append(controls);
  apply(effective());
  const initialRevision=revision;
  void chrome.storage.local.get("theme").then(stored=>{
    if(revision!==initialRevision)return;
    preference=isTheme(stored.theme)?stored.theme:null;apply(effective());
  }).catch(()=>{});
  chrome.storage.onChanged?.addListener((changes,area)=>{
    if(area!=="local"||!changes.theme)return;
    ++revision;preference=isTheme(changes.theme.newValue)?changes.theme.newValue:null;apply(effective());
  });
  system?.addEventListener?.("change",()=>{if(!preference)apply(effective());});
}
if(typeof document!=="undefined")initialize();
