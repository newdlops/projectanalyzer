/** Actual temporary stdio child emitting explicit schema-authored CPU fixtures. No model or analyzed program executes. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { NativeNarrativeWorkerOptions } from "../../llm/nativeNarratives";
// The child loads this module by absolute path; declare the dependency so explicit-root private TypeScript emits it too.
import "./completeNativeNarrativeRoot";
import "./completeNativeNarrativeCall";

export type CompleteNativeFixtureExit = { pid: number; actualExitCode: number; processPeakRssBytes: number; modelLoads: 0 };

/** Keep child configuration source-free and retain real exit/RSS reports until assertions finish; force-killed children have no invented exit report. */
export async function withCompleteNativeNarrativeWorker<T>(run: (fixture: {
  options(mode?: "complete" | "echo" | "hold" | "bad-reply" | "bad-close" | "slow-close" | "call" | "call-bad-second" | "call-hold-second" | "call-bad-close" | "call-slow-close"): NativeNarrativeWorkerOptions;
  reports(): Promise<CompleteNativeFixtureExit[]>;
}) => Promise<T>): Promise<T> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "complete-native-provider-")), script = path.join(directory, "worker.cjs");
  await fs.writeFile(script, String.raw`/** Explicit CPU fixture: all complete prose is authored against the supplied schema, never by evaluating source. */
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline');
const mode=process.argv[2],helper=process.argv[3],directory=process.argv[4],keep=setInterval(()=>{},1000);
process.on('exit',code=>fs.writeFileSync(path.join(directory,'worker-'+process.pid+'.json'),JSON.stringify({pid:process.pid,actualExitCode:code,processPeakRssBytes:process.resourceUsage().maxRSS*1024,modelLoads:0}),{flag:'wx'}));
if(mode==='hold')process.on('SIGTERM',()=>{});
const reply=mode.startsWith('call')?require(process.argv[5]).completeNativeCallReply:mode==='echo'||mode==='hold'||mode==='bad-reply'?undefined:require(helper).completeNativeUnverifiedReply;
let packets=0;
const write=value=>process.stdout.write(JSON.stringify(value)+'\n');
write({ready:true,sourceFree:true,sampledTokens:0,sourceTokensProvided:0,sourceKvReused:false,fixture:true,modelLoads:0,workerPid:process.pid});
const reader=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
reader.on('line',async line=>{try{const request=JSON.parse(line).requests[0];packets++;if(mode==='hold'||mode==='call-hold-second'&&packets===2)return;
 const text=mode==='bad-reply'||mode==='call-bad-second'&&packets===2?'{}':mode==='echo'?JSON.stringify({payload:request.payload,text:'Raw 😀 "quoted"\r\n<literal>'}):(await reply(request.payload,packets)).text;
 write({fixture:true,replies:[{uid:request.uid,content:text}]});
}catch(error){process.stderr.write(String(error));process.exitCode=1;reader.close();}});
reader.on('close',()=>{if(mode==='hold')return;write({closed:true,fixture:mode!=='bad-close'&&mode!=='call-bad-close',modelLoads:0,workerPid:process.pid});
 setTimeout(()=>{clearInterval(keep);process.stdout.end(()=>process.exit(process.exitCode||0));},mode==='slow-close'||mode==='call-slow-close'?180:0);
});
`, { mode: 0o600 });
  try {
    return await run({ options(mode = "complete") { return { kind: "test-fixture", command: process.execPath,
      args: ["--max-old-space-size=256", script, mode, require.resolve("./completeNativeNarrativeRoot"), directory, require.resolve("./completeNativeNarrativeCall")], modelName: "Explicit complete native CPU fixture",
      killGraceMs: mode === "hold" ? 80 : 1000 }; },
    async reports() {
      const files = (await fs.readdir(directory)).filter(file => /^worker-\d+\.json$/u.test(file));
      return Promise.all(files.map(async file => JSON.parse(await fs.readFile(path.join(directory, file), "utf8")) as CompleteNativeFixtureExit));
    } });
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
