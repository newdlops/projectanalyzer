/** Public isolated/selected call scopes through the production Host/provider; never execute source.
 * Usage after compile: node scripts/benchmark-call-scopes.mjs [runtime-root] [tag]
 * Raw public-fixture context/replies stay in a private temporary directory; graph preparation is excluded.
 */
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=process.argv[2]?path.resolve(process.argv[2]):repo,tag=(process.argv[3]||'candidate').replace(/[^a-z0-9_-]/gi,'_').slice(0,40);
const {loadFunctionCallReadingFixture}=require(repo+'/out/test/unit/helpers/functionCallReadingFixture');
const {FunctionCallsHostDelivery}=require(runtime+'/out/webview/functionCalls');
const {WebviewGraphDelivery}=require(runtime+'/out/webview/sidebarGraphDelivery');
const {SourceNodeTokenRegistry}=require(runtime+'/out/webview/sourceNavigation');
const {CodeFlowEvidenceTokenRegistry}=require(runtime+'/out/webview/codeFlow');
const {createLocalFunctionNarrativeProvider}=require(runtime+'/out/llm/functionNarratives');
const {exampleFunctionCallScenarios}=require(runtime+'/out/shared/functionCalls');
const directory=await fs.mkdtemp(path.join(tmpdir(),'call-scopes-'));
console.log(JSON.stringify({directory,runtime,tag,note:'One sequential measurement per public scope; static graph preparation excluded.'}));
for(const language of ['typescript','kotlin']){
 const f=await loadFunctionCallReadingFixture(language),graphDelivery=new WebviewGraphDelivery();
 const graphVersion=graphDelivery.activate(f.graph).snapshot.version;
 const sourceNodeTokens=new SourceNodeTokenRegistry(),evidenceTokens=new CodeFlowEvidenceTokenRegistry();
 sourceNodeTokens.activate(graphVersion,f.graph);evidenceTokens.activate(graphVersion,f.graph);
 const metrics=[],contexts=[],responses=[],staticReplies=[],replies=[];
 const local=createLocalFunctionNarrativeProvider({binaryPath:'/opt/homebrew/bin/llama-completion',
  modelPath:path.join(repo,'.local-models/Qwen3.5-4B-Q4_K_M.gguf'),onMetrics:value=>metrics.push(value)});
 const provider={managesDeadlines:local.managesDeadlines,withRun:local.withRun.bind(local),
  async generate(context,locale,signal,options){contexts.push(context);const reply=await local.generate(context,locale,signal,options);responses.push(reply);return reply;}};
 const host=new FunctionCallsHostDelivery({graphDelivery,sourceNodeTokens,evidenceTokens,provider,getLanguage:()=> 'ko',
  async readSourceText(file){return fs.readFile(path.join(repo,'src/test/fixtures/functionCalls',path.basename(file)),'utf8');},
  async postMessage(reply){staticReplies.push(reply);},async postNarratives(reply){replies.push(reply);await new Promise(resolve=>setImmediate(resolve));}});
 const request={graphVersion,sourceToken:sourceNodeTokens.createToken(f.root.id),requestId:1};await host.load(request);
 const slice=staticReplies.at(-1),examples=exampleFunctionCallScenarios(slice.control,new Map(slice.connections.map(edge=>[edge.id,edge])));
 const fee=slice.connections.find(edge=>slice.nodes.find(node=>node.id===edge.to)?.name==='addFee');
 const scopes=[{scope:'call',name:'addFee',connectionId:fee.id},...examples.map(example=>({scope:'scenario',
  name:'route-'+example.trace.callIds.length,choices:[...example.selection].map(([key,value])=>({key,value}))}))];
 let id=1;
 for(const item of scopes){
  const before=metrics.length,firstContext=contexts.length,firstResponse=responses.length;
  const {name,...selection}=item,explanation={...request,requestId:++id,contextId:slice.narratives.contextId,...selection};
  const start=performance.now();await host.explain(explanation);
  const completed=replies.at(-1),milliseconds=performance.now()-start;
  const firstModelCount=metrics.length;
  await host.explain({...explanation,requestId:++id,pageIndex:0,pageLanguage:'ko'});
  const calls=completed.narrative?.calls||[];
  const failures=[];
  if(completed.status!=='ready'||!completed.coverage?.complete)failures.push('incomplete');
  if(firstModelCount!==metrics.length||!replies.at(-1)?.cacheHit)failures.push('cache-triggered-generation');
  for(const call of calls)if(!evidenceTokens.resolve(call.callerEvidence)||!evidenceTokens.resolve(call.calleeEvidence))failures.push('missing-evidence');
  await fs.writeFile(path.join(directory,tag+'-'+language+'-'+name+'.json'),JSON.stringify({contexts:contexts.slice(firstContext),responses:responses.slice(firstResponse),completed},null,2),{mode:0o600});
  console.log(JSON.stringify({language,scope:item.scope,name,milliseconds,modelCalls:metrics.length-before,calls:calls.length,
   detailFields:calls.length*5,producer:completed.modelName,status:completed.status,failures}));
  if(failures.length)process.exitCode=1;
 }
 host.reset();
}
