/** Real temporary stdio test processes. They echo data or emit explicit fixture replies, never load a model or execute source. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { NativeNarrativeWorkerOptions } from "../../llm/nativeNarratives";

/** Scope the fixture executable and all caller-owned workers to the callback. */
export async function withNativeNarrativeWorker<T>(run: (options: (mode?: string) => NativeNarrativeWorkerOptions) => Promise<T>): Promise<T> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "native-narrative-fixture-")), script = path.join(directory, "worker.cjs");
  await fs.writeFile(script, String.raw`/** Explicit fixture: no model/import/evaluator and no analyzed program execution. */
const readline=require('node:readline'),crypto=require('node:crypto');
const mode=process.argv[2],keeper=setInterval(()=>{},1000);
if(['wrong-uid','ignore-term'].includes(mode))process.on('SIGTERM',()=>{});
const write=value=>process.stdout.write(JSON.stringify(value)+'\n');
const ready={ready:true,sourceFree:true,sampledTokens:0,sourceTokensProvided:mode==='bad-ready'?1:0,sourceKvReused:false,fixture:true,modelLoads:0,workerPid:process.pid};
write(ready);
const reader=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
reader.on('line',line=>{
 const request=JSON.parse(line).requests[0],uid=request.uid;
 if(mode==='ignore-term')return;
 if(mode==='malformed'){process.stdout.write('{broken}\n');return;}
 if(mode==='invalid-utf8'){process.stdout.write(Buffer.from([255,10]));return;}
 if(mode==='oversized-line'){process.stdout.write(Buffer.alloc(262145,65));return;}
 if(mode==='unterminated'){process.stdout.write('{"replies":',()=>process.exit(0));return;}
 const calls=mode==='calls'&&uid<6?Array.from({length:2},(_,index)=>({callId:'call-'+(uid*2+index),
  role:'역할 😀 '+('r'.repeat(180)),inputs:'입력 "원문"\r\n'+('i'.repeat(180)),output:'출력 '+('o'.repeat(180)),effects:'변화 '+('e'.repeat(180)),reason:'이유 '+('n'.repeat(180))})):[];
 const text=mode==='oversized-content'?'x'.repeat(24001):mode==='calls'?JSON.stringify({calls,summary:uid===6?'전체 호출에 대한 시험 문장입니다.':undefined,
  flow:uid===6?'모든 앞선 응답을 읽은 시험 흐름입니다.':undefined,payloadSha256:crypto.createHash('sha256').update(JSON.stringify(request.payload)).digest('hex')}):JSON.stringify({uid,payload:request.payload,text:'시험 😀 "문자열"\r\n그대로'});
 const reply={fixture:true,replies:[{uid:mode==='wrong-uid'?uid+1:uid,content:text}]};
 let raw=JSON.stringify(reply)+'\n';if(mode==='negative-zero')raw=raw.replace('"uid":0','"uid":-0');
 if(mode==='split-utf8'){
  const bytes=Buffer.from(raw),emoji=bytes.indexOf(Buffer.from('😀'));
  process.stdout.write(bytes.subarray(0,emoji+1));setTimeout(()=>process.stdout.write(bytes.subarray(emoji+1)),5);
 }else process.stdout.write(raw);
 if(mode==='duplicate')process.stdout.write(raw);
});
reader.on('close',()=>{
 write({closed:true,fixture:mode!=='bad-close',modelLoads:0,workerPid:process.pid});
 setTimeout(()=>{clearInterval(keeper);process.stdout.end(()=>process.exit(0));},mode==='close-before-exit'?180:0);
});
`, { mode: 0o600 });
  try { return await run((mode = "echo") => ({ command: process.execPath, args: [script, mode], kind: "test-fixture", modelName: "Native fixture", killGraceMs: 80 })); }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
}

/** A test gate keeps lifecycle assertions event-based rather than depending on polling intervals. */
export function nativeGate(): { promise: Promise<void>; release(): void } {
  let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release };
}
