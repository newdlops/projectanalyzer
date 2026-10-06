/** Kotlin calls retain grammar-owned evaluation order and expression prerequisites without running source. */
import assert from "node:assert/strict";
import test from "node:test";
import { KotlinAnalyzer } from "../../analyzer/languages/kotlin";
import { analyzeFunctionLogic } from "../../analyzer/functionLogic";
import { createFunctionCallContexts, readFunctionCallArguments } from "../../analyzer/functionCalls";
import { createContentHash } from "../../shared/hash";

test("Kotlin nested arguments precede their consumer and retain if, short-circuit and Elvis guards",async()=>{
  const content=`fun inspect(flag: Boolean, amount: Int?): Int {\n return outer(if (ready() && flag) inner(amount ?: fallback()) else fallback())\n}\nfun outer(value: Int): Int = value\nfun inner(value: Int): Int = value\nfun ready(): Boolean = true\nfun fallback(): Int = 3\n`;
  const analyzer=new KotlinAnalyzer(),file={path:"/workspace/nested.kt",languageId:"kotlin",content,sizeBytes:Buffer.byteLength(content),contentHash:createContentHash(content)};
  const parsed=await analyzer.parse(file),node=(await analyzer.extractSymbols(parsed)).find(node=>node.name==="inspect")!;
  const contexts=createFunctionCallContexts(analyzeFunctionLogic({functionNode:node,sourceText:content}),{sourceText:content});
  assert.ok(contexts.every(context=>context.evaluationOrder));
  const consumer=contexts.find(context=>context.site.calleeName==="outer")!,inner=contexts.find(context=>context.site.calleeName==="inner")!;
  assert.deepEqual(consumer.expressionGuards,[]);
  assert.ok(inner.expressionGuards?.some(guard=>guard.expression==="ready() && flag"&&guard.outcome==="true"));
  const fallbacks=contexts.filter(context=>context.site.calleeName==="fallback");
  assert.ok(fallbacks.some(context=>context.expressionGuards?.some(guard=>guard.expression==="amount"&&guard.outcome==="nullish")));
  assert.ok(fallbacks.some(context=>context.expressionGuards?.some(guard=>guard.expression==="ready() && flag"&&guard.outcome==="false")));
  const order=[...contexts].sort((a,b)=>{const x=a.evaluationOrder!,y=b.evaluationOrder!;for(let index=0;index<Math.min(x.length,y.length);index++)if(x[index]!==y[index])return x[index]-y[index];return y.length-x.length;});
  assert.equal(order[0].site.calleeName,"ready");assert.equal(order.at(-1)?.site.calleeName,"outer");
  assert.deepEqual(readFunctionCallArguments("kotlin",content,file.path,inner.site.range),["amount ?: fallback()"]);
});

test("Python source argument facts retain named/spread syntax and prove empty calls",()=>{
  const call="foo(x, b=2, *args, **kwargs)",range={startLine:0,startCharacter:0,endLine:0,endCharacter:call.length};
  assert.deepEqual(readFunctionCallArguments("python",call,"/workspace/input.py",range),["x","b=2","*args","**kwargs"]);
  assert.deepEqual(readFunctionCallArguments("python","zero()","/workspace/input.py",{...range,endCharacter:6}),[]);
});

test("Kotlin nested receiver/argument calls and syntax depth limits retain uncertainty",async()=>{
  const content=`fun inspect(): Int { return outer(inner(1)) }\nfun outer(value: Int): Int = value\nfun inner(value: Int): Int = value\n`;
  const analyzer=new KotlinAnalyzer(),file={path:"/workspace/depth.kt",languageId:"kotlin",content,sizeBytes:Buffer.byteLength(content),contentHash:createContentHash(content)};
  const parsed=await analyzer.parse(file),node=(await analyzer.extractSymbols(parsed)).find(node=>node.name==="inspect")!;
  const analysis=analyzeFunctionLogic({functionNode:node,sourceText:content});
  assert.ok(createFunctionCallContexts(analysis,{sourceText:content,maxDepth:1}).every(context=>context.limited));
  const contexts=createFunctionCallContexts(analysis,{sourceText:content});assert.ok(contexts.every(context=>context.evaluationOrder));
});
