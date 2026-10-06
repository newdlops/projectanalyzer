/** Cached model explanations become scenario-owned canvas notes; visibility never authorizes inference. */
import { projectNarrativeGraphNotes, layoutNarrativeGraphNotes } from "./model";

export function getNarrativeGraphNotesBrowserSource(): string {
  return /* js */ `
    ${projectNarrativeGraphNotes.toString()}
    ${layoutNarrativeGraphNotes.toString()}
    const narrativeGraphNoteSessions=new Map();
    /** One rail follows one selected scenario and releases observers/DOM with the graph. */
    function createNarrativeGraphNotes(options) {
      const layer=document.createElement("section"),toggle=document.createElement("button");
      const connections=createLogicSvgElement("svg");
      layer.className="logic-narrative-note-layer";layer.hidden=true;
      connections.classList.add("logic-narrative-note-connections");connections.setAttribute("aria-hidden","true");
      toggle.type="button";toggle.className="logic-zoom-button logic-narrative-note-toggle";
      const slots=new Map(),heights=new Map(),nearby=new Set(),mounted=new Set();
      let metadata,notes=[],placements=[],enabled=narrativeGraphNoteSessions.get(options.sessionKey)??true,disposed=false,observer,selected,tabMarker,resize;
      const collapsedHeight=window.matchMedia?.("(pointer: coarse)")?.matches?176:128;
      const maxMounted=40;
      // One observer for mounted notes keeps text scaling and localization from
      // producing overlapping cards; it batches measurements before placement.
      if(typeof ResizeObserver==="function")resize=new ResizeObserver(entries=>{if(disposed)return;let changed=false;for(const entry of entries){const id=entry.target.dataset.noteBlockId,slot=slots.get(id);if(!slot?.card||slot.element!==entry.target)continue;const height=Math.max(collapsedHeight,Math.min(520,entry.borderBoxSize?.[0]?.blockSize||entry.target.offsetHeight||collapsedHeight));if(heights.get(id)!==height){heights.set(id,height);changed=true;}}if(changed)place();});
      /** Detailed prose is mounted only near the viewport; small anchors retain all reached nodes. */
      if(typeof IntersectionObserver==="function")observer=new IntersectionObserver(entries=>{
        if(disposed)return;
        for(const entry of entries){const id=entry.target.dataset.noteBlockId;if(slots.get(id)?.element!==entry.target)continue;if(entry.isIntersecting)nearby.add(id);else nearby.delete(id);}
        reconcile();
      },{root:options.viewport,rootMargin:"180px",threshold:0});
      function copy(){
        toggle.textContent=projectAnalyzerText("narrative-graph-notes");toggle.disabled=!notes.length;
        toggle.setAttribute("aria-pressed",enabled&&notes.length?"true":"false");
        toggle.title=projectAnalyzerText(notes.length?"narrative-graph-notes-help":"narrative-graph-notes-empty");
        layer.setAttribute("aria-label",projectAnalyzerText("narrative-graph-notes-scenario",{scenario:metadata?.ordinal||1}));
      }
      /** Annotation bounds extend pan/Fit space without relocating source nodes or changing zoom. */
      function place(){
        placements=layoutNarrativeGraphNotes(notes,options.layout.width,heights);
        const last=placements.at(-1),width=enabled&&last?last.x+last.width+24:options.layout.width;
        const height=enabled&&last?Math.max(options.layout.height,last.y+last.height+24):options.layout.height;
        options.viewportController.setContentBounds?.({width,height});
        connections.setAttribute("width",String(width));connections.setAttribute("height",String(height));
        connections.replaceChildren();
        for(const note of placements){
          const slot=slots.get(note.blockId);if(!slot)continue;
          slot.element.style.setProperty("left",note.x+"px");slot.element.style.setProperty("top",note.y+"px");
          const path=createLogicSvgElement("path");path.classList.add("logic-narrative-note-reference");
          path.setAttribute("d","M "+(note.node.x+note.node.width+22)+" "+(note.node.y+15)+" H "+(note.x-12)+" V "+(note.y+20)+" H "+note.x);
          path.classList.toggle("selected",note.blockId===selected);slot.path=path;connections.append(path);
        }
        select(options.comprehension.getState().selectedBlockId);copy();
      }
      function select(id){
        const nextTab=slots.has(id)?id:notes[0]?.blockId;
        if(selected===id&&tabMarker===nextTab&&slots.get(id)?.element.classList.contains("selected"))return;
        for(const slot of [slots.get(selected),slots.get(tabMarker),slots.get(id),slots.get(nextTab)])if(slot){const active=slot.note.blockId===id;slot.element.classList.toggle("selected",active);slot.path?.classList.toggle("selected",active);slot.marker.setAttribute("tabindex",slot.note.blockId===nextTab?"0":"-1");}
        selected=id;tabMarker=nextTab;
      }
      function source(slot,nodeIndex){if(slots.get(slot.note.blockId)===slot)metadata?.openSource?.(nodeIndex);}
      /** All model text uses textContent; inline source/model HTML stays literal. */
      function mount(slot){
        if(slot.card)return;
        const heading=document.createElement("h4"),basis=document.createElement("p"),preview=document.createElement("p"),details=document.createElement("details"),summary=document.createElement("summary"),body=document.createElement("div");
        const first=slot.note.visits[0];
        heading.textContent=metadata.ordinal+"."+(first.nodeIndex+1)+" · L"+first.detail.source.startLine;
        basis.className="logic-narrative-note-basis";basis.textContent=projectAnalyzerText("narrative-ready")+" · "+projectAnalyzerText("narrative-language-"+metadata.language);
        // The preview is an explicit excerpt. Complete prose remains readable
        // in the disclosure; no CSS line clamp hides source or note contents.
        preview.className="logic-narrative-note-preview";preview.textContent=first.detail.text.length>64?first.detail.text.slice(0,64)+"…":first.detail.text;
        summary.textContent=projectAnalyzerText("narrative-graph-note-expand",{count:slot.note.visits.length});
        body.className="logic-narrative-note-body";
        body.tabIndex=0;body.setAttribute("aria-label",projectAnalyzerText("narrative-graph-notes-scenario",{scenario:metadata.ordinal})+" · L"+first.detail.source.startLine);
        // The graph owns touch gestures. A bounded note scroll remains local
        // instead of moving the whole canvas or depending on ancestor touch-action.
        let touch;
        body.addEventListener("pointerdown",event=>{if(event.pointerType!=="touch"||event.target?.closest?.("button,summary"))return;touch={id:event.pointerId,y:event.clientY,top:body.scrollTop};body.setPointerCapture?.(event.pointerId);});
        body.addEventListener("pointermove",event=>{if(!touch||touch.id!==event.pointerId)return;body.scrollTop=touch.top+touch.y-event.clientY;event.preventDefault();});
        const endTouch=()=>{touch=undefined;};body.addEventListener("pointerup",endTouch);body.addEventListener("pointercancel",endTouch);
        for(let visit=0;visit<slot.note.visits.length;visit++){
          const item=slot.note.visits[visit],section=document.createElement("section");
          if(slot.note.visits.length>1){const label=document.createElement("strong");label.textContent=projectAnalyzerText("narrative-node-visit",{visit:visit+1});section.append(label);}
          for(const [key,text]of [[undefined,item.detail.text],["narrative-syntax",item.detail.syntax],["narrative-reason",item.detail.reason],["narrative-effect",item.detail.effect]])if(text){
            const paragraph=document.createElement("p");if(key){const label=document.createElement("strong");label.textContent=projectAnalyzerText(key)+": ";paragraph.append(label);}paragraph.append(document.createTextNode(text));section.append(paragraph);
          }
          if(item.detail.values?.length){const caption=document.createElement("p"),values=document.createElement("dl");caption.className="logic-narrative-note-basis";caption.textContent=projectAnalyzerText("narrative-node-values");section.append(caption);for(const value of item.detail.values){const name=document.createElement("dt"),change=document.createElement("dd");name.textContent=value.name;change.textContent=value.before+" → "+value.after;name.setAttribute("translate","no");change.setAttribute("translate","no");values.append(name,change);}section.append(values);}
          const button=document.createElement("button");button.type="button";button.className="logic-guide-action logic-narrative-note-source";
          button.textContent=projectAnalyzerText("narrative-node-source",{line:item.detail.source.startLine});button.addEventListener("click",()=>source(slot,item.nodeIndex));section.append(button);body.append(section);
        }
        details.append(summary,body);details.open=slot.open||false;
        details.addEventListener("toggle",()=>{if(disposed||!slot.card)return;slot.open=details.open;heights.set(slot.note.blockId,details.open?Math.min(520,Math.max(collapsedHeight,slot.element.offsetHeight||420)):collapsedHeight);place();});
        slot.element.replaceChildren(heading,basis,preview,details);slot.card=details;mounted.add(slot.note.blockId);resize?.observe(slot.element);
      }
      function unmount(slot){if(!slot?.card)return;resize?.unobserve(slot.element);slot.open=slot.card.open;slot.card=undefined;mounted.delete(slot.note.blockId);slot.element.replaceChildren();slot.element.textContent=projectAnalyzerText("narrative-graph-note-zoom",{line:slot.note.visits[0].detail.source.startLine});}
      function reconcile(){
        if(disposed||!enabled)return;
        const wanted=new Set();
        // Keyboard reading keeps its focused note mounted even at a zoomed-out density.
        for(const id of mounted)if(slots.get(id)?.element.contains?.(document.activeElement))wanted.add(id);
        for(const note of notes)if((nearby.has(note.blockId)||!observer)&&wanted.size<maxMounted)wanted.add(note.blockId);
        for(const id of [...mounted])if(!wanted.has(id))unmount(slots.get(id));
        for(const id of wanted){const slot=slots.get(id);if(slot)mount(slot);}
      }
      function showNote(id){
        const note=placements.find(note=>note.blockId===id);if(!note)return;
        options.comprehension.activateBlock(id,false);
        options.viewportController.revealBounds?.({left:note.x,top:note.y,right:note.x+note.width,bottom:note.y+Math.min(note.height,160)},{preserveScale:true,nearest:true,announce:false});
        const slot=slots.get(id);if(slot){nearby.add(id);if(!mounted.has(id)&&mounted.size>=maxMounted)for(const other of mounted){if(!slots.get(other)?.element.contains?.(document.activeElement)){unmount(slots.get(other));break;}}mount(slot);slot.card?.querySelector?.("summary")?.focus();}
      }
      toggle.addEventListener("click",()=>{
        if(!notes.length)return;enabled=!enabled;layer.hidden=!enabled;place();
        narrativeGraphNoteSessions.set(options.sessionKey,enabled);while(narrativeGraphNoteSessions.size>16)narrativeGraphNoteSessions.delete(narrativeGraphNoteSessions.keys().next().value);
        const current=options.comprehension.getState().selectedBlockId;
        if(enabled){reconcile();showNote(slots.has(current)?current:notes[0].blockId);}else {for(const id of [...mounted])unmount(slots.get(id));options.viewportController.revealBlocks?.([current||notes[0].blockId],{preserveScale:true,nearest:true,announce:false});}
      });
      const unsubscribe=options.comprehension.subscribe(()=>select(options.comprehension.getState().selectedBlockId));
      function setScenario(next){
        if(disposed)return;
        if(metadata?.scenario===next?.scenario&&metadata?.ordinal===next?.ordinal&&metadata?.language===next?.language){metadata=next;return;}
        observer?.disconnect();resize?.disconnect();metadata=next;notes=projectNarrativeGraphNotes(next?.scenario,options.layout.nodes,options.resolveBlockId);
        slots.clear();heights.clear();nearby.clear();mounted.clear();selected=undefined;tabMarker=undefined;layer.replaceChildren(connections);
        for(const note of notes){
          const element=document.createElement("article"),marker=document.createElement("button");
          element.className="logic-narrative-graph-note";element.dataset.noteBlockId=note.blockId;
          element.textContent=projectAnalyzerText("narrative-graph-note-zoom",{line:note.visits[0].detail.source.startLine});
          marker.type="button";marker.className="logic-narrative-note-marker";marker.textContent=next.ordinal+"."+(note.visits[0].nodeIndex+1);
          marker.setAttribute("tabindex","-1");heights.set(note.blockId,collapsedHeight);
          marker.title=projectAnalyzerText("narrative-graph-note-open",{scenario:next.ordinal,line:note.visits[0].detail.source.startLine});marker.setAttribute("aria-label",marker.title);
          marker.style.setProperty("left",(note.node.x+note.node.width+4)+"px");marker.style.setProperty("top",(note.node.y+2)+"px");
          marker.addEventListener("click",()=>showNote(note.blockId));
          const slot={note,element,marker};slots.set(note.blockId,slot);layer.append(element,marker);observer?.observe(element);
        }
        layer.hidden=!enabled||!notes.length;place();reconcile();
      }
      copy();
      return {layer,toggle,setScenario,
        refreshLanguage(){for(const id of [...mounted])unmount(slots.get(id));copy();for(const slot of slots.values()){slot.marker.title=projectAnalyzerText("narrative-graph-note-open",{scenario:metadata.ordinal,line:slot.note.visits[0].detail.source.startLine});slot.marker.setAttribute("aria-label",slot.marker.title);}reconcile();},
        dispose(){disposed=true;observer?.disconnect();resize?.disconnect();unsubscribe?.();slots.clear();notes=[];metadata=undefined;mounted.clear();nearby.clear();layer.replaceChildren();}
      };
    }
  `;
}
