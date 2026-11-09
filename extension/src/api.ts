export interface Draft {
  expression:string; context:string; source_url:string; source_title:string;
  language?:string; detected_language?:string; host_tab?:number; created?:number;
  request_id?:string; deck_id?:number; custom_definition?:string; add_example?:boolean;
  example_front?:string;example_back?:string;duplicate_ack?:string;job_id?:string;
}
export interface Match {note_id:number;term:string;front:string;score:number}
export interface Matches {matches:Match[];fingerprint:string;ack_token:string}
export interface Deck {id:number;name:string;counts:{new:number;review:number;learning:number}}
export interface Decks {profile:string;decks:Deck[]}
export interface Saved {note_id:number;card_ids:number[];card_count:number;deck_name:string;front:string;back:string;example_front:string;example_back:string;language:string}
export interface Job {id:string;status:string;error:string;result:Saved|Matches|null}
export interface CardSnapshot {
  active:boolean;session:string;revision:number;card_id:number|null;note_id:number;modified:number;
  front:string;back:string;css:string;home_deck:string;language:string;fields:Record<string,string>;
  intervals:string[];counts:{new:number;learning:number;review:number};can_undo:boolean;
  space_rates:boolean;marked:boolean;flag:number;finished?:boolean;next_due?:number;recovery?:boolean;
  answer_keys?:string[];question_audio?:string[];answer_audio?:string[];
}
export class LocalError extends Error {
  constructor(message:string,public details?:Matches,public status?:number){super(message);}
}
export async function message<T>(payload:unknown):Promise<T> {
  const response=await chrome.runtime.sendMessage(payload);
  if(!response?.ok)throw new LocalError(response?.error || "The extension could not complete this request.",response?.details,response?.status);
  return response.result as T;
}
export function api<T>(path:string,data?:unknown):Promise<T> {
  return message<T>({kind:"api",path,method:data===undefined?"GET":"POST",data});
}
export function element<T extends HTMLElement=HTMLElement>(id:string):T {
  const value=document.getElementById(id);
  if(!value)throw new Error("Missing element: "+id);
  return value as T;
}
export function notify(error:unknown,id="status") {
  element(id).textContent=error instanceof Error?error.message:String(error);
}
export const input=(id:string)=>(element<HTMLInputElement>(id));
