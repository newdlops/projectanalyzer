/** Theme-aware styles for the flow-first launcher and vertical Flow Reader. */

import { getFunctionLogicGraphStyles } from "./functionLogicGraphStyles";

/** Returns CSS scoped to the CodeFlow Activity Bar surface. */
export function getCodeFlowStyles(): string {
  return /* css */ `
    .code-flow-shell {
      gap: 12px;
      padding: 12px;
    }

    .product-intro {
      position: relative;
      padding: 14px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      background:
        linear-gradient(
          145deg,
          color-mix(in srgb, var(--vscode-textLink-foreground) 9%, transparent),
          transparent 58%
        ),
        var(--vscode-sideBarSectionHeader-background, var(--vscode-sideBar-background));
      overflow: hidden;
    }

    .product-intro::after {
      position: absolute;
      top: -28px;
      right: -26px;
      width: 88px;
      height: 88px;
      border: 1px solid color-mix(in srgb, var(--vscode-textLink-foreground) 28%, transparent);
      border-radius: 50%;
      content: "";
      opacity: 0.55;
      pointer-events: none;
    }

    .product-eyebrow,
    .section-kicker {
      color: var(--vscode-textLink-foreground);
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.12em;
      line-height: 1.4;
    }

    .product-intro h1,
    .flow-start h2,
    .flow-reader h2,
    .flow-reader h3 {
      margin: 0;
      color: var(--vscode-foreground);
    }

    .product-intro h1 {
      margin-top: 4px;
      font-size: 19px;
      line-height: 1.2;
      letter-spacing: -0.02em;
    }

    .product-intro p {
      max-width: 30em;
      margin: 7px 0 0;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      line-height: 1.5;
    }

    .analysis-toolbar .primary-button {
      width: 100%;
      min-height: 30px;
      font-weight: 600;
    }

    .reading-frame {
      padding: 10px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 7px;
      background: color-mix(in srgb, var(--vscode-editor-background) 55%, transparent);
    }

    .reading-frame ol {
      display: grid;
      gap: 3px;
      margin: 8px 0 0;
      padding: 0;
      list-style: none;
    }

    .reading-frame li {
      display: grid;
      grid-template-columns: 18px minmax(74px, 0.72fr) minmax(0, 1.45fr);
      align-items: baseline;
      gap: 5px;
      min-width: 0;
      padding: 3px 4px;
      border-radius: 3px;
    }

    .reading-frame li:nth-child(odd) {
      background: color-mix(in srgb, var(--vscode-list-hoverBackground) 45%, transparent);
    }

    .reading-frame li > span {
      display: inline-grid;
      width: 15px;
      height: 15px;
      place-items: center;
      color: var(--vscode-badge-foreground);
      background: var(--vscode-badge-background);
      border-radius: 50%;
      font-size: 9px;
    }

    .reading-frame strong {
      min-width: 0;
      font-size: 10px;
    }

    .reading-frame small {
      min-width: 0;
      color: var(--vscode-descriptionForeground);
      font-size: 9px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .flow-start,
    .flow-reader {
      min-width: 0;
    }

    .section-heading-row {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 8px;
    }

    .flow-start h2,
    .flow-reader h2 {
      margin-top: 2px;
      font-size: 15px;
      line-height: 1.3;
    }

    .summary-chip {
      flex: 0 0 auto;
      color: var(--vscode-descriptionForeground);
      font-size: 9px;
      white-space: nowrap;
    }

    .start-mode-switch {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 2px;
      margin-top: 10px;
      padding: 2px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      background: var(--vscode-editor-background);
    }

    .start-mode {
      min-width: 0;
      padding: 5px 7px;
      color: var(--vscode-descriptionForeground);
      background: transparent;
      border: 0;
      border-radius: 4px;
      cursor: pointer;
    }

    .start-mode.active {
      color: var(--vscode-foreground);
      background: var(--vscode-list-activeSelectionBackground, var(--vscode-list-hoverBackground));
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--vscode-focusBorder) 30%, transparent);
    }

    .start-mode:focus-visible,
    .result-card:focus-visible,
    .flow-step:focus-visible,
    .logic-block:focus-visible,
    .logic-button:focus-visible,
    .source-button:focus-visible,
    .back-button:focus-visible,
    .origin-chip:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }

    .flow-search {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 5px;
      margin-top: 7px;
    }

    .flow-search input {
      width: 100%;
      min-width: 0;
      box-sizing: border-box;
      padding: 6px 8px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 4px;
      outline: none;
    }

    .flow-search input:focus {
      border-color: var(--vscode-focusBorder);
    }

    .search-submit {
      padding: 5px 9px;
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 4px;
      cursor: pointer;
    }

    .flow-search-meta {
      min-height: 16px;
      margin-top: 5px;
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
    }

    .flow-results {
      display: grid;
      gap: 5px;
      max-height: min(43vh, 430px);
      padding: 1px;
      overflow: auto;
    }

    .result-card {
      display: grid;
      gap: 4px;
      width: 100%;
      min-width: 0;
      padding: 8px;
      color: var(--vscode-foreground);
      background: color-mix(in srgb, var(--vscode-editor-background) 72%, transparent);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      text-align: left;
      cursor: pointer;
    }

    .result-card:hover {
      background: var(--vscode-list-hoverBackground);
      border-color: color-mix(in srgb, var(--vscode-focusBorder) 55%, var(--vscode-panel-border));
    }

    .result-card:disabled {
      cursor: default;
      opacity: 0.6;
    }

    .result-card-top,
    .flow-step-header {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: 6px;
    }

    .result-name,
    .flow-step-name {
      min-width: 0;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .result-name {
      font-size: 11px;
    }

    .result-badges {
      display: inline-flex;
      flex: 0 0 auto;
      gap: 3px;
    }

    .result-detail,
    .flow-step-detail,
    .flow-step-evidence {
      color: var(--vscode-descriptionForeground);
      font-size: 9px;
      line-height: 1.4;
      overflow-wrap: anywhere;
    }

    .flow-badge {
      display: inline-flex;
      align-items: center;
      min-height: 14px;
      box-sizing: border-box;
      padding: 1px 4px;
      color: var(--vscode-descriptionForeground);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 999px;
      font-size: 8px;
      font-weight: 700;
      letter-spacing: 0.02em;
      line-height: 1.2;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .flow-badge.confidence.exact,
    .flow-badge.confidence.resolved {
      color: var(--vscode-charts-green, var(--vscode-foreground));
      border-color: color-mix(in srgb, var(--vscode-charts-green) 52%, var(--vscode-panel-border));
    }

    .flow-badge.confidence.inferred {
      color: var(--vscode-charts-yellow, var(--vscode-foreground));
      border-style: dashed;
    }

    .flow-badge.confidence.unresolved,
    .flow-badge.confidence.unknown {
      color: var(--vscode-charts-orange, var(--vscode-descriptionForeground));
      border-style: dotted;
    }

    .text-button,
    .back-button,
    .logic-button,
    .source-button,
    .origin-chip {
      color: var(--vscode-textLink-foreground);
      background: transparent;
      border: 0;
      cursor: pointer;
    }

    .text-button {
      width: 100%;
      margin-top: 5px;
      padding: 5px;
      font-size: 10px;
    }

    .back-button {
      margin: 0 0 8px;
      padding: 2px 0;
      font-size: 10px;
      text-align: left;
    }

    .flow-reader-header {
      padding-bottom: 9px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }

    .flow-subtitle,
    .flow-summary {
      margin-top: 4px;
      color: var(--vscode-descriptionForeground);
      font-size: 9px;
      line-height: 1.4;
    }

    .semantics-note {
      margin: 8px 0;
      padding: 7px 8px;
      color: var(--vscode-descriptionForeground);
      background: color-mix(in srgb, var(--vscode-charts-yellow) 8%, transparent);
      border-left: 2px solid var(--vscode-charts-yellow, var(--vscode-panel-border));
      font-size: 9px;
      line-height: 1.45;
    }

    .flow-origins,
    .flow-gaps {
      margin-top: 10px;
    }

    .flow-origins h3,
    .flow-gaps h3 {
      margin-bottom: 6px;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .flow-origins > div {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .origin-chip {
      max-width: 100%;
      padding: 3px 6px;
      background: color-mix(in srgb, var(--vscode-textLink-foreground) 8%, transparent);
      border: 1px solid color-mix(in srgb, var(--vscode-textLink-foreground) 30%, var(--vscode-panel-border));
      border-radius: 999px;
      font-size: 9px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .flow-steps {
      display: grid;
      gap: 6px;
      margin-top: 8px;
    }

    .flow-step {
      position: relative;
      display: grid;
      gap: 4px;
      min-width: 0;
      margin-left: calc(var(--flow-depth, 0) * 11px);
      padding: 8px 8px 8px 10px;
      background: color-mix(in srgb, var(--vscode-editor-background) 78%, transparent);
      border: 1px solid var(--vscode-panel-border);
      border-left-width: 3px;
      border-radius: 6px;
      outline: none;
    }

    .flow-step::before {
      position: absolute;
      top: -7px;
      left: -3px;
      width: 1px;
      height: 7px;
      background: var(--vscode-panel-border);
      content: "";
    }

    .flow-step:first-child::before {
      display: none;
    }

    .flow-step.focus-step {
      background: color-mix(in srgb, var(--vscode-focusBorder) 9%, var(--vscode-editor-background));
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--vscode-focusBorder) 35%, transparent);
    }

    .flow-step.stage-boundary {
      border-left-color: var(--vscode-charts-blue, var(--vscode-focusBorder));
    }

    .flow-step.stage-decision {
      border-left-color: var(--vscode-charts-purple, var(--vscode-charts-blue));
    }

    .flow-step.stage-effect {
      border-left-color: var(--vscode-charts-orange, var(--vscode-charts-yellow));
    }

    .flow-step.stage-unknown {
      border-left-color: var(--vscode-charts-yellow, var(--vscode-descriptionForeground));
      border-left-style: dotted;
    }

    .flow-step-name {
      font-size: 10px;
    }

    .flow-step-evidence {
      padding-top: 3px;
      border-top: 1px solid color-mix(in srgb, var(--vscode-panel-border) 60%, transparent);
      font-family: var(--vscode-editor-font-family);
      font-size: 8px;
    }

    .source-button {
      width: fit-content;
      padding: 1px 0;
      font-size: 9px;
    }

    .flow-step-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .logic-button {
      width: fit-content;
      padding: 2px 6px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 3px;
      font-size: 9px;
    }

    .source-button:hover,
    .logic-button:hover,
    .back-button:hover,
    .text-button:hover {
      text-decoration: underline;
    }

    .gap-card {
      margin-top: 5px;
      padding: 7px 8px;
      color: var(--vscode-descriptionForeground);
      background: color-mix(in srgb, var(--vscode-charts-yellow) 7%, transparent);
      border: 1px dashed color-mix(in srgb, var(--vscode-charts-yellow) 48%, var(--vscode-panel-border));
      border-radius: 5px;
    }

    .gap-card strong {
      color: var(--vscode-foreground);
      font-size: 9px;
    }

    .gap-card p {
      margin: 3px 0 0;
      font-size: 9px;
      line-height: 1.4;
    }

    .flow-empty {
      padding: 14px 9px;
      color: var(--vscode-descriptionForeground);
      border: 1px dashed var(--vscode-panel-border);
      border-radius: 6px;
      font-size: 10px;
      line-height: 1.4;
      text-align: center;
    }

    .utility-actions {
      margin-top: auto;
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
    }

    .utility-actions > summary {
      width: fit-content;
      cursor: pointer;
      user-select: none;
    }

    .utility-action-grid {
      margin-top: 7px;
    }

    ${getFunctionLogicGraphStyles()}

    @media (forced-colors: active) {
      .product-intro,
      .reading-frame,
      .result-card,
      .flow-step,
      .gap-card {
        border-color: CanvasText;
      }
    }
  `;
}
