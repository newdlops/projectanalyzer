/** Public isolated/selected call scopes through the production Host/provider; never execute source.
 * Usage after compile: node scripts/benchmark-call-scopes.mjs [runtime-root] [tag] [checkout|serial|body|fallback|values|receivers|model|objects|members]
 * Raw public-fixture context/replies stay in a private temporary directory; graph preparation is excluded.
 */
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=process.argv[2]?path.resolve(process.argv[2]):repo,tag=(process.argv[3]||'candidate').replace(/[^a-z0-9_-]/gi,'_').slice(0,40);
const fixtureKind=process.argv[4]||'checkout';
if(!['checkout','serial','body','fallback','values','receivers','model','objects','members'].includes(fixtureKind))throw new Error('Unknown public fixture kind');
const {loadFunctionCallReadingFixture}=require(repo+'/out/test/unit/helpers/functionCallReadingFixture');
const {FunctionCallsHostDelivery}=require(runtime+'/out/webview/functionCalls');
const {WebviewGraphDelivery}=require(runtime+'/out/webview/sidebarGraphDelivery');
const {SourceNodeTokenRegistry}=require(runtime+'/out/webview/sourceNavigation');
const {CodeFlowEvidenceTokenRegistry}=require(runtime+'/out/webview/codeFlow');
const {createLocalFunctionNarrativeProvider}=require(runtime+'/out/llm/functionNarratives');
const {exampleFunctionCallScenarios}=require(runtime+'/out/shared/functionCalls');
const directory=await fs.mkdtemp(path.join(tmpdir(),'call-scopes-'));
console.log(JSON.stringify({directory,runtime,tag,fixtureKind,note:'One sequential measurement per public scope; static graph preparation excluded.'}));
for(const language of ['typescript','kotlin']){
 const serial=language==='kotlin'
  ? 'fun checkout(amount: Int): Int {\n val a = addFee(amount)\n val b = double(a)\n return addFee(b)\n}'
  : 'import { addFee, double } from "./readingHelpers";\nexport function checkout(amount: number): number {\n const a = addFee(amount);\n const b = double(a);\n return addFee(b);\n}';
 const oneCall=language==='kotlin'?'fun checkout(amount: Int): Int { return addFee(amount) }'
  :'import { addFee } from "./readingHelpers";\nexport function checkout(amount: number): number { return addFee(amount); }';
 const body=language==='kotlin'?'var n = value + 5; if (n < 0) return 0; n *= 2; return n + 3'
  :'let n = value + 5; if (n < 0) return 0; n *= 2; return n + 3;';
 const fallback=language==='kotlin'?'val n = value + 5; audit(n); return n + 3'
  :'const n = value + 5; audit(n); return n + 3;';
 const values=language==='kotlin'?'val n = outer(inner(value), value + 1); return n + 3'
  :'const n = outer(inner(value), value + 1); return n + 3;';
 const receivers=language==='kotlin'?'val s = connect(value); return s.read(value) + s.bias'
  :'const s = connect(value); return s.read(value) + s.bias;';
 const model=language==='kotlin'?'val n = service.audit(value); return n + 3'
  :'const n = service.audit(value); return n + 3;';
 // A declared reference type is source syntax, not a known runtime object or
 // a safe value to feed the primitive evaluator. No fixture source is run.
 const objectParent=language==='kotlin'?'fun checkout(amount: Payload): Int { return addFee(amount) }'
  :'import { addFee, type Payload } from "./readingHelpers";\nexport function checkout(amount: Payload): number { return addFee(amount); }';
 const objectHelper=language==='kotlin'?'data class Payload(val bias: Int)\nfun addFee(value: Payload): Int { val n = value.bias; return n + 3 }'
  :'export interface Payload { bias: number }\nexport function addFee(value: Payload): number { const n = value.bias; return n + 3; }';
 const memberParent=language==='kotlin'?'fun checkout(amount: Payload): Int {\n if (amount.bias < 0) return 0\n return addFee(amount.bias + 1)\n}'
  :'import { addFee, type Payload } from "./readingHelpers";\nexport function checkout(amount: Payload): number {\n if (amount.bias < 0) return 0;\n return addFee(amount.bias + 1);\n}';
 const memberHelper=language==='kotlin'?'data class Payload(val bias: Int)\nfun addFee(value: Int): Int { return value + 5 }'
  :'export interface Payload { bias: number }\nexport function addFee(value: number): number { return value + 5; }';
 const f=await loadFunctionCallReadingFixture(language,fixtureKind==='checkout'?undefined:(name,source)=>fixtureKind==='objects'
  ?name==='reading'?objectParent:objectHelper:fixtureKind==='members'?name==='reading'?memberParent:memberHelper:name==='reading'
  ?fixtureKind==='serial'?serial:oneCall:['body','fallback','values','receivers','model'].includes(fixtureKind)?source.replace(language==='kotlin'?'return value + 5':'return value + 5;',fixtureKind==='body'?body:fixtureKind==='values'?values:fixtureKind==='receivers'?receivers:fixtureKind==='model'?model:fallback):source),graphDelivery=new WebviewGraphDelivery();
 const graphVersion=graphDelivery.activate(f.graph).snapshot.version;
 const sourceNodeTokens=new SourceNodeTokenRegistry(),evidenceTokens=new CodeFlowEvidenceTokenRegistry();
 sourceNodeTokens.activate(graphVersion,f.graph);evidenceTokens.activate(graphVersion,f.graph);
 const metrics=[],contexts=[],responses=[],staticReplies=[],replies=[];
 const local=createLocalFunctionNarrativeProvider({binaryPath:'/opt/homebrew/bin/llama-completion',
  modelPath:path.join(repo,'.local-models/Qwen3.5-4B-Q4_K_M.gguf'),onMetrics:value=>metrics.push(value)});
 const provider={managesDeadlines:local.managesDeadlines,withRun:local.withRun.bind(local),
  async generate(context,locale,signal,options){contexts.push(context);const reply=await local.generate(context,locale,signal,options);responses.push(reply);return reply;}};
 const host=new FunctionCallsHostDelivery({graphDelivery,sourceNodeTokens,evidenceTokens,provider,getLanguage:()=> 'ko',
  async readSourceText(file){return f.files.find(candidate=>candidate.path===file)?.content;},
  async postMessage(reply){staticReplies.push(reply);},async postNarratives(reply){replies.push(reply);await new Promise(resolve=>setImmediate(resolve));}});
 const request={graphVersion,sourceToken:sourceNodeTokens.createToken(f.root.id),requestId:1};await host.load(request);
 const slice=staticReplies.at(-1),examples=exampleFunctionCallScenarios(slice.control,new Map(slice.connections.map(edge=>[edge.id,edge])));
 const fee=slice.connections.find(edge=>slice.nodes.find(node=>node.id===edge.to)?.name==='addFee');
 const scopes=[...(fixtureKind!=='checkout'?[{scope:'overview',name:'structure'}]:[]),{scope:'call',name:'addFee',connectionId:fee.id},...examples.map(example=>({scope:'scenario',
  name:'route-'+example.trace.callIds.length,choices:[...example.selection].map(([key,value])=>({key,value}))}))];
 let id=1;
 for(const item of scopes){
  const before=metrics.length,firstContext=contexts.length,firstResponse=responses.length;
  const {name,...selection}=item,explanation={...request,requestId:++id,contextId:slice.narratives.contextId,...selection};
  const start=performance.now();await host.explain(explanation);
  const completed=replies.at(-1),milliseconds=performance.now()-start;
  const firstModelCount=metrics.length;
  const pages=[];
  for(let pageIndex=0;pageIndex<(completed.page?.count||1);pageIndex++){
   await host.explain({...explanation,requestId:++id,pageIndex,pageLanguage:'ko'});pages.push(replies.at(-1));
  }
  const calls=pages.flatMap(page=>page.narrative?.calls||[]);
  const failures=[];
  if(completed.status!=='ready'||!completed.coverage?.complete)failures.push('incomplete');
  if(firstModelCount!==metrics.length||pages.some(page=>!page.cacheHit))failures.push('cache-triggered-generation');
  if(calls.length!==completed.coverage?.total)failures.push('missing-call-details');
  for(const call of calls)if(!evidenceTokens.resolve(call.callerEvidence)||!evidenceTokens.resolve(call.calleeEvidence))failures.push('missing-evidence');
  await fs.writeFile(path.join(directory,tag+'-'+language+'-'+name+'.json'),JSON.stringify({contexts:contexts.slice(firstContext),responses:responses.slice(firstResponse),completed,pages},null,2),{mode:0o600});
  console.log(JSON.stringify({language,scope:item.scope,name,milliseconds,modelCalls:metrics.length-before,calls:calls.length,
   detailFields:calls.length*5,producer:completed.modelName,status:completed.status,metrics:metrics.slice(before),failures}));
  if(failures.length)process.exitCode=1;
 }
 host.reset();
}
