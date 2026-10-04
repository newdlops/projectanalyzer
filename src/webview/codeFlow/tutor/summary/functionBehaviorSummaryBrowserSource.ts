/** Static behavior Summary renderer and fail-closed validation against the active Tutor snapshot. */
import { FUNCTION_TUTOR_SUMMARY_PRESENTATION_KEYS, FUNCTION_LOGIC_GAP_PRESENTATION_KEYS, FUNCTION_TUTOR_GAP_PRESENTATION_KEYS } from "../../../../localization/presentationDescriptors";

/** Source text is written exclusively through textContent; graph/source actions remain explicit. */
export function getFunctionBehaviorSummaryBrowserSource(): string {
  return /* js */ `
    const FUNCTION_SUMMARY_COPY_KEYS = new Set(${JSON.stringify(FUNCTION_TUTOR_SUMMARY_PRESENTATION_KEYS)});
    const FUNCTION_SUMMARY_GAP_KEYS = new Set(${JSON.stringify([...FUNCTION_TUTOR_SUMMARY_PRESENTATION_KEYS,...FUNCTION_LOGIC_GAP_PRESENTATION_KEYS,...FUNCTION_TUTOR_GAP_PRESENTATION_KEYS])});
    /** Accepts only bounded optional fields whose references belong to this active program. */
    function functionTutorValidBehaviorSummary(summary, tutor) {
      if (!summary || summary.schema !== 1 || !["ready","partial","unavailable"].includes(summary.status)) return false;
      const blocks = new Set((tutor.program?.blocks || []).map((block) => block.blockId));
      const edgeById = new Map((tutor.program?.edges || []).map((edge) => [edge.edgeId,edge]));
      const edges = new Set(edgeById.keys());
      const tokens = new Set((tutor.evidence || []).map((evidence) => evidence.token));
      const text = (value, limit, optional) => optional && value === undefined || typeof value === "string" && value.length <= limit;
      const refs = (values, allowed, limit) => Array.isArray(values) && values.length <= limit && values.every((value) => typeof value === "string" && allowed.has(value));
      const certainty = (value) => ["exact","inferred","unknown"].includes(value);
      const purpose = summary.purpose;
      if (!purpose || !["documentation","structure"].includes(purpose.basis) || !certainty(purpose.certainty) || !refs(purpose.evidenceTokens,tokens,8) || !text(purpose.sourcePreview,480,true) || purpose.presentationKey && !FUNCTION_SUMMARY_COPY_KEYS.has(purpose.presentationKey)) return false;
      if (purpose.basis === "documentation" && typeof purpose.sourcePreview !== "string" || purpose.basis === "structure" && purpose.presentationKey !== "summary-purpose-structure") return false;
      for (const name of ["inputs","outcomes","steps","impacts"]) {
        const items = summary[name]; if (!Array.isArray(items) || items.length > (name === "steps" ? 5 : 8)) return false;
        for (const item of items) {
          if (!item || !text(item.id,160,false) || !text(item.sourcePreview,240,false) || item.presentationKey !== "summary-item-"+item.kind || !FUNCTION_SUMMARY_COPY_KEYS.has(item.presentationKey) || !certainty(item.certainty) || !["source","conditional","repeated","finally"].includes(item.scope) || !refs(item.blockIds,blocks,24) || !refs(item.edgeIds,edges,24) || !refs(item.evidenceTokens,tokens,8)) return false;
          if (name==="inputs"&&item.kind!=="parameter"||name==="outcomes"&&!["return","throw","exit"].includes(item.kind)||name==="impacts"&&!["call","external-call","unresolved-call","write","effect"].includes(item.kind)) return false;
          // Optional payloads may be malformed; reject nested records before property access so the legacy Guide stays readable.
          if (!Array.isArray(item.conditions) || item.conditions.length > 8 || item.conditions.some((guard) => !guard || !blocks.has(guard.blockId) || edgeById.get(guard.edgeId)?.sourceBlockId !== guard.blockId || edgeById.get(guard.edgeId)?.kind !== guard.outcome || !text(guard.sourcePreview,240,false))) return false;
          if (item.alternatives && (!Array.isArray(item.alternatives) || item.alternatives.length > 8 || item.alternatives.some((branch) => !branch || edgeById.get(branch.edgeId)?.kind !== branch.outcome || !refs(branch.blockIds,blocks,24) || !text(branch.sourcePreview,240,false)))) return false;
          if (name === "inputs" && (!text(item.name,240,false) || !text(item.typeText,240,true) || !text(item.defaultText,240,true) || typeof item.optional !== "boolean" || typeof item.rest !== "boolean")) return false;
        }
      }
      if (!Array.isArray(summary.gaps) || summary.gaps.length > 8 || summary.gaps.some((gap) => !gap || !text(gap.id,160,false) || !FUNCTION_SUMMARY_GAP_KEYS.has(gap.presentationKey) || !text(gap.sourcePreview,240,true) || !refs(gap.blockIds,blocks,24) || !refs(gap.evidenceTokens,tokens,8))) return false;
      return typeof summary.limited === "boolean" && ["inputs","outcomes","steps","impacts","gaps"].every((name) => Number.isInteger(summary.omittedCounts?.[name]) && summary.omittedCounts[name] >= 0);
    }

    /** Builds the initial reading hierarchy without acquiring the Scenario Workspace. */
    function createFunctionBehaviorSummary(logic, callbacks) {
      const tutor = logic.tutor; const summary = tutor?.behaviorSummary;
      if (!functionTutorValidBehaviorSummary(summary, tutor)) return undefined;
      const section = document.createElement("section"); section.className = "logic-behavior-summary";
      const render = () => {
        const disclosures = new Map(); let focusedKey;
        retainFunctionGuideInteraction(section, disclosures, (key) => { focusedKey = key; }); section.replaceChildren();
        const heading = document.createElement("h3"); heading.textContent = projectAnalyzerText("summary-heading");
        const state = document.createElement("p"); state.className = "logic-summary-note"; state.textContent = projectAnalyzerText("summary-" + summary.status);
        const role = document.createElement("p"); role.className = "logic-summary-purpose"; role.textContent = summary.purpose.basis === "documentation" ? summary.purpose.sourcePreview : projectAnalyzerText(summary.purpose.presentationKey,summary.purpose.presentationParams); if(summary.purpose.basis==="documentation")role.setAttribute("translate","no");
        const basis = document.createElement("p"); basis.className = "logic-summary-basis"; basis.append(document.createTextNode(projectAnalyzerText("summary-" + summary.purpose.basis) + " · "),createFunctionGuideCertainty(summary.purpose.certainty));
        if (summary.purpose.evidenceTokens[0]) basis.append(functionTutorSummarySource(summary.purpose.evidenceTokens[0],callbacks,"purpose"));
        section.append(heading,state,role,basis);
        const owners = (tutor.context?.owners || []).slice(0,2).map((owner) => owner.name); const callers = (tutor.context?.callers || []).slice(0,2).map((caller) => caller.qualifiedName);
        if (owners.length || callers.length) { const context = document.createElement("p"); context.className="logic-summary-note"; context.textContent=projectAnalyzerText("summary-context") + ": " + [...owners,...callers].join(" · "); section.append(context); }
        const facts = document.createElement("div"); facts.className="logic-summary-fact-columns";
        for (const [name,empty] of [["inputs","summary-no-inputs"],["outcomes","summary-no-outcomes"]]) {
          const region=document.createElement("section"); const title=document.createElement("h4"); const list=document.createElement("ul"); title.textContent=projectAnalyzerText("summary-"+name); list.className="logic-summary-list";
          for(const item of summary[name]) list.append(functionTutorSummaryItem(item,callbacks,name==="inputs",name));
          if(!list.children.length) { const note=document.createElement("li");note.textContent=projectAnalyzerText(empty);list.append(note); }
          region.append(title,list); functionTutorSummaryOmitted(region,summary.omittedCounts[name]); facts.append(region);
        }
        section.append(facts);
        const stages=document.createElement("section");const title=document.createElement("h4");const note=document.createElement("p");const list=document.createElement("ol");title.textContent=projectAnalyzerText("summary-stages");note.className="logic-summary-note";note.textContent=projectAnalyzerText("summary-stages-note");list.className="logic-summary-stages";
        for(const item of summary.steps) list.append(functionTutorSummaryItem(item,callbacks,false,"steps"));
        if(!list.children.length) {const empty=document.createElement("li");empty.textContent=projectAnalyzerText("summary-no-stages");list.append(empty);}
        stages.append(title,note,list);functionTutorSummaryOmitted(stages,summary.omittedCounts.steps);section.append(stages);
        for(const name of ["impacts","gaps"]) {
          const details=document.createElement("details");const label=document.createElement("summary");const list=document.createElement("ul");details.className="logic-summary-disclosure";details.dataset.guideKey="summary:"+name;label.textContent=projectAnalyzerText("summary-"+name)+" · "+summary[name].length;list.className="logic-summary-list";
          for(const item of summary[name]) {
            if(name==="impacts")list.append(functionTutorSummaryItem(item,callbacks,false,name));
            else {const gap=document.createElement("li");gap.textContent=projectAnalyzerText(item.presentationKey,item.presentationParams)+(item.sourcePreview?" · "+item.sourcePreview:"");if(item.evidenceTokens[0])gap.append(functionTutorSummarySource(item.evidenceTokens[0],callbacks,item.id));list.append(gap);}
          }
          if(!list.children.length){const empty=document.createElement("li");empty.textContent=projectAnalyzerText("summary-none");list.append(empty);}
          details.append(label,list);functionTutorSummaryOmitted(details,summary.omittedCounts[name]);section.append(details);
        }
        if(summary.limited){const note=document.createElement("p");note.className="logic-summary-note";note.textContent=projectAnalyzerText("summary-analysis-limited");section.append(note);}
        restoreFunctionGuideInteraction(section,disclosures,focusedKey);
      };
      render();section.refreshLanguage=render;return section;
    }

    /** Renders a literal source claim with its conditional/repeated boundary and evidence actions. */
    function functionTutorSummaryItem(item,callbacks,isInput,region) {
      const row=document.createElement("li");const label=document.createElement("strong");const code=document.createElement("code");row.className="logic-summary-item";label.textContent=projectAnalyzerText(item.presentationKey);code.textContent=isInput?item.name+(item.typeText?": "+item.typeText:""):item.sourcePreview;code.setAttribute("translate","no");row.append(label,code);
      if(isInput){for(const value of [item.defaultText!==undefined?projectAnalyzerText("summary-default",{value:item.defaultText}):"",item.optional?projectAnalyzerText("summary-optional"):"",item.rest?projectAnalyzerText("summary-rest"):""]){if(value){const note=document.createElement("span");note.textContent=value;row.append(note);}}}
      else {const scope=document.createElement("span");scope.className="logic-summary-note";scope.textContent=projectAnalyzerText("summary-scope-"+item.scope);row.append(scope);}
      for(const guard of item.conditions||[]){const condition=document.createElement("code");condition.textContent=guard.sourcePreview+" → "+projectAnalyzerText("logic-edge-"+guard.outcome);condition.setAttribute("translate","no");row.append(condition);}
      if(item.alternatives?.length){const alternatives=document.createElement("ul");alternatives.className="logic-summary-alternatives";for(const branch of item.alternatives){const alternative=document.createElement("li");alternative.textContent=projectAnalyzerText("logic-edge-"+branch.outcome)+(branch.sourcePreview?" · "+branch.sourcePreview:"");alternatives.append(alternative);}row.append(alternatives);}
      const actions=document.createElement("div");actions.className="logic-guide-actions";actions.append(createFunctionGuideCertainty(item.certainty));
      if(item.blockIds.length){const show=document.createElement("button");show.type="button";show.className="logic-guide-action logic-summary-graph";show.dataset.guideKey="summary-graph:"+region+":"+item.id;show.textContent=projectAnalyzerText("show-graph");show.addEventListener("click",()=>callbacks?.onShowGraph?.({preferredLens:"flow",primaryBlockId:item.blockIds[0],attentionBlockIds:item.blockIds,attentionEdgeIds:item.edgeIds}));actions.append(show);}
      if(item.evidenceTokens[0])actions.append(functionTutorSummarySource(item.evidenceTokens[0],callbacks,region+":"+item.id));row.append(actions);return row;
    }
    function functionTutorSummarySource(token,callbacks,key){const source=createFunctionGuideEvidenceButton(token,callbacks);source.className+=" logic-summary-source";source.dataset.guideKey="summary-source:"+key;return source;}
    function functionTutorSummaryOmitted(region,count){if(!count)return;const note=document.createElement("p");note.className="logic-summary-note";note.textContent=projectAnalyzerText("summary-omitted",{count});region.append(note);}
  `;
}
