export function markerPosition(rect:{right:number;top:number},width:number,height:number) {
  return {left:Math.max(8,Math.min(rect.right+4,width-40)),top:Math.max(8,Math.min(rect.top-36,height-40))};
}
export function selectionContext(selection:Selection):string {
  const anchor=selection.anchorNode;
  const element=anchor?.nodeType===Node.ELEMENT_NODE?anchor as Element:anchor?.parentElement;
  const block=element?.closest("p,li,blockquote,section,article,div");
  return (block?.textContent || element?.textContent || selection.toString()).replace(/\s+/g," ").trim().slice(0,8000);
}
