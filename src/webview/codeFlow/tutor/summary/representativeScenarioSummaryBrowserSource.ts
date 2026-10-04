/** Representative projections and rendering over the existing shared Workspace rows; no evaluator or consumer. */
import { createFunctionExecutionScenarioModeler } from "../../../../shared/functionScenarios";

export function getRepresentativeScenarioSummaryBrowserSource(): string {
  return /* js */ `
    ${createFunctionExecutionScenarioModeler.toString()}

    /** Projects once per result revision; selection, localization and playback reuse the same objects. */
    function createFunctionTutorRepresentativeSummaryCache(tutor) {
      let revision;let result;
      const blocks=new Map((tutor.program?.blocks||[]).map((block)=>[block.blockId,block]));
      const summaryItems=[...(tutor.behaviorSummary?.outcomes||[]),...(tutor.behaviorSummary?.steps||[]),...(tutor.behaviorSummary?.impacts||[])];
      const tokensFor=(blockId)=>blocks.get(blockId)?.evidenceTokens||summaryItems.find((item)=>item.blockIds?.[0]===blockId)?.evidenceTokens||[];
      let modeler;
      return {read(rows,nextRevision,sharedCatalog){
        if(result&&revision===nextRevision)return result;
        revision=nextRevision;
        const catalog=sharedCatalog||(modeler ||= createFunctionExecutionScenarioModeler(tutor)).catalog(rows);
        const executions=new Map(catalog.scenarios.map((scenario)=>[scenario.id,scenario]));
        const available=rows.filter((row)=>row.path).map((row,index)=>{
          const execution=executions.get(row.seed.id+":path:"+row.pathIndex);
          if(!execution)return undefined;
          const decisions=execution.conditions.map((condition)=>({...condition,label:condition.sourcePreview}));
          const effects=execution.steps.filter((step)=>step.kind==="call"||step.kind==="effect").slice(0,8).map((step)=>({blockId:step.blockId,kind:step.kind,label:step.sourcePreview}));
          const writes=execution.steps.filter((step)=>step.kind==="write"&&step.after!==undefined).slice(0,8).map((step)=>({...step,target:step.targetName}));
          const staticWrites=execution.basis==="symbolic"?execution.steps.filter((step)=>step.kind==="write").slice(0,8):[];
          const primary=execution.outcome.blockId||decisions[0]?.blockId||effects[0]?.blockId||execution.graph.blockIds[0];
          return {row,execution,ordinal:index+1,decisions,effects,writes,staticWrites,terminalSource:execution.outcome.sourcePreview,basis:execution.basis==="symbolic"?"symbolic":"concrete",partial:execution.status==="partial",kind:execution.outcome.kind,assumptions:execution.assumptions,gapCount:execution.gaps.length+execution.omittedCounts.gaps,evidenceToken:tokensFor(primary)[0]};
        });
        const byId=new Map(available.filter(Boolean).map((item)=>[item.execution.id,item]));
        result={items:catalog.representativeIds.map((id)=>byId.get(id)).filter(Boolean),total:catalog.scenarios.length,catalog};return result;
      }};
    }

    /** Renders 3 or 5 existing rows; selection previews only, while source/graph buttons stay separate. */
    function createFunctionTutorRepresentativeSummary(projection,selectedSeedId,selectedPathIndex,expanded,tutor,callbacks) {
      const section=document.createElement("section");section.className="logic-representative-summary";
      const heading=document.createElement("h4");const note=document.createElement("p");heading.textContent=projectAnalyzerText("summary-representatives");note.className="logic-summary-note";note.textContent=projectAnalyzerText("summary-representatives-note");section.append(heading,note);
      const visible=projection.items.slice(0,expanded?5:3);const list=document.createElement("ol");list.className="logic-summary-scenarios";list.id=callbacks.listId;
      for(let index=0;index<visible.length;index+=1){
        const item=visible[index];const row=item.row;const selected=row.seed.id===selectedSeedId&&row.pathIndex===selectedPathIndex;
        const entry=document.createElement("li");entry.className="logic-summary-scenario"+(selected?" selected":"");
        const select=document.createElement("button");select.type="button";select.className="logic-guide-scenario-select logic-summary-scenario-select"+(selected?" selected":"");select.dataset.guideKey="summary-path:"+row.seed.id+":"+row.pathIndex;select.textContent=projectAnalyzerText("summary-title-"+item.kind,{ordinal:item.ordinal});select.setAttribute("aria-current",selected?"true":"false");select.tabIndex=selected||index===0&&!visible.some((candidate)=>candidate.row.seed.id===selectedSeedId&&candidate.row.pathIndex===selectedPathIndex)?0:-1;
        select.addEventListener("click",()=>callbacks.onSelect(row,select.dataset.guideKey));
        select.addEventListener("keydown",(event)=>{let next;if(event.key==="ArrowDown")next=(index+1)%visible.length;else if(event.key==="ArrowUp")next=(index+visible.length-1)%visible.length;else if(event.key==="Home")next=0;else if(event.key==="End")next=visible.length-1;else return;event.preventDefault();const current=visible[next].row;callbacks.onSelect(current,"summary-path:"+current.seed.id+":"+current.pathIndex);});
        const status=document.createElement("p");status.className="logic-summary-basis";status.textContent=projectAnalyzerText("summary-"+item.basis)+(item.partial?" · "+projectAnalyzerText("summary-path-partial"):"");status.title=projectAnalyzerText("summary-"+item.basis+"-note");status.append(createFunctionGuideCertainty(row.path.certainty||row.seed.certainty));entry.append(select,status);
        const facts=document.createElement("dl");facts.className="logic-summary-scenario-facts";
        const inputs=item.execution.inputs.slice(0,8).map((input)=>input.name+" = "+functionTutorValueText(input.value));
        const conditions=item.decisions.map((decision)=>decision.label+" → "+projectAnalyzerText("scenario-outcome-"+decision.outcome));
        const work=item.execution.steps.filter((step)=>["call","effect","write"].includes(step.kind)).slice(0,12).map((step)=>step.kind==="write"&&step.after!==undefined?(step.targetName||step.sourcePreview)+": "+functionTutorValueText(step.before)+" → "+functionTutorValueText(step.after):step.sourcePreview);
        const outcome=item.execution.outcome;
        const terminal=item.basis==="concrete"&&item.kind==="return"&&outcome.value&&outcome.value.kind!=="unknown"?projectAnalyzerText("summary-terminal-value",{value:functionTutorValueText(outcome.value)}):item.terminalSource?projectAnalyzerText("summary-terminal-source",{source:item.terminalSource}):projectAnalyzerText("summary-terminal-unknown");
        const limits=[terminal,item.partial?projectAnalyzerText("summary-path-partial"):"",item.gapCount?projectAnalyzerText("summary-path-gaps",{count:item.gapCount}):"",item.assumptions.length?projectAnalyzerText("summary-path-assumptions",{value:item.assumptions.join(" · ")}):""];
        for(const [key,text]of [["summary-input-conditions",[...inputs,...conditions].join(" · ")||projectAnalyzerText("summary-no-conditions")],["summary-calls-writes",work.join(" → ")||projectAnalyzerText("summary-no-effects")],["summary-terminal-gaps",limits.filter(Boolean).join(" · ")]]){const term=document.createElement("dt");const value=document.createElement("dd");term.textContent=projectAnalyzerText(key);value.textContent=text;value.setAttribute("translate","no");facts.append(term,value);}entry.append(facts);
        const explanation=document.createElement("p");explanation.className="logic-summary-note";explanation.textContent=projectAnalyzerText("summary-"+item.basis+"-note");entry.append(explanation);
        const actions=document.createElement("div");actions.className="logic-guide-actions";
        const show=document.createElement("button");show.type="button";show.className="logic-guide-action";show.dataset.guideKey="summary-path-graph:"+row.seed.id+":"+row.pathIndex;show.textContent=projectAnalyzerText("show-graph");show.disabled=!item.execution.graph.blockIds.length;show.addEventListener("click",()=>callbacks.onShowGraph?.({preferredLens:"flow",primaryBlockId:item.execution.graph.blockIds[0],attentionBlockIds:item.execution.graph.blockIds,attentionEdgeIds:item.execution.graph.edgeIds}));actions.append(show);
        if(item.evidenceToken)actions.append(functionTutorSummarySource(item.evidenceToken,callbacks,"path:"+row.seed.id+":"+row.pathIndex));entry.append(actions);list.append(entry);
      }
      section.append(list);
      if(!visible.length){const empty=document.createElement("p");empty.className="logic-summary-note";empty.textContent=projectAnalyzerText("summary-pending");section.append(empty);}
      if(projection.items.length>3){const more=document.createElement("button");more.type="button";more.className="logic-guide-action logic-summary-show-more";more.dataset.guideKey="summary-show-more";more.setAttribute("aria-expanded",expanded?"true":"false");more.setAttribute("aria-controls",list.id);more.textContent=projectAnalyzerText(expanded?"summary-show-less":"summary-show-more");more.addEventListener("click",()=>callbacks.onExpand(!expanded));section.append(more);}
      const omitted=projection.total-visible.length;if(omitted>0){const note=document.createElement("p");note.className="logic-summary-note";note.textContent=projectAnalyzerText("summary-other-scenarios",{count:omitted});section.append(note);}return section;
    }
  `;
}
