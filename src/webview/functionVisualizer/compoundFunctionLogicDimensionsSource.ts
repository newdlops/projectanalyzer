/**
 * Browser-side dimension estimation for text added while child function
 * fragments are merged. The generated helpers preserve complete labels and
 * reserve wrapped rows before compound edge routing begins.
 */

/** Returns CSP-compatible constants and helpers for compound node sizing. */
export function getCompoundFunctionLogicDimensionsSource(): string {
  return /* js */ `
    const COMPOUND_MIN_NODE_WIDTH = 184;
    const COMPOUND_MAX_NODE_WIDTH = 420;
    const COMPOUND_MIN_NODE_HEIGHT = 72;
    const COMPOUND_NODE_HORIZONTAL_PADDING = 18;
    const COMPOUND_NODE_VERTICAL_PADDING = 14;
    const COMPOUND_LABEL_CHARACTER_WIDTH = 7.2;
    const COMPOUND_META_CHARACTER_WIDTH = 6.1;
    const COMPOUND_BADGE_CHARACTER_WIDTH = 5.8;
    const COMPOUND_LABEL_LINE_HEIGHT = 15;
    const COMPOUND_META_LINE_HEIGHT = 12;
    const COMPOUND_BADGE_LINE_HEIGHT = 12;

    /**
     * Extends Host-provided dimensions for browser-added text. Full function
     * badges and resume labels are measured as wrapped rows, so attachment
     * never reintroduces clipping after the original fragment was laid out.
     */
    function measureCompoundBlockDimensions(block, sourceDimensions) {
      const valueChangeTexts = (block.valueChanges || []).map((change) =>
        String(change.targetKind || "value") + " "
          + String(change.target || "") + " "
          + String(change.operator || "")
          + (change.value ? " " + String(change.value) : "")
      );
      const allValueAccessTexts = (block.valueAccesses || []).map((access) =>
        String(access.bindingKind || "value") + " "
          + String(access.access || "read") + " "
          + String(access.name || "")
      );
      const valueAccessTexts = allValueAccessTexts.slice(0, 8);
      if (allValueAccessTexts.length > 8) {
        valueAccessTexts.push("+" + (allValueAccessTexts.length - 8) + " more bindings");
      }
      const visibleTexts = [
        block.label,
        block.sourceLocation || block.detail,
        block.branchLabel,
        block.functionLabel,
        ...valueChangeTexts,
        ...valueAccessTexts
      ];
      const longestTextUnits = Math.max(
        1,
        ...visibleTexts.map(compoundDisplayTextUnits)
      );
      const targetCharactersPerLine = clampCompoundNumber(
        Math.ceil(Math.sqrt(longestTextUnits * 12)),
        20,
        56
      );
      const width = Math.round(clampCompoundNumber(
        Math.max(
          Number(sourceDimensions?.width) || COMPOUND_MIN_NODE_WIDTH,
          COMPOUND_NODE_HORIZONTAL_PADDING
            + targetCharactersPerLine * COMPOUND_LABEL_CHARACTER_WIDTH
        ),
        COMPOUND_MIN_NODE_WIDTH,
        COMPOUND_MAX_NODE_WIDTH
      ));
      const innerWidth = Math.max(1, width - COMPOUND_NODE_HORIZONTAL_PADDING);
      const functionLabelLines = block.functionLabel
        ? estimateCompoundWrappedLines(
            block.functionLabel,
            innerWidth,
            COMPOUND_BADGE_CHARACTER_WIDTH
          )
        : 0;
      const branchLabelLines = block.branchLabel
        ? estimateCompoundWrappedLines(
            block.branchLabel,
            innerWidth,
            COMPOUND_BADGE_CHARACTER_WIDTH
          )
        : 0;
      const labelLines = estimateCompoundWrappedLines(
        block.label,
        innerWidth,
        COMPOUND_LABEL_CHARACTER_WIDTH
      );
      const metaLines = estimateCompoundWrappedLines(
        block.sourceLocation || block.detail,
        innerWidth,
        COMPOUND_META_CHARACTER_WIDTH
      );
      const valueRowTexts = [...valueChangeTexts, ...valueAccessTexts];
      const valueLines = valueRowTexts.reduce((total, text) =>
        total + estimateCompoundWrappedLines(
          text,
          innerWidth,
          COMPOUND_META_CHARACTER_WIDTH
        ), 0);
      const measuredHeight = COMPOUND_NODE_VERTICAL_PADDING
        + COMPOUND_BADGE_LINE_HEIGHT
        + (functionLabelLines + branchLabelLines) * COMPOUND_BADGE_LINE_HEIGHT
        + labelLines * COMPOUND_LABEL_LINE_HEIGHT
        + metaLines * COMPOUND_META_LINE_HEIGHT
        + valueLines * COMPOUND_LABEL_LINE_HEIGHT
        + Math.max(0, valueRowTexts.length - 1) * 3
        + 16;
      const functionLabelAllowance = functionLabelLines > 0
        ? functionLabelLines * COMPOUND_BADGE_LINE_HEIGHT + 4
        : 0;
      const sourceBackedHeight = (Number(sourceDimensions?.height) || COMPOUND_MIN_NODE_HEIGHT)
        + functionLabelAllowance;
      return {
        width,
        height: Math.ceil(Math.max(
          COMPOUND_MIN_NODE_HEIGHT,
          sourceBackedHeight,
          measuredHeight
        ))
      };
    }

    /** Estimates wrapped rows using the same Unicode-aware units as the Host layout. */
    function estimateCompoundWrappedLines(value, innerWidth, characterWidth) {
      const unitsPerLine = Math.max(1, Math.floor(innerWidth / characterWidth));
      const lines = String(value || "").split("\\n");
      let count = 0;
      for (const line of lines) {
        count += Math.max(1, Math.ceil(compoundDisplayTextUnits(line) / unitsPerLine));
      }
      return Math.max(1, count);
    }

    /** Counts wide Unicode glyphs conservatively without mutating visible text. */
    function compoundDisplayTextUnits(value) {
      let units = 0;
      for (const character of String(value || "")) {
        units += (character.codePointAt(0) || 0) > 0xff ? 1.7 : 1;
      }
      return units;
    }

    /** Clamps only geometry; graph text itself is never clamped. */
    function clampCompoundNumber(value, minimum, maximum) {
      return Math.min(maximum, Math.max(minimum, value));
    }
  `;
}
