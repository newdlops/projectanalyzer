/**
 * Embedded-code Function Logic fixture. It separates stored programs, direct
 * evaluation, generated callables, timers, ordinary text, and dynamic text.
 */

declare const js: (strings: TemplateStringsArray) => string;

export function loadEmbeddedPrograms(input: number, dynamicSource: string) {
  const storedProgram = `
    function normalize(value) {
      function clamp(current) {
        return current > 10 ? 10 : current;
      }
      return clamp(value + 1);
    }

    const choose = (value) => value ? normalize(value) : fallback();

    class Worker {
      run(value) {
        if (value > 0) {
          return choose(value);
        }
        return 0;
      }

      stop(reason) {
        notify(reason);
      }
    }
  `;

  eval("let total = input + 1; if (total > 2) { audit(total); } else { total = 0; }");
  setTimeout("notify('later');", 10);
  const generated = new Function(
    "value",
    "function nested(delta) { return delta * 2; } return value ? nested(value) : 0;"
  );
  const taggedProgram = js`function tagged(value) { return value ?? 0; }`;
  const ordinaryText = "hello";
  eval(dynamicSource);
  return { input, storedProgram, generated, taggedProgram, ordinaryText };
}
