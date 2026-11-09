export interface ShortcutState {
  active: boolean; answerVisible: boolean; editing: boolean; dialogOpen: boolean;
  focusedButton: boolean; spaceRates: boolean;
  answerKeys?:string[];
}
export interface KeyLike {
  key: string; code: string; repeat: boolean; isComposing: boolean;
  ctrlKey: boolean; altKey: boolean; metaKey: boolean; shiftKey: boolean;
}
export function reviewShortcut(event: KeyLike, state: ShortcutState): {action:string;rating?:number}|null {
  if (!state.active || state.editing || state.dialogOpen || event.repeat || event.isComposing) return null;
  const key=event.key.toLowerCase();
  if(event.metaKey)return null;
  if(event.ctrlKey && event.altKey && key==="i")return {action:"previous_info"};
  if(event.ctrlKey && !event.altKey && !event.shiftKey && key==="z")return {action:"undo"};
  if(event.ctrlKey || event.altKey)return null;
  if(event.code==="Space" || event.key==="Enter") {
    if(state.focusedButton)return null;
    if(!state.answerVisible)return {action:"reveal"};
    return state.spaceRates?{action:"rate",rating:3}:null;
  }
  const answerKey=(state.answerKeys||["1","2","3","4"]).indexOf(event.key);
  if(answerKey>=0)return state.answerVisible?{action:"rate",rating:answerKey+1}:null;
  const actions:Record<string,string>={u:"undo",e:"edit",r:"replay",f5:"replay",m:"more",i:"info",o:"options",
    "*":"mark","-":"bury_card","=":"bury_note","@":"suspend_card","!":"suspend_note",
    s:"overview","/":"decks","5":"pause","6":"backward","7":"forward"};
  return actions[key]?{action:actions[key]}:null;
}
