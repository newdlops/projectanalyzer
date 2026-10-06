/** Source-owned explicit argument text for bounded on-demand call explanations. */
import type { SourceRange } from "../../shared/types";
import { createTypeScriptCallGuardReader } from "./languages/typescript";
import { createKotlinCallGuardReader } from "./languages/kotlin";
import { createPythonCallGuardReader } from "./languages/python";
/** Only a parser-matched invocation can establish zero arguments; no text regex or expression execution. */
export function readFunctionCallArguments(language: string, source: string, filePath: string, range: SourceRange): string[] | undefined {
  const site={filePath,range,calleeName:"",calleeText:""};
  if(language==="kotlin")return createKotlinCallGuardReader(source,filePath,512)(site).argumentsText;
  if(language==="typescript"||language==="javascript")return createTypeScriptCallGuardReader(source,filePath,512)(site).argumentsText;
  if(language==="python")return createPythonCallGuardReader(source,512)(site).argumentsText;
  return undefined;
}
