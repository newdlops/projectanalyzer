/** Explicit, retained call-reading UI; static facts stay separate and cached pages never load a model. */
import { isFunctionCallNarrativeChunk, isFunctionCallNarrativeLanguage } from "../../shared/functionCallNarratives";
export function getFunctionCallReadingBrowserSource(): string {
  return /* js */ String.raw`
    ${isFunctionCallNarrativeChunk.toString()}
    ${isFunctionCallNarrativeLanguage.toString()}
    function createFunctionCallReading(options) {
      const { el, button, t } = options;
      const section = el("section", "calls-reading"), heading = el("h3"), actions = el("div", "calls-actions");
      const status = el("p", "calls-reading-status"), content = el("div", "calls-reading-content");
      status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
      let view, baseKey, result, phase = "idle", pending, pagePending, nextId = 0, selected = 0;
      const saved = new Map(), pages = new Map();
      const start = button("", "reading-start", () => request());
      start.className="calls-reading-request";
      const cancel = button("", "reading-cancel", () => { stop(); start.focus(); });
      cancel.className="calls-reading-cancel";
      const refresh = button("", "reading-refresh", () => options.reload(view?.sourceToken));
      const help = el("p", "calls-reading-help");
      const previous = button("", "reading-previous", () => request(result.page.index - 1));
      const next = button("", "reading-next", () => request(result.page.index + 1));
      const pager = el("div", "calls-reading-pager"), pageLabel = el("span"); pager.append(pageLabel, previous, next);
      actions.append(start, cancel, refresh); section.append(heading, actions, help, status, content, pager);
      const remember = (map, key, value) => { map.delete(key); map.set(key, value); while (map.size > 8) map.delete(map.keys().next().value); };
      const keyFor = value => JSON.stringify([value.graphVersion, value.sourceToken, value.contextId, value.scope, value.connectionId,
        [...(value.choices || [])].sort((a,b)=>a.key.localeCompare(b.key))]);
      function stop() { if (pending) options.postMessage({ type:"functionCalls/cancelExplanation",payload:pending.request }); pending=undefined;pagePending=undefined;phase="cancelled";render(); }
      /** Validate bounded prose and metadata against currently displayed static relationships. */
      function valid(payload) {
        const data=payload.narrative,coverage=payload.coverage,page=payload.page;
        if(!data||!coverage||!page||!["ko","en"].includes(payload.language)||typeof payload.modelName!=="string"||payload.modelName.length>100||typeof payload.cacheHit!=="boolean")return false;
        const int=value=>Number.isSafeInteger(value)&&value>=0;
        if(!int(coverage.completed)||!int(coverage.total)||coverage.completed>coverage.total||coverage.total>256||typeof coverage.complete!=="boolean"
          ||typeof coverage.sourceLimited!=="boolean"||coverage.complete&&coverage.completed!==coverage.total||!int(page.index)||!int(page.count)||page.count<1
          ||page.index>=page.count||!int(page.offset)||page.offset!==page.index*2||page.offset+data.calls?.length>coverage.completed)return false;
        if(!Array.isArray(data.calls)||data.calls.some(call=>{
          const edge=options.connection(call.connectionId);
          return !edge||edge.from!==view.sourceToken||call.confidence!==edge.confidence||call.deferred!==Boolean(edge.deferred||edge.relation!=="call")
            ||!int(call.occurrence)||call.occurrence<1||typeof call.expression!=="string"||call.expression.length>1200||typeof call.callee!=="string"||call.callee.length>240
            ||call.callerEvidence!==edge.evidenceToken||call.calleeEvidence!==undefined&&!/^code-evidence:[0-9a-f]{64}$/.test(call.calleeEvidence)||call.calleeSourceToken!==options.node(edge.to)?.sourceToken;
        }))return false;
        const normalized={...data,calls:data.calls.map(({callId,role,inputs,output,effects,reason})=>({callId,role,inputs,output,effects,reason}))};
        return isFunctionCallNarrativeChunk(normalized,undefined,coverage.complete?true:undefined)&&isFunctionCallNarrativeLanguage(normalized,payload.language);
      }
      function accept(payload) {
        const focusedKey=document.activeElement?.dataset?.callKey;
        const owner=[pending,pagePending].find(item=>item?.request.requestId===payload?.requestId);
        if(!owner||!view||keyFor(payload)!==baseKey||payload.graphVersion!==options.graphVersion())return;
        const statuses=["ready","progress","stale","unavailable","download-failed","cancelled","denied","timeout","invalid-response","language-mismatch","context-too-large","failed"];
        if(!statuses.includes(payload.status))return;
        const progress=payload.status==="progress",paging=owner===pagePending;
        if(!progress){if(paging)pagePending=undefined;else pending=undefined;}
        phase=progress?"pending":paging&&pending?"pending":payload.status;
        if(payload.narrative){
          if(!valid(payload)){phase="invalid-response";stop();phase="invalid-response";render();return;}
          remember(pages,baseKey+":"+payload.language+":"+payload.page.index,payload);
          if(!result||result.language!==payload.language||paging||result.page.index===payload.page.index)result=payload;
          else result={...result,status:payload.status,coverage:payload.coverage,page:{...result.page,count:payload.page.count},modelName:payload.modelName};
          remember(saved,baseKey+":"+payload.language,result);
        }else if(payload.status==="ready"||progress){phase="invalid-response";}
        render();
        if(!progress&&focusedKey==="reading-cancel"){
          if(!start.hidden&&!start.disabled)start.focus();else{status.tabIndex=-1;status.focus();}
        }
      }
      /** Only this button's non-page intent permits inference. Other controls read saved prose. */
      function request(pageIndex) {
        if(!view?.contextId||options.graphVersion()!==view.graphVersion)return;
        const paging=pageIndex!==undefined;if(paging?pagePending:pending||start.disabled)return;
        const request={...view,requestId:++nextId,...(paging?{pageIndex,pageLanguage:result.language}:{})};
        const moveFocus=document.activeElement===start;
        if(paging){const cached=pages.get(baseKey+":"+result.language+":"+pageIndex);if(cached){result=cached;selected=0;render();return;}pagePending={request};}
        else pending={request};
        phase=paging?"page-loading":"pending";render();if(moveFocus)cancel.focus();
        options.postMessage({type:"functionCalls/explain",payload:request});
      }
      function render() {
        const available=Boolean(view?.contextId),current=result?.language===options.language(),complete=current&&result?.coverage.complete;
        heading.textContent=t("calls-reading-title");help.textContent=t("calls-reading-help");help.hidden=Boolean(result);
        start.textContent=t(complete?"calls-reading-complete":current?"calls-reading-continue":view?.scope==="scenario"?"calls-reading-scenario":view?.scope==="call"?"calls-reading-call":"calls-reading-overview");
        start.disabled=!available||Boolean(pending)||Boolean(pagePending)||Boolean(complete);start.hidden=Boolean(pending)||phase==="stale";
        cancel.textContent=t("narrative-cancel");cancel.hidden=!pending;
        refresh.textContent=t("calls-reading-refresh");refresh.hidden=phase!=="stale";
        const progress=result?.coverage;
        status.textContent=pending?progress?progress.completed===progress.total&&!progress.complete?t("calls-reading-summarizing")
          :t("calls-reading-progress",{completed:progress.completed,total:progress.total}):t("calls-reading-preparing")
          :phase==="idle"?t(available?"calls-reading-idle":"calls-reading-unavailable")
          :phase==="ready"?t("calls-reading-ready",{completed:progress?.completed||0,total:progress?.total||0})
          :phase==="page-loading"?t("calls-reading-page-loading"):t("narrative-"+phase);
        content.replaceChildren();pager.hidden=!result;
        if(!result)return;
        content.append(el("p","calls-reading-inference",t("calls-reading-inference",{model:result.modelName,language:t("narrative-language-"+result.language)})));
        if(result.coverage.sourceLimited)content.append(el("p","calls-reading-help",t("calls-reading-limited")));
        if(result.narrative.summary)content.append(el("p","calls-reading-summary",result.narrative.summary));
        if(result.narrative.flow)content.append(el("p","calls-reading-flow",result.narrative.flow));
        const calls=result.narrative.calls;
        if(calls.length){
          selected=Math.min(selected,calls.length-1);
          const label=el("label","calls-reading-selector",t("calls-reading-select")),select=el("select");select.dataset.callKey="reading-select";select.className="calls-reading-select";
          calls.forEach((call,index)=>{const option=el("option","",(result.page.offset+index+1)+". "+call.expression+(call.occurrence>1?" · "+t("calls-order-visit",{count:call.occurrence}):""));option.value=String(index);select.append(option);});
          select.value=String(selected);select.addEventListener("change",()=>{selected=Number(select.value);render();section.querySelector("select")?.focus();});label.append(select);content.append(label);
          const call=calls[selected];content.append(el("pre","calls-reading-code",call.expression),el("p","calls-reading-help",t("calls-reading-confidence-"+call.confidence)+(call.deferred?" · "+t("calls-deferred"):"")));
          const facts=el("dl","calls-reading-facts");for(const key of ["role","inputs","output","effects","reason"]){facts.append(el("dt","",t("calls-reading-"+key)),el("dd","",call[key]));}content.append(facts);
          const sources=el("div","calls-actions");if(call.callerEvidence)sources.append(button(t("calls-site"),"reading-caller",()=>options.openEvidence(call.callerEvidence)));
          if(call.calleeEvidence)sources.append(button(t("calls-reading-callee"),"reading-callee",()=>options.openEvidence(call.calleeEvidence)));
          if(call.calleeSourceToken)sources.append(button(t("calls-reading-callee-flow"),"reading-callee-flow",()=>options.openFunction(options.node(options.connection(call.connectionId).to))));content.append(sources);
        }
        if(result.narrative.limitations.length){const list=el("ul","calls-reading-limitations");result.narrative.limitations.forEach(value=>list.append(el("li","",value)));content.append(list);}
        pageLabel.textContent=t("calls-reading-page",{page:result.page.index+1,count:result.page.count});
        previous.textContent=t("calls-reading-previous");next.textContent=t("calls-reading-next");
        previous.disabled=Boolean(pagePending)||result.page.index<=0;next.disabled=Boolean(pagePending)||result.page.index>=result.page.count-1;
      }
      return { accept,cancel(){if(pending)stop();},element:section,view(value){
        const nextKey=keyFor(value);if(nextKey!==baseKey){if(pending)stop();pagePending=undefined;baseKey=nextKey;view=value;result=saved.get(baseKey+":"+options.language());phase=result?"ready":"idle";selected=0;}
        else{view=value;result=saved.get(baseKey+":"+options.language())||result;}
        render();return section;
      },reset(){if(pending)stop();view=undefined;baseKey=undefined;result=undefined;pending=undefined;pagePending=undefined;saved.clear();pages.clear();phase="idle";}};
    }
  `;
}
