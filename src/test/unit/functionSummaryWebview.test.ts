/** Functional Summary DOM checks; real rendered browser QA remains a separate integration requirement. */
import assert from "node:assert/strict";
import test from "node:test";
import { getBrowserLocalizationSource } from "../../localization/browserCatalog";
import { getFunctionTutorBrowserSource } from "../../webview/codeFlow/tutor";
import { getFunctionLogicScenarioWorkspaceBrowserSource } from "../../webview/codeFlow/scenarioWorkspace";
import { installSidebarWebviewRuntime } from "./helpers/sidebarWebviewRuntime";
import { installNativeDisclosureTasks } from "./helpers/nativeDisclosureRuntime";

test("static Summary renders source text and graph/source actions without activating scenarios", () => {
  const runtime = installSidebarWebviewRuntime();
  try {
    const fixture = createPanel(); document.getElementById("summary-root")!.append(fixture.panel.section); fixture.panel.setActive(true);
    assert.equal(runtime.countRenderedByClass("summary-root", "logic-behavior-summary"), 1);
    assert.ok(runtime.getRenderedText("summary-root").includes("<img src=x onerror=run()>"), "source documentation remains literal text");
    assert.equal(fixture.acquisitions(), 0);
    runtime.setRenderedOpenByClassNth("summary-root", "logic-guide-analysis", 0, true);
    const keys = Array.from({ length: runtime.countRenderedByClass("summary-root", "logic-summary-graph") }, (_, index) => (document.getElementById(runtime.getRenderedIdentityByClassNth("summary-root", "logic-summary-graph", index)) as HTMLElement).dataset.guideKey);
    assert.equal(new Set(keys).size, keys.length, "repeated source facts retain distinct focus positions in each region");
    runtime.clickRenderedByClassNth("summary-root", "logic-summary-graph", 0);
    assert.equal(fixture.graphs()[0].primaryBlockId, "b:return");
    runtime.clickRenderedByClassNth("summary-root", "logic-summary-source", 0);
    assert.deepEqual(fixture.sources(), ["code-evidence:summary"]);
    assert.equal(fixture.acquisitions(), 0);
    fixture.panel.dispose();
  } finally { runtime.restore(); }
});

test("representative Summary uses shared rows, expands 3 to 5 and preserves shared path selection across locale refresh", () => {
  const runtime = installSidebarWebviewRuntime();
  try {
    const tasks = installNativeDisclosureTasks(); const fixture = createPanel(); document.getElementById("summary-root")!.append(fixture.panel.section); fixture.panel.setActive(true);
    runtime.setRenderedOpenByClassNth("summary-root", "logic-guide-analysis", 0, true);
    const disclosure = document.getElementById(runtime.getRenderedIdentityByClassNth("summary-root", "logic-guide-scenarios", 0)) as HTMLDetailsElement;
    disclosure.open = true; tasks.flush();
    assert.equal(runtime.countRenderedByClass("summary-root", "logic-summary-scenario-select"), 3);
    assert.equal(runtime.countRenderedByClassWithinClass("summary-root", "logic-guide-scenario-table", "logic-guide-scenario-select"), 6, "every shared row remains available in the detailed table");
    runtime.clickRenderedByClassNth("summary-root", "logic-summary-show-more", 0);
    assert.equal(runtime.countRenderedByClass("summary-root", "logic-summary-scenario-select"), 5);
    runtime.focusRenderedByClassNth("summary-root", "logic-summary-scenario-select", 1);
    runtime.dispatchRenderedEventByClassNth("summary-root", "logic-summary-scenario-select", 1, "keydown", { key: "ArrowDown", preventDefault() {} });
    const selected = fixture.selection(); assert.ok(selected.seedId); assert.equal(fixture.previews().at(-1)?.terminal.kind, "return");
    const focusedKey = runtime.getFocusedRenderedAttribute("data-guide-key");
    assert.ok(focusedKey?.startsWith("summary-path:"));
    document.documentElement.lang = "ko"; fixture.panel.refreshLanguage();
    assert.deepEqual(fixture.selection(), selected); assert.equal(runtime.getFocusedRenderedAttribute("data-guide-key"), focusedKey);
    assert.equal(runtime.countRenderedByClass("summary-root", "logic-summary-scenario-select"), 5);
    assert.equal(disclosure.open, true); assert.equal(tasks.flush(), 0); assert.equal(fixture.acquisitions(), 1);
    fixture.panel.dispose(); assert.equal(fixture.releases(), 1);
  } finally { runtime.restore(); }
});

test("Summary rejects dangling snapshot references and retains the legacy overview", () => {
  const runtime = installSidebarWebviewRuntime();
  try {
    const fixture = createPanel(true); document.getElementById("summary-root")!.append(fixture.panel.section);
    assert.equal(runtime.countRenderedByClass("summary-root", "logic-behavior-summary"), 0);
    assert.equal(runtime.countRenderedByClass("summary-root", "logic-guide-overview"), 1);
    fixture.panel.dispose();
  } finally { runtime.restore(); }
});

test("null nested Summary records fail closed and preserve the legacy overview", () => {
  const runtime = installSidebarWebviewRuntime();
  try {
    for (const invalidNested of ["conditions", "alternatives", "gaps"] as const) {
      const fixture = createPanel(false, { invalidNested });
      document.getElementById("summary-root")!.replaceChildren(fixture.panel.section);
      assert.equal(runtime.countRenderedByClass("summary-root", "logic-behavior-summary"), 0, invalidNested);
      assert.equal(runtime.countRenderedByClass("summary-root", "logic-guide-overview"), 1, invalidNested);
      fixture.panel.dispose();
    }
  } finally { runtime.restore(); }
});

test("runtime optional Summary validation checks semantic shape and bounds while legacy and empty payloads remain readable", () => {
  const runtime = installSidebarWebviewRuntime();
  try {
    const fixture = createPanel(); const payload = JSON.parse(JSON.stringify(fixture.summary()));
    assert.equal(fixture.valid(payload), true);
    const wrongKind = JSON.parse(JSON.stringify(payload)); wrongKind.outcomes[0].kind = "business-success";
    assert.equal(fixture.valid(wrongKind), false);
    const excessive = JSON.parse(JSON.stringify(payload)); excessive.steps = Array.from({ length: 6 }, () => excessive.outcomes[0]);
    assert.equal(fixture.valid(excessive), false);
    const large = JSON.parse(JSON.stringify(payload)); large.purpose.sourcePreview = "x".repeat(481);
    assert.equal(fixture.valid(large), false);
    const unknownToken = JSON.parse(JSON.stringify(payload)); unknownToken.outcomes[0].evidenceTokens = ["code-evidence:foreign"];
    assert.equal(fixture.valid(unknownToken), false);
    fixture.panel.dispose();
    const legacy = createPanel(false, { legacy: true }); document.getElementById("summary-root")!.append(legacy.panel.section);
    assert.equal(runtime.countRenderedByClass("summary-root", "logic-guide-overview"), 1); legacy.panel.dispose();
    document.getElementById("summary-root")!.replaceChildren();
    const empty = createPanel(false, { empty: true }); document.getElementById("summary-root")!.append(empty.panel.section);
    assert.ok(runtime.getRenderedText("summary-root").includes("No supported current-scope behavior is available. Open the source to continue.")); empty.panel.dispose();
  } finally { runtime.restore(); }
});

test("representatives cache completed semantics by revision and retain different symbolic terminals", () => {
  const runtime = installSidebarWebviewRuntime();
  try {
    const fixture = createPanel(); const rows = fixture.rows(); const first = fixture.project(rows, 1);
    assert.equal(fixture.project(rows.slice(), 1), first, "selection and locale reads reuse the semantic projection");
    const extra = { seed: { ...rows[0].seed, id: "symbolic-throw" }, pathIndex: 0, path: { ...rows[0].path, blockIds: ["b:entry", "b:throw"], edgeIds: ["e:throw"], symbolic: true, terminal: { kind: "throw", blockId: "b:throw" } } };
    const second = fixture.project([...rows, extra], 2);
    assert.notEqual(second, first); assert.ok(second.items.some((item) => item.kind === "throw" && item.basis === "symbolic"));
    const repeated = rows.map((row) => ({ ...row, path: { ...row.path, symbolic: true, terminal: { kind: "return", blockId: "b:return" } } }));
    const differentReturn = { ...repeated[0], seed: { ...repeated[0].seed, id: "other-return" }, path: { ...repeated[0].path, blockIds: ["b:entry", "b:return-other"], edgeIds: ["e:other"], terminal: { kind: "return", blockId: "b:return-other" } } };
    assert.ok(fixture.project([...repeated, differentReturn], 3).items.some((item) => item.terminalSource === "return other"), "distinct symbolic return forms remain representative without a computed value");
    fixture.panel.dispose();
  } finally { runtime.restore(); }
});

test("symbolic-only Guide permits known input handoff while withholding calculated runtime results", () => {
  const runtime = installSidebarWebviewRuntime();
  try {
    const tasks = installNativeDisclosureTasks(); const fixture = createPanel(false, { symbolic: true }); document.getElementById("summary-root")!.append(fixture.panel.section); fixture.panel.setActive(true);
    runtime.setRenderedOpenByClassNth("summary-root", "logic-guide-analysis", 0, true);
    const id = runtime.getRenderedIdentityByClassNth("summary-root", "logic-guide-scenarios", 0); (document.getElementById(id) as HTMLDetailsElement).open = true; tasks.flush();
    const texts = runtime.getRenderedText("summary-root");
    const loadId = runtime.getRenderedIdentityByTitle("summary-root", "Load the selected scenario inputs into Values");
    assert.equal(runtime.isDisabled(loadId), false);
    runtime.clickByTitle("Load the selected scenario inputs into Values");
    assert.equal(fixture.loaded().length, 1);
    assert.ok(!texts.some((text) => text.startsWith("Calculated return:"))); fixture.panel.dispose();
  } finally { runtime.restore(); }
});

/** Fixture boundaries supply completed shared rows; renderer behavior is the assertion target. */
function createPanel(malformed = false, options: { legacy?: boolean; empty?: boolean; symbolic?: boolean; invalidNested?: "conditions" | "alternatives" | "gaps" } = {}) {
  return new Function(`${getBrowserLocalizationSource()}
    ${getFunctionLogicScenarioWorkspaceBrowserSource()}
    ${getFunctionTutorBrowserSource()}
    const item = { id: "summary:return", kind: "return", sourcePreview: "return count", presentationKey: "summary-item-return", certainty: "exact", scope: "source", conditions: [], blockIds: [${JSON.stringify(malformed ? "foreign:block" : "b:return")}], edgeIds: [], evidenceTokens: ["code-evidence:summary"] };
    const tutor = { fingerprint: "summary", availability: "ready", parameters: [], seeds: [], guide: { chapters: [] }, context: { counts: {} }, evidence: [{ token: "code-evidence:summary" }], program: { entryBlockId: "b:entry", blocks: [{blockId:"b:entry",kind:"entry",operations:[]}, {blockId:"b:return",kind:"return",label:"return count",operations:[],terminal:{kind:"return"}}], edges:[],bindings:[] }, behaviorSummary: { schema:1,status:"ready",purpose:{basis:"documentation",sourcePreview:"<img src=x onerror=run()>",certainty:"exact",evidenceTokens:["code-evidence:summary"]},inputs:[],outcomes:[item],steps:[item],impacts:[],gaps:[],omittedCounts:{inputs:0,outcomes:0,steps:0,impacts:0,gaps:0},limited:false } };
    for (let index=0; index<6; index+=1) tutor.seeds.push({ id:"seed:"+index,ordinal:index+1,source:"type",certainty:"exact",inputs:[],objectiveIds:[],evidenceTokens:[],gapIds:[] });
    tutor.program.edges.push({edgeId:"e:return",sourceBlockId:"b:entry",targetBlockId:"b:return",kind:"next"});
    const results = new Map(tutor.seeds.map((seed,index) => [seed.id, [{blockIds:["b:entry","b:return"],edgeIds:["e:return"],transitions:[],terminal:{kind:"return",value:{kind:"number",value:index}},certainty:"exact",scenario:{concrete:true,decisions:[],effects:[]}}]]));
    const state = { phase:"ready", results, errors:new Map(), resultRevision:1, selectedSeedId:"seed:0", selectedPathIndex:0 }; let acquireCount=0; let releaseCount=0; const subscribers=new Set(); const graphActions=[]; const sourceActions=[]; const previews=[]; const loaded=[];
    tutor.program.blocks.push({blockId:"b:return-other",kind:"return",label:"return other",operations:[],terminal:{kind:"return"}});
    tutor.program.blocks.push({blockId:"b:throw",kind:"throw",label:"throw failure",operations:[],terminal:{kind:"throw"}});
    tutor.program.edges.push({edgeId:"e:other",sourceBlockId:"b:entry",targetBlockId:"b:return-other",kind:"next"},{edgeId:"e:throw",sourceBlockId:"b:entry",targetBlockId:"b:throw",kind:"next"});
    const workspace = { read:()=>state, acquire:()=>{acquireCount+=1}, release:()=>{releaseCount+=1}, subscribe:(callback)=>{subscribers.add(callback);return()=>subscribers.delete(callback)}, select:(seedId,pathIndex)=>{state.selectedSeedId=seedId;state.selectedPathIndex=pathIndex;for(const callback of subscribers)callback()} };
    const options=${JSON.stringify(options)}; if(options.legacy)delete tutor.behaviorSummary;
    if(options.invalidNested==="gaps")tutor.behaviorSummary.gaps=[null];
    else if(options.invalidNested)tutor.behaviorSummary.outcomes[0][options.invalidNested]=[null];
    if(options.empty){tutor.behaviorSummary.status="unavailable";tutor.behaviorSummary.outcomes=[];tutor.behaviorSummary.steps=[];}
    if(options.symbolic){tutor.program.evaluationMode="symbolic-only";tutor.parameters.push({id:"p:count",name:"count",typeText:"Int"});for(const seed of tutor.seeds)seed.inputs.push({parameterId:"p:count",value:{kind:"number",value:17},certainty:"exact"});for(const paths of results.values())for(const path of paths){path.symbolic=true;path.scenario.concrete=false;}}
    const cache=createFunctionTutorRepresentativeSummaryCache(tutor);
    const panel=createFunctionTutorPanel({tutor}, {scenarioWorkspace:workspace,onShowGraph:item=>graphActions.push(item),onOpenEvidence:token=>sourceActions.push(token),onScenarioPreview:path=>previews.push(path),onLoadInputs:seed=>loaded.push(seed)});
    return { panel, acquisitions:()=>acquireCount,releases:()=>releaseCount,graphs:()=>graphActions,sources:()=>sourceActions,previews:()=>previews,loaded:()=>loaded,selection:()=>({seedId:state.selectedSeedId,pathIndex:state.selectedPathIndex}),summary:()=>tutor.behaviorSummary,valid:value=>functionTutorValidBehaviorSummary(value,tutor),rows:()=>readFunctionTutorScenarioRows(state,tutor.seeds),project:(rows,revision)=>cache.read(rows,revision) };
  `)() as {
    panel: { section: HTMLElement; setActive(active: boolean): void; refreshLanguage(): void; dispose(): void };
    acquisitions(): number; releases(): number; graphs(): Array<{ primaryBlockId: string }>; sources(): string[];
    previews(): Array<{ terminal: { kind: string } }>; selection(): { seedId: string; pathIndex: number };
    loaded(): unknown[];
    summary(): unknown; valid(value: unknown): boolean;
    rows(): Array<{ seed: Record<string, unknown>; pathIndex: number; path: Record<string, unknown> }>;
    project(rows: unknown[], revision: number): { items: Array<{ kind: string; basis: string; terminalSource?: string }> };
  };
}
