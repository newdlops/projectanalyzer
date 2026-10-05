/** Scenario example facts and a selected-node reader; all graph/source mutations are explicit adapter callbacks. */
export function getFunctionNarrativeInterpretationBrowserSource(): string {
  return /* js */ `
    /** Compact model examples precede static details and remain visibly unverified. */
    function appendFunctionNarrativeExample(parent, scenario, selected, actions) {
      if (!scenario.example) return;
      const region=document.createElement("section");region.className="logic-narrative-example";
      const note=document.createElement("p");note.className="logic-summary-basis";note.textContent=projectAnalyzerText("narrative-example-basis");
      region.append(note);
      const facts=document.createElement("dl");facts.className="logic-narrative-example-values";
      for(const input of scenario.example.inputs){const name=document.createElement("dt"),value=document.createElement("dd");name.textContent=input.name;value.textContent=input.json;value.setAttribute("translate","no");facts.append(name,value);}
      if(!scenario.example.inputs.length){const empty=document.createElement("p");empty.textContent=projectAnalyzerText("narrative-no-inputs");region.append(empty);}
      const resultName=document.createElement("dt"),resultValue=document.createElement("dd");resultName.textContent=projectAnalyzerText("narrative-example-result");resultValue.textContent=scenario.example.result;resultValue.setAttribute("translate","no");facts.append(resultName,resultValue);
      const controls=document.createElement("div");controls.className="logic-guide-actions";
      for(const [key,className,handler,disabled] of [["narrative-select","logic-narrative-select",actions.select,false],["narrative-show-graph","logic-narrative-graph",actions.graph,!scenario.graph?.nodeIds.length||!actions.canShowGraph],["narrative-apply-example","logic-narrative-apply",actions.apply,!scenario.example.inputs.length||!actions.canApply]]){
        const button=document.createElement("button");button.type="button";button.className="logic-guide-action "+className;button.textContent=projectAnalyzerText(key);button.disabled=disabled;
        button.id=actions.id+"-"+className;
        if(className==="logic-narrative-select")button.setAttribute("aria-pressed",selected?"true":"false");
        button.addEventListener("click",()=>{if(!button.disabled)handler?.();});controls.append(button);
      }
      region.append(facts,controls);parent.append(region);
    }

    /** Reads one graph node, including repeated visits; out-of-page descriptions are cache-only Host queries. */
    function createFunctionNarrativeNodeReader(callbacks,owner) {
      const element=document.createElement("section"),heading=document.createElement("h4"),label=document.createElement("label"),select=document.createElement("select"),status=document.createElement("p"),body=document.createElement("div");
      element.className="logic-narrative-node-reader";select.className="logic-narrative-node-select";select.id=owner.id+"-node";label.htmlFor=select.id;
      status.className="logic-summary-note";status.setAttribute("role","status");status.setAttribute("aria-live","polite");body.className="logic-narrative-node-body";
      element.append(heading,label,select,status,body);
      const cache=new Map();let disposed=false;let optionSignature;let lastRead;
      select.addEventListener("change",()=>{const scenario=owner.scenario();if(scenario?.graph)callbacks?.onShowGraph?.({preferredLens:"flow",primaryBlockId:select.value,attentionBlockIds:scenario.graph.nodeIds,attentionEdgeIds:scenario.graph.edgeIds});refresh();});
      const unsubscribe=callbacks?.subscribeNarrativeNode?.(()=>refresh());
      function extract(payload,nodeId) {
        for(let scenarioIndex=0;scenarioIndex<payload.narrative.scenarios.length;scenarioIndex++){
          const scenario=payload.narrative.scenarios[scenarioIndex];const details=[];
          for(let nodeIndex=0;nodeIndex<(scenario.nodeDetails?.length||0);nodeIndex++)if(scenario.nodeDetails[nodeIndex].nodeId===nodeId)details.push({detail:scenario.nodeDetails[nodeIndex],nodeIndex});
          if(details.length)return {details,example:scenario.example,title:scenario.title,language:payload.language,pageIndex:payload.page?.index,scenarioIndex,ordinal:(payload.page?.offset||0)+scenarioIndex+1};
        }
      }
      function remember(payload,nodeId){const value=extract(payload,nodeId);if(value){cache.set(payload.language+":"+nodeId,value);while(cache.size>8)cache.delete(cache.keys().next().value);}refresh(false);}
      function refresh(allowQuery=true) {
        if(disposed)return;
        const payload=owner.result(),scenario=owner.scenario();element.hidden=!scenario?.example;
        if(element.hidden)return;
        const nodeId=callbacks?.readNarrativeNode?.()||scenario.graph?.nodeIds[0];
        const cached=cache.get(payload.language+":"+nodeId);
        // Comprehension publishes playback/focus updates too. An unchanged node must not rebuild its reading DOM.
        if(lastRead?.payload===payload&&lastRead.index===owner.index()&&lastRead.nodeId===nodeId&&lastRead.locale===state.uiLanguage&&lastRead.cached===cached)return;
        lastRead={payload,index:owner.index(),nodeId,locale:state.uiLanguage,cached};
        heading.textContent=projectAnalyzerText("narrative-node-heading");label.textContent=projectAnalyzerText("narrative-node-label");
        const unique=new Map((scenario.nodeDetails||[]).map((detail)=>[detail.nodeId,detail]));
        const signature=payload.language+":"+state.uiLanguage+":"+JSON.stringify([...unique].map(([id,detail])=>[id,detail.source.startLine,detail.text.slice(0,70)]))+":"+(nodeId&&!unique.has(nodeId)?nodeId:"");
        if(signature!==optionSignature){optionSignature=signature;select.replaceChildren();
          for(const [id,detail]of unique){const option=document.createElement("option");option.value=id;option.textContent="L"+detail.source.startLine+" · "+detail.text.slice(0,70);select.append(option);}
          if(nodeId&&!unique.has(nodeId)){const option=document.createElement("option");option.value=nodeId;option.textContent=projectAnalyzerText("narrative-node-outside");select.append(option);}}
        select.value=nodeId||"";select.disabled=!unique.size;
        const reached=scenario.graph?.nodeIds.includes(nodeId);
        const selectedDetails=(scenario.nodeDetails||[]).map((detail,nodeIndex)=>({detail,nodeIndex})).filter((item)=>item.detail.nodeId===nodeId);
        const data=selectedDetails.length?{details:selectedDetails,example:scenario.example,language:payload.language,pageIndex:payload.page?.index,scenarioIndex:owner.index(),ordinal:(payload.page?.offset||0)+owner.index()+1}
          :cached||extract(payload,nodeId);
        status.textContent=projectAnalyzerText(!reached?"narrative-node-skipped":data?"narrative-example-basis":payload.coverage?.complete?"narrative-node-unavailable":"narrative-node-pending");body.replaceChildren();
        if(!data){if(nodeId&&allowQuery)owner.loadNode(nodeId);return;}
        if(!reached){const examples=document.createElement("p");examples.className="logic-summary-note";examples.textContent=projectAnalyzerText("narrative-node-other-example",{scenario:data.ordinal,inputs:data.example?.inputs.map((input)=>input.name+" = "+input.json).join(" · ")||projectAnalyzerText("narrative-no-inputs")});body.append(examples);}
        for(let visit=0;visit<data.details.length;visit++){
          const {detail,nodeIndex}=data.details[visit];const section=document.createElement("section");section.className="logic-narrative-node-detail";
          if(data.details.length>1){const visitLabel=document.createElement("strong");visitLabel.textContent=projectAnalyzerText("narrative-node-visit",{visit:visit+1});section.append(visitLabel);}
          for(const [key,text]of [[undefined,detail.text],["narrative-reason",detail.reason],["narrative-effect",detail.effect]])if(text){const paragraph=document.createElement("p");if(key){const term=document.createElement("strong");term.textContent=projectAnalyzerText(key)+": ";paragraph.append(term);}paragraph.append(document.createTextNode(text));section.append(paragraph);}
          if(detail.values?.length){const table=document.createElement("table");table.className="logic-narrative-node-values";const caption=document.createElement("caption");caption.textContent=projectAnalyzerText("narrative-node-values");table.append(caption);const head=document.createElement("thead"),row=document.createElement("tr");for(const key of ["name","narrative-before","narrative-after"]){const cell=document.createElement("th");cell.scope="col";cell.textContent=projectAnalyzerText(key);row.append(cell);}head.append(row);table.append(head);const tbody=document.createElement("tbody");for(const value of detail.values){const item=document.createElement("tr");for(const [index,text]of [value.name,value.before,value.after].entries()){const cell=document.createElement(index===0?"th":"td");if(index===0)cell.scope="row";cell.textContent=text;cell.setAttribute("translate","no");item.append(cell);}tbody.append(item);}table.append(tbody);section.append(table);}
          const source=document.createElement("button");source.type="button";source.className="logic-guide-action logic-narrative-node-source";source.textContent=projectAnalyzerText("narrative-node-source",{line:detail.source.startLine});source.addEventListener("click",()=>owner.openNodeSource(data,nodeIndex));section.append(source);body.append(section);
        }
      }
      return {element,refresh,remember,dispose(){disposed=true;unsubscribe?.();cache.clear();}};
    }
  `;
}
