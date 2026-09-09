/** Budgeted, cached input-only text features shared across all parameters in one request. */
import { createPythonRegexRuntime } from "../../shared/pythonScenario";

/** Allocates useful features to every text coordinate instead of rejecting multi-string signatures. */
export function encodeNeuralTextChoices(choices: string[], references: string[], budget: number, patterns: string[]): number[][] {
  const lengthScale = Math.max(1, ...choices.map((value) => value.length));
  const limit = Math.max(4, Math.floor(budget));
  const refs = references.slice(0, Math.min(8, Math.max(0, limit - 6)));
  const characters = Math.min(8, Math.floor((limit - 4 - refs.length) / 2));
  const remaining = limit - 4 - refs.length - characters * 2;
  const regex = createPythonRegexRuntime();
  const usedPatterns = patterns.slice(0, Math.max(0, remaining - 2));
  const digitFeatures = usedPatterns.length ? Math.min(12, Math.floor((remaining - usedPatterns.length - 2) / 11)) : 0;
  return choices.map((text) => {
    const features = [text.length / lengthScale, text.trim().length / lengthScale,
      text.length ? (text.match(/\s/gu)?.length ?? 0) / text.length : 0,
      text.length ? (text.match(/[0-9]/gu)?.length ?? 0) / text.length : 0];
    const positions = [0, 1, 2, 3, Math.max(0, text.length - 4), Math.max(0, text.length - 3), Math.max(0, text.length - 2), Math.max(0, text.length - 1)];
    for (const position of positions.slice(0, characters)) {
      const code = text.charCodeAt(position) || 0; features.push((code >>> 8) / 255, (code & 255) / 255);
    }
    for (const reference of refs) {
      let distance = Math.abs(text.length - reference.length);
      for (let i = 0; i < Math.min(text.length, reference.length); i += 1) if (text[i] !== reference[i]) distance += 1;
      features.push(distance / lengthScale);
    }
    if (usedPatterns.length) {
      const digits = text.match(/[0-9]/gu) ?? [];
      features.push(digits.length / 64, text.split(/\r\n|[\r\n]/u).length / 32);
      for (let index = 0; index < digitFeatures; index += 1) {
        const digit = digits[index] === undefined ? -1 : Number(digits[index]);
        features.push(digit < 0 ? 0 : (digit + 1) / 10);
        for (let category = 0; category < 10; category += 1) features.push(digit === category ? 1 : 0);
      }
      for (const pattern of usedPatterns) {
        try { features.push(regex.matches(pattern, text).length / 32); } catch { features.push(0); }
      }
    }
    return features;
  });
}
