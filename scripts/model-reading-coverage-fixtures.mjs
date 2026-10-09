/** Independent synthetic shapes/labels for missing source-control coverage; never imported by runtime inference. */
export const coverageKinds = ['arithmetic','negative-guard','writes','catch-cleanup','combined','decrement-loop','missing','partial'];

/** Render valid complete source or explicitly missing/truncated source with names/constants disjoint from the heldout corpus. */
export function coverageSpec(kind, language, variant) {
  if (!coverageKinds.includes(kind) || !['typescript','kotlin'].includes(language) || !Number.isInteger(variant) || variant<0 || variant>4) throw new TypeError('Unknown bounded coverage fixture');
  const kt=language==='kotlin', semi=kt?'':';';
  const parent=['relayScalar','routeNumber','passDatum','carryOperand','deliverScalar'][variant];
  const callee=['shapeNum','tuneNum','changeN','adaptN','alterN'][variant];
  const arg=['sentNum','inletN','providedN','callerN','arrivingN'][variant];
  const parameter=['rawNum','sourceN','inputN','givenN','numberN'][variant];
  const local=['adjusted','working','remaining','running','changed'][variant];
  const side=['probeNum','scanNum','reviewN','checkN','examineN'][variant];
  const magnitude=[13,19,23,29,37][variant], negative=[-5,-11,-17,-23,-31][variant];
  const early=[31,37,41,43,47][variant], alternative=[-19,-29,-37,-41,-47][variant];
  const multiplier=[6,9,12,15,18][variant], decrement=[5,7,11,13,17][variant];
  const comparison=['<=','>=','<','>','<='][variant];
  const predicate=`${parameter} ${comparison} ${negative}`, arithmetic=`${parameter} - ${magnitude}`;
  const calculation=`${parameter} * ${multiplier}`, loopPredicate=`${local} > ${magnitude}`;
  const mutation=`${local} -= ${decrement}`, cleanup=`${side}(${parameter})`;
  const catchText=`catch (${kt?'error: Exception':'error'}) { return ${alternative}${semi} }`;
  let body;
  if(kind==='arithmetic')body=`return ${arithmetic}${semi}`;
  if(kind==='negative-guard')body=`if (${predicate}) { return ${early}${semi} }\nreturn ${calculation}${semi}`;
  if(kind==='writes')body=`${kt?'var':'let'} ${local} = ${calculation}; ${mutation}; return ${local}${semi}`;
  if(kind==='catch-cleanup')body=`try { return ${arithmetic}${semi} } ${catchText} finally { ${cleanup}${semi} }`;
  if(kind==='combined')body=`try { if (${predicate}) { return ${early}${semi} }\nreturn ${calculation}${semi} } ${catchText} finally { ${cleanup}${semi} }`;
  if(kind==='decrement-loop')body=`${kt?'var':'let'} ${local} = ${parameter}; while (${loopPredicate}) { ${mutation}${semi} }\nreturn ${local}${semi}`;
  if(kind==='partial')body=`if (${predicate}) { return ${early}${semi} }`;
  const caller=kt?`fun ${parent}(${arg}: Int): Int { return ${callee}(${arg}) }`:`function ${parent}(${arg}: number): number { return ${callee}(${arg}); }`;
  const helper=kind==='missing'?undefined:kt?`fun ${callee}(${parameter}: Int): Int { ${body}${kind==='partial'?'':' }'}`
    :`function ${callee}(${parameter}: number): number { ${body}${kind==='partial'?'':' }'}`;
  return {kind,language,parent,callee,arg,parameter,local,side,predicate,arithmetic,calculation,loopPredicate,mutation,cleanup,
    early:String(early),alternative:String(alternative),caller,helper};
}

/** Curated full-field supervision names every source alternative and uncertainty; no generated heldout answer is used. */
export function coverageReading(spec, locale, target) {
  if(!['ko','en'].includes(locale))throw new TypeError('Unknown coverage language');
  if(!coverageKinds.includes(spec?.kind)||target?.expression!==`${spec.callee}(${spec.arg})`
    || target.sourceLimited!==['missing','partial'].includes(spec.kind)
    || !(spec.kind==='missing'?target.confidence==='unresolved':['exact','inferred'].includes(target.confidence))) {
    throw new TypeError('Coverage reading requires its owned fixture target');
  }
  const ko=locale==='ko', candidate=target.confidence==='inferred';
  const q=value=>'`'+value+'`', prefix=candidate?(ko?'후보 본문에서는 ':'In the candidate body, '):'';
  const {kind,parent,callee,arg,parameter,local,predicate,arithmetic,calculation,loopPredicate,mutation,cleanup,early,alternative}=spec;
  let role,output,effects,flow;
  if(kind==='arithmetic') {
    role=ko?`${q(parameter)}로 ${q(arithmetic)}를 계산해 반환합니다.`:`Calculate and return ${q(arithmetic)} from ${q(parameter)}.`;
    output=ko?`${q(arithmetic)}를 반환합니다. 정상 복귀하면 부모가 그 결과를 반환합니다.`:`Return ${q(arithmetic)}; on normal completion the parent returns this result.`;
    effects=ko?'제공된 본문에는 명시적인 변수 쓰기나 내부 호출이 없습니다.':'No explicit writes or inner calls appear in the supplied body.';
  } else if(kind==='negative-guard') {
    role=ko?`${q(predicate)}이면 ${q(early)}, 아니면 ${q(calculation)}를 반환합니다.`:`Return ${q(early)} if ${q(predicate)}, otherwise ${q(calculation)}.`;
    output=ko?`조건 ${q(predicate)}이면 ${q(early)}, 아니면 ${q(calculation)}를 반환합니다. 정상 복귀 시 부모가 결과를 반환합니다.`:`Return ${q(early)} if ${q(predicate)}, otherwise ${q(calculation)}; the parent returns the result on normal completion.`;
    effects=ko?'제공된 본문에는 조건 분기와 반환이 있으며 명시적 쓰기나 내부 호출은 없습니다.':'The supplied body branches and returns, with no explicit writes or inner calls.';
  } else if(kind==='writes') {
    role=ko?`지역 ${q(local)}를 ${q(calculation)}로 시작해 ${q(mutation)} 후 반환합니다.`:`Initialize local ${q(local)} from ${q(calculation)}, apply ${q(mutation)}, then return it.`;
    output=ko?`두 지역 쓰기 뒤 ${q(local)}를 반환합니다. 정상 복귀 시 부모가 결과를 반환합니다.`:`Return ${q(local)} after the two local writes; the parent returns the result on normal completion.`;
    effects=ko?`대상 본문에서 지역 ${q(local+' = '+calculation)}를 만들고 ${q(mutation)}를 수행합니다. 내부 호출은 없습니다.`:`In the callee, initialize local ${q(local+' = '+calculation)} and apply ${q(mutation)}. No inner call appears.`;
  } else if(kind==='catch-cleanup'||kind==='combined') {
    const choices=kind==='combined'?(ko?`try에서 ${q(predicate)}이면 ${q(early)}, 아니면 ${q(calculation)}를 선택합니다.`:`In try, select ${q(early)} if ${q(predicate)}, otherwise ${q(calculation)}.`)
      :(ko?`try에서 ${q(arithmetic)}를 선택합니다.`:`In try, select ${q(arithmetic)}.`);
    role=kind==='combined'?(ko?`try에서 ${q(predicate)}이면 ${q(early)}, 아니면 ${q(calculation)}를, catch에서는 ${q(alternative)}를 선택합니다.`
      :`In try, select ${q(early)} if ${q(predicate)}, else ${q(calculation)}; catch selects ${q(alternative)}.`)
      :(ko?`try의 ${q(arithmetic)} 또는 catch의 ${q(alternative)}를 선택합니다.`:`Select ${q(arithmetic)} in try or ${q(alternative)} in catch.`);
    output=ko?choices+` catch에 도달하면 ${q(alternative)}를 선택합니다. finally 정상 완료 뒤 정상 복귀하면 부모가 결과를 반환합니다.`
      :`${kind==='combined'?`Try: ${q(early)} if ${q(predicate)}, else ${q(calculation)}`:`Try: ${q(arithmetic)}`}; catch: ${q(alternative)}. If finally and callee return normally, the parent returns it.`;
    effects=ko?`반환 완료 전에 finally에서 ${q(cleanup)}를 호출합니다. 내부 동작·효과·완료는 미확인입니다.`:`Before return completion, finally calls ${q(cleanup)}. Its behavior, effects and completion are unknown.`;
    flow=choices+(ko?` catch에 도달하면 ${q(alternative)}를 선택합니다. ${effects} finally가 정상 완료하고 대상이 정상 복귀하면 부모가 결과를 반환합니다.`
      :` If catch is reached, select ${q(alternative)}. ${effects} If finally completes normally and the callee returns normally, the parent returns that result.`);
  } else if(kind==='decrement-loop') {
    role=ko?`지역 ${q(local)}를 ${q(parameter)}로 시작해 ${q(loopPredicate)}인 동안 ${q(mutation)}를 반복합니다.`
      :`Initialize local ${q(local)} from ${q(parameter)} and repeat ${q(mutation)} while ${q(loopPredicate)}.`;
    output=ko?`반복이 종료된 경로에서 ${q(local)}를 반환합니다. 대상이 정상 복귀하면 부모가 그 결과를 반환합니다.`:`If the loop exits, return ${q(local)}; the parent returns that result on normal callee completion.`;
    effects=ko?`대상 본문에서 지역 ${q(local+' = '+parameter)}를 만들고 ${q(loopPredicate)}인 동안 ${q(mutation)}를 수행합니다. 내부 호출은 없습니다.`
      :`In the callee, initialize local ${q(local+' = '+parameter)} and apply ${q(mutation)} while ${q(loopPredicate)}. No inner call appears.`;
    flow=effects+' '+output;
  } else if(kind==='missing') {
    role=ko?'대상 구현이 제공되지 않아 수행 작업은 미확인입니다.':'The callee implementation is not supplied, so its work is unknown.';
    output=ko?'대상 반환값은 미확인입니다. 정상 복귀하면 부모가 그 결과를 반환합니다.':'The callee result is unknown; if it returns normally, the parent returns it.';
    effects=ko?'대상 구현이 없어 내부 쓰기·호출·효과·완료는 미확인입니다.':'The missing implementation leaves inner writes, calls, effects and completion unknown.';
  } else {
    role=ko?'보인 부분은 조건부 반환이며 잘린 나머지 작업은 미확인입니다.':'The visible part conditionally returns; the truncated remaining work is unknown.';
    output=ko?`보인 ${q(predicate)} 분기는 ${q(early)}를 반환합니다. 잘린 나머지 결과는 미확인입니다. 정상 복귀하면 부모가 결과를 반환합니다.`
      :`The visible ${q(predicate)} branch returns ${q(early)}. Other results are unknown. On normal completion the parent returns the call result.`;
    effects=ko?'보인 부분에는 쓰기나 내부 호출이 없지만 잘린 나머지 효과·완료는 미확인입니다.':'The visible part has no writes or inner calls; truncated effects and completion are unknown.';
  }
  // Source output and effects remain full fields. The live schema may own their
  // lexical text, but every variable field keeps the complete curated reading.
  const summary=ko?`부모 ${q(parent)}는 ${q(arg)}를 ${candidate?'후보 ':''}${q(callee)}에 전달하고 정상 복귀 시 결과를 반환합니다.`
    :`Parent ${q(parent)} passes ${q(arg)} to ${candidate?'candidate ':''}${q(callee)} and returns its result on normal completion.`;
  const start=ko?`부모는 ${q(target.expression)}로 입력을 전달합니다. `:`The parent passes input through ${q(target.expression)}. `;
  const reading={summary,flow:start+prefix+(flow??output+' '+effects),role:prefix+role,output:prefix+output,effects:prefix+effects,
    inputs:kind==='missing'?(ko?`인수 ${q(arg)}를 전달하며 매개변수 선언은 미확인입니다.`:`Pass ${q(arg)}; parameter declarations are unknown.`)
      :(ko?`인수 ${q(arg)}를 선언된 매개변수 ${q(parameter)}에 전달합니다.`:`Pass argument ${q(arg)} to declared parameter ${q(parameter)}.`)};
  if(ko)for(const field of Object.keys(reading))if(!/^[가-힣]/u.test(reading[field]))reading[field]='소스에서는 '+reading[field];
  return reading;
}
