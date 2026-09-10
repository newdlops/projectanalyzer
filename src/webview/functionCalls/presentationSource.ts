/** Shared semantic cues for call scenarios and relationship diagrams; color always has a text/shape counterpart. */
export function getFunctionCallsPresentationSource(): string {
  return /* js */ String.raw`
    /** Classifies displayed relationships only; never changes resolution or execution semantics. */
    function functionCallRelationTone(edges, cycle = false) {
      if (edges.some(edge => edge.deferred || edge.relation !== "call")) return "deferred";
      if (cycle || edges.some(edge => edge.loops.length)) return "loop";
      return edges.some(edge => edge.guards.length) ? "condition" : "call";
    }
    function createFunctionCallsPresentation(el, t) {
      const symbols = { condition: "◇", loop: "↻", call: "→", return: "↩", exception: "!", pending: "?", deferred: "⇢" };
      const glyph = tone => { const icon = el("span", "calls-glyph", symbols[tone] || "·"); icon.setAttribute("aria-hidden", "true"); return icon; };
      const cue = (tone, label) => { const badge = el("span", "calls-cue"); badge.dataset.callTone = tone; badge.append(glyph(tone), el("span", "", label)); return badge; };
      const legend = tones => {
        const list = el("ul", "calls-color-key"); list.setAttribute("aria-label", t("calls-color-key"));
        for (const tone of tones) { const item = el("li"); item.append(cue(tone, t("calls-color-" + tone))); list.append(item); }
        return list;
      };
      return { glyph, cue, legend };
    }
  `;
}
