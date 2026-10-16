/** Exact compiler-direction and field-order text sharing; these static hints never supply a source answer or model explanation. */
import { inputKeys, inputRecord, requireInput, sameInputJson, type InputRecord } from "./data";
import { notationPositions } from "./schemaTraversal";

const fieldsText = (fields: string[]): string => "Object fields in order: " + JSON.stringify(fields) + ".";
const stepFields = ["values", "syntax", "text", "reason", "effect"];
const hints = ["이 steps 슬롯의 소스 데이터: ",
  ". return 뒤의 식 전체에 최신 값을 대입해 계산합니다. reason에 계산식을 쓰고 values의 result.after에 그 계산 결과를 넣습니다. 조건식의 결과나 연산 전 입력값을 반환값으로 복사하지 마세요. " + fieldsText(stepFields),
  ". 현재 구문이 앞 상태를 어떻게 사용하는지 설명합니다. " + fieldsText(stepFields),
  ". 현재 대입의 계산과 저장을 구체적 값으로 설명합니다. 앞 조건의 해설을 반복하지 않습니다. " + fieldsText(stepFields),
  ". 현재 조건식의 판단만 설명합니다. 다음 대입이나 반환은 아직 일어나지 않았습니다. " + fieldsText(stepFields)];

/** Visit only annotation atoms and declared existing macro suffixes, leaving literal values and source facts untouched. */
function mapAnnotations(root: InputRecord, convert: (value: any) => any): void {
  const annotation = (parent: any, key: string | number) => { const value = parent[key]; if (Array.isArray(value)) { requireInput(value.length === 3); value[0] = convert(value[0]); value[2] = convert(value[2]); } else parent[key] = convert(value); };
  for (const { value: node } of notationPositions(root, true).rows) { if (Object.hasOwn(node, "raw")) continue;
    if (Object.hasOwn(node, "@")) { const macro = node["@"];
      if (macro[0] === "T") { if (macro.length === 3) annotation(macro, 2); }
      else if (macro[0] === "S") macro[4] = convert(macro[4]); else requireInput(macro[0] === "P"); continue;
    } for (const key of ["d", "title", "comment"]) if (Object.hasOwn(node, key)) annotation(node, key);
  }
}

/** Recognize only exact fixed hint text and canonical field-order strings; unknown directions remain complete literal strings. */
export function encodeNativeHintMacros(input: unknown): InputRecord {
  const notation = inputRecord(input); requireInput(notation.format === "source-step-schema-macros-v1" && Array.isArray(notation.texts) && Array.isArray(notation.stepForms));
  const atom = (value: any): any => { if (typeof value !== "string") return value; const index = hints.indexOf(value); if (index >= 0) return { hint: index };
    const prefix = "Object fields in order: "; if (value.startsWith(prefix) && value.endsWith(".")) { let fields; try { fields = JSON.parse(value.slice(prefix.length, -1)); } catch { return value; }
      if (Array.isArray(fields) && fields.every(field => typeof field === "string") && fieldsText(fields) === value) return { fields }; } return value; };
  notation.texts = notation.texts.map(atom); for (const form of notation.stepForms) form.prefix = atom(form.prefix); mapAnnotations(notation.schema, atom); notation.format = "source-hint-schema-macros-v1";
  sameInputJson(decodeNativeHintMacros(notation), input); return notation;
}

/** Restore original instruction bytes before schema/source decoding; no model text is accepted by this function. */
export function decodeNativeHintMacros(input: unknown): InputRecord {
  const notation = inputRecord(input); requireInput(notation.format === "source-hint-schema-macros-v1" && Array.isArray(notation.texts) && Array.isArray(notation.stepForms));
  const atom = (value: any): any => { if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    if (Object.hasOwn(value, "hint")) { inputKeys(value, ["hint"]); requireInput(Number.isInteger(value.hint) && value.hint >= 0 && value.hint < hints.length); return hints[value.hint]; }
    inputKeys(value, ["fields"]); requireInput(Array.isArray(value.fields) && value.fields.every((field: unknown) => typeof field === "string")); return fieldsText(value.fields); };
  notation.texts = notation.texts.map(atom); for (const form of notation.stepForms) form.prefix = atom(form.prefix); mapAnnotations(notation.schema, atom); notation.format = "source-step-schema-macros-v1"; return notation;
}
