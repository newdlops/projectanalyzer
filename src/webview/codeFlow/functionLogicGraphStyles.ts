/** Theme-aware styles for the bounded function-local control-flow graph. */

import { getFunctionLogicCompoundGroupStyles } from "./functionLogicCompoundGroupStyles";
import { getFunctionLogicBranchChoiceStyles } from "./branchChoices";
import { getFunctionLogicDataFlowStyles } from "./dataFlow";
import { getFunctionLogicInspectorStyles } from "./inspector";
import { getFunctionLogicTypographyStyles } from "./typography";
import {
  getFunctionLogicScenarioTraceStyles,
  getFunctionLogicValuePreviewStyles
} from "./valuePreview";
import { getFunctionLogicViewportStyles } from "./viewport";

/** Returns CSS for graph nodes, routed edges, lanes, and selection evidence. */
export function getFunctionLogicGraphStyles(): string {
  return /* css */ `
    ${getFunctionLogicTypographyStyles()}
    ${getFunctionLogicCompoundGroupStyles()}
    ${getFunctionLogicViewportStyles()}

    .logic-signature {
      display: grid;
      gap: 4px;
      min-width: 0;
      padding: 8px;
      background: var(--vscode-textCodeBlock-background, var(--vscode-editor-background));
      border: 1px solid var(--vscode-panel-border);
      border-radius: 5px;
    }

    .logic-signature > span {
      color: var(--vscode-descriptionForeground);
      font-size: var(--logic-font-small);
      font-weight: 700;
      letter-spacing: 0.08em;
    }

    .logic-signature code {
      min-width: 0;
      color: var(--vscode-textPreformat-foreground, var(--vscode-foreground));
      font-family: var(--vscode-editor-font-family);
      font-size: var(--logic-code-body);
      line-height: 1.45;
      overflow-wrap: anywhere;
      white-space: normal;
    }

    .logic-understanding {
      display: grid;
      gap: 8px;
      min-width: 0;
      padding: 10px;
      background: color-mix(in srgb, var(--vscode-textLink-foreground) 5%, var(--vscode-editor-background));
      border: 1px solid color-mix(in srgb, var(--vscode-textLink-foreground) 26%, var(--vscode-panel-border));
      border-radius: 7px;
    }

    .logic-understanding-header {
      display: grid;
      gap: 2px;
    }

    .logic-understanding-header > span {
      color: var(--vscode-textLink-foreground);
      font-size: var(--logic-font-small);
      font-weight: 800;
      letter-spacing: 0.08em;
    }

    .logic-understanding-header > strong {
      font-size: var(--logic-font-large);
    }

    .logic-understanding-cards {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 5px;
    }

    .logic-understanding-card {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: start;
      gap: 6px;
      min-width: 0;
      padding: 7px;
      background: color-mix(in srgb, var(--vscode-editor-background) 92%, transparent);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 5px;
    }

    .logic-understanding-number {
      display: grid;
      width: 19px;
      height: 19px;
      place-items: center;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border-radius: 50%;
      font-size: var(--logic-font-small);
      font-weight: 800;
    }

    .logic-understanding-card strong {
      font-size: var(--logic-font-body);
    }

    .logic-understanding-card p {
      margin: 2px 0 0;
      color: var(--vscode-descriptionForeground);
      font-size: var(--logic-font-small);
      line-height: 1.4;
      overflow-wrap: anywhere;
    }

    .logic-callees {
      display: grid;
      gap: 7px;
      min-width: 0;
      padding: 9px;
      background: color-mix(in srgb, var(--vscode-charts-green) 5%, var(--vscode-editor-background));
      border: 1px solid color-mix(in srgb, var(--vscode-charts-green) 30%, var(--vscode-panel-border));
      border-radius: 7px;
    }

    .logic-callees-header {
      display: flex;
      min-width: 0;
      align-items: start;
      justify-content: space-between;
      gap: 8px;
    }

    .logic-callees-header strong { font-size: var(--logic-font-body); }

    .logic-callees-header p {
      margin: 2px 0 0;
      color: var(--vscode-descriptionForeground);
      font-size: var(--logic-font-small);
      line-height: 1.4;
    }

    .logic-callee-list,
    .logic-selection-callees {
      display: grid;
      gap: 4px;
      min-width: 0;
    }

    .logic-callee-button {
      display: grid;
      gap: 2px;
      min-width: 0;
      padding: 6px 8px;
      color: var(--vscode-foreground);
      background: var(--vscode-button-secondaryBackground);
      border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
      border-radius: 4px;
      text-align: left;
      cursor: pointer;
    }

    .logic-callee-button:hover {
      background: var(--vscode-list-hoverBackground);
      border-color: var(--vscode-focusBorder);
    }

    .logic-callee-button strong {
      min-width: 0;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--logic-code-small);
      overflow-wrap: anywhere;
      white-space: normal;
    }

    .logic-callee-button span,
    .logic-callee-omitted {
      min-width: 0;
      color: var(--vscode-descriptionForeground);
      font-size: var(--logic-font-tiny);
      overflow-wrap: anywhere;
      white-space: normal;
    }

    .logic-selection-callees {
      padding-top: 6px;
      border-top: 1px solid color-mix(in srgb, var(--vscode-panel-border) 60%, transparent);
    }

    .logic-selection-callees > strong {
      font-size: var(--logic-font-small);
    }

    .flow-badge.logic-node-callee {
      color: var(--vscode-charts-green, var(--vscode-textLink-foreground));
      font-size: var(--logic-font-tiny);
      text-transform: none;
    }

    .flow-badge.logic-node-function {
      max-width: 100%;
      color: var(--vscode-textLink-foreground);
      border-color: color-mix(in srgb, var(--vscode-textLink-foreground) 55%, var(--vscode-panel-border));
      font-size: var(--logic-font-tiny);
      overflow-wrap: anywhere;
      text-transform: none;
      white-space: normal;
    }

    .logic-graph {
      display: grid;
      gap: 7px;
      min-width: 0;
    }

    .logic-graph-header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 7px;
    }

    .logic-graph-header > strong {
      font-size: var(--logic-font-body);
    }

    .logic-graph-legend {
      grid-column: 1 / -1;
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 3px;
    }

    .flow-badge.logic-legend {
      font-size: var(--logic-font-tiny);
      text-transform: none;
    }

    .flow-badge.logic-legend.inferred {
      border-style: dashed;
    }

    .flow-badge.logic-legend.repeat {
      color: var(--vscode-charts-purple, var(--vscode-textLink-foreground));
    }

    .flow-badge.logic-legend.event {
      color: var(--vscode-charts-yellow, var(--vscode-charts-orange));
      border-style: dashed;
    }

    .flow-badge.logic-legend.embedded,
    .flow-badge.logic-legend.callable {
      border-color: color-mix(in srgb, var(--vscode-charts-blue) 55%, var(--vscode-panel-border));
      color: var(--vscode-charts-blue, var(--vscode-textLink-foreground));
    }

    .flow-badge.logic-legend.value-change {
      color: var(--vscode-charts-orange, var(--vscode-textLink-foreground));
      border-color: color-mix(in srgb, var(--vscode-charts-orange) 55%, var(--vscode-panel-border));
    }

    .logic-edge-layer {
      position: absolute;
      inset: 0;
      z-index: 1;
      overflow: visible;
      pointer-events: none;
    }

    .logic-edge {
      fill: none;
      stroke: var(--vscode-descriptionForeground);
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-width: 1.4;
      vector-effect: non-scaling-stroke;
    }

    .logic-edge.dimmed,
    .logic-edge-label.dimmed {
      opacity: 0.28;
    }

    .logic-edge.active {
      opacity: 1;
      stroke-width: 2.6;
    }

    .logic-edge-label.active {
      font-weight: 700;
      opacity: 1;
    }

    .logic-edge.inferred,
    .logic-edge-exception,
    .logic-edge.back-edge {
      stroke-dasharray: 5 4;
    }

    .logic-edge-true,
    .logic-edge-iterate {
      stroke: var(--vscode-charts-green, var(--vscode-descriptionForeground));
    }

    .logic-edge-false,
    .logic-edge-exit,
    .logic-edge-throw,
    .logic-edge-exception {
      stroke: var(--vscode-charts-orange, var(--vscode-descriptionForeground));
    }

    .logic-edge-repeat,
    .logic-edge-continue,
    .logic-edge.back-edge {
      stroke: var(--vscode-charts-purple, var(--vscode-textLink-foreground));
      stroke-width: 1.8;
    }

    .logic-edge-call {
      stroke: var(--vscode-textLink-foreground);
      stroke-width: 2;
    }

    .logic-edge-event {
      stroke: var(--vscode-charts-yellow, var(--vscode-charts-orange));
      stroke-dasharray: 7 4;
      stroke-width: 2;
    }

    .logic-edge-defines,
    .logic-edge-deferred {
      stroke: var(--vscode-charts-blue, var(--vscode-textLink-foreground));
      stroke-dasharray: 6 4;
      stroke-width: 1.8;
    }

    .logic-edge-deferred {
      stroke: var(--vscode-charts-yellow, var(--vscode-charts-orange));
    }

    .logic-edge-call-return {
      stroke: var(--vscode-charts-green, var(--vscode-textLink-foreground));
      stroke-dasharray: 3 3;
      stroke-width: 1.8;
    }

    .logic-arrow-head {
      fill: var(--vscode-descriptionForeground);
    }

    .logic-edge-label {
      fill: var(--vscode-descriptionForeground);
      font-family: var(--vscode-editor-font-family);
      font-size: var(--logic-code-small);
      paint-order: stroke;
      stroke: var(--vscode-editor-background);
      stroke-linejoin: round;
      stroke-width: 4px;
    }

    .logic-edge-label-true,
    .logic-edge-label-iterate {
      fill: var(--vscode-charts-green, var(--vscode-foreground));
    }

    .logic-edge-label-false,
    .logic-edge-label-exit,
    .logic-edge-label-throw {
      fill: var(--vscode-charts-orange, var(--vscode-descriptionForeground));
    }

    .logic-edge-label-repeat,
    .logic-edge-label-continue {
      fill: var(--vscode-charts-purple, var(--vscode-textLink-foreground));
    }

    .logic-edge-label-call {
      fill: var(--vscode-textLink-foreground);
      font-weight: 700;
    }

    .logic-edge-label-event {
      fill: var(--vscode-charts-yellow, var(--vscode-charts-orange));
      font-weight: 700;
    }

    .logic-edge-label-defines,
    .logic-edge-label-deferred {
      fill: var(--vscode-charts-blue, var(--vscode-textLink-foreground));
      font-weight: 700;
    }

    .logic-edge-label-deferred {
      fill: var(--vscode-charts-yellow, var(--vscode-charts-orange));
    }

    .logic-edge-label-call-return {
      fill: var(--vscode-charts-green, var(--vscode-textLink-foreground));
      font-weight: 700;
    }

    /* Newly attached child routes fade in without changing exact/inferred dash semantics. */
    .logic-edge-entering,
    .logic-edge-label-entering {
      animation: logic-child-edge-enter 240ms ease-out backwards;
    }

    .logic-graph-node {
      --logic-node-depth-overlay: transparent;
      --logic-node-surface: color-mix(in srgb, var(--vscode-editor-background) 96%, var(--vscode-sideBar-background));
      position: absolute;
      z-index: 2;
      display: grid;
      grid-template-rows: auto auto auto;
      align-content: start;
      gap: 4px;
      min-width: 0;
      box-sizing: border-box;
      padding: 7px 8px;
      color: var(--vscode-foreground);
      background:
        linear-gradient(var(--logic-node-depth-overlay), var(--logic-node-depth-overlay)),
        var(--logic-node-surface);
      border: 1px solid var(--vscode-panel-border);
      border-left: 3px solid var(--vscode-charts-blue, var(--vscode-focusBorder));
      border-radius: 6px;
      text-align: left;
      cursor: pointer;
      overflow: hidden;
    }

    .logic-graph-node.logic-node-entering {
      transform-origin: top center;
      animation: logic-child-node-enter 280ms cubic-bezier(0.2, 0.8, 0.2, 1)
        var(--logic-enter-delay, 0ms) backwards;
    }

    @keyframes logic-child-node-enter {
      from {
        opacity: 0;
        transform: translateY(-10px) scale(0.985);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    @keyframes logic-child-edge-enter {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .logic-graph-node:hover {
      --logic-node-surface: color-mix(in srgb, var(--vscode-list-hoverBackground) 72%, var(--vscode-editor-background));
      border-color: color-mix(in srgb, var(--vscode-focusBorder) 58%, var(--vscode-panel-border));
    }

    .logic-graph-node:focus-visible,
    .logic-graph-node.selected {
      border-color: var(--vscode-focusBorder);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--vscode-focusBorder) 45%, transparent);
      outline: none;
    }

    .logic-node-entry,
    .logic-node-exit {
      border-left-color: var(--vscode-charts-green, var(--vscode-focusBorder));
      border-radius: 18px;
    }

    .logic-node-condition,
    .logic-node-switch,
    .logic-node-loop,
    .logic-node-try {
      --logic-node-surface: color-mix(in srgb, var(--vscode-charts-purple) 8%, var(--vscode-editor-background));
      border-left-color: var(--vscode-charts-purple, var(--vscode-charts-blue));
      border-radius: 14px;
    }

    .logic-node-render {
      --logic-node-surface: color-mix(in srgb, var(--vscode-charts-blue) 9%, var(--vscode-editor-background));
      border-left-color: var(--vscode-charts-blue, var(--vscode-textLink-foreground));
    }

    .logic-node-event {
      --logic-node-surface: color-mix(in srgb, var(--vscode-charts-yellow) 9%, var(--vscode-editor-background));
      border-left-color: var(--vscode-charts-yellow, var(--vscode-charts-orange));
      border-style: dashed;
    }

    .logic-node-embedded {
      --logic-node-surface: color-mix(in srgb, var(--vscode-charts-blue) 10%, var(--vscode-editor-background));
      border-left-color: var(--vscode-charts-blue, var(--vscode-textLink-foreground));
      border-style: double;
    }

    .logic-node-callable {
      --logic-node-surface: color-mix(in srgb, var(--vscode-charts-purple) 7%, var(--vscode-editor-background));
      border-left-color: var(--vscode-charts-purple, var(--vscode-charts-blue));
      border-style: dashed;
    }

    .logic-node-effect,
    .logic-node-mutation {
      --logic-node-surface: color-mix(in srgb, var(--vscode-charts-orange) 8%, var(--vscode-editor-background));
      border-left-color: var(--vscode-charts-orange, var(--vscode-charts-yellow));
    }

    .logic-node-return,
    .logic-node-throw,
    .logic-node-break,
    .logic-node-continue {
      border-left-color: var(--vscode-charts-yellow, var(--vscode-descriptionForeground));
    }

    .logic-depth-1 {
      --logic-node-depth-overlay: color-mix(in srgb, var(--vscode-focusBorder) 2%, transparent);
    }

    .logic-depth-2 {
      --logic-node-depth-overlay: color-mix(in srgb, var(--vscode-focusBorder) 4%, transparent);
    }

    .logic-depth-3 {
      --logic-node-depth-overlay: color-mix(in srgb, var(--vscode-focusBorder) 6%, transparent);
    }

    .logic-depth-4 {
      --logic-node-depth-overlay: color-mix(in srgb, var(--vscode-focusBorder) 8%, transparent);
    }

    .logic-depth-5 {
      --logic-node-depth-overlay: color-mix(in srgb, var(--vscode-focusBorder) 11%, transparent);
    }

    .logic-node-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 4px;
    }

    .logic-node-branch {
      min-width: 0;
      color: var(--vscode-textLink-foreground);
      font-size: var(--logic-font-tiny);
      font-weight: 700;
      overflow-wrap: anywhere;
      text-transform: uppercase;
      white-space: normal;
    }

    .logic-node-label {
      display: block;
      min-width: 0;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--logic-code-small);
      line-height: 1.3;
      overflow-wrap: anywhere;
      white-space: normal;
    }

    .logic-node-value-changes,
    .logic-selection-value-changes {
      display: grid;
      gap: 3px;
      min-width: 0;
    }

    .logic-value-change {
      display: flex;
      min-width: 0;
      align-items: baseline;
      gap: 4px;
      padding: 2px 4px;
      color: var(--vscode-foreground);
      background: color-mix(in srgb, var(--vscode-charts-orange) 9%, transparent);
      border: 1px solid color-mix(in srgb, var(--vscode-charts-orange) 45%, var(--vscode-panel-border));
      border-radius: 4px;
      text-align: left;
    }

    .logic-value-change.inferred {
      border-style: dashed;
    }

    .logic-value-target-kind {
      flex: 0 0 auto;
      color: var(--vscode-charts-orange, var(--vscode-textLink-foreground));
      font-size: var(--logic-font-tiny);
      font-weight: 800;
      letter-spacing: 0.04em;
      white-space: nowrap;
    }

    .logic-value-change code {
      min-width: 0;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--logic-code-tiny);
      line-height: 1.3;
      overflow-wrap: anywhere;
      white-space: normal;
    }

    .logic-node-meta {
      min-width: 0;
      color: var(--vscode-descriptionForeground);
      font-family: var(--vscode-editor-font-family);
      font-size: var(--logic-code-tiny);
      line-height: 1.35;
      overflow-wrap: anywhere;
      white-space: normal;
    }

    .logic-selection {
      display: grid;
      gap: 5px;
      min-width: 0;
      padding: 9px;
      background: color-mix(in srgb, var(--vscode-focusBorder) 6%, var(--vscode-editor-background));
      border: 1px solid color-mix(in srgb, var(--vscode-focusBorder) 38%, var(--vscode-panel-border));
      border-radius: 6px;
    }

    .logic-selection-header {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: 5px;
    }

    .logic-selection-header > strong {
      min-width: 0;
      flex: 1;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--logic-code-body);
      overflow-wrap: anywhere;
    }

    .logic-selection-detail,
    .logic-selection-meta {
      margin: 0;
      color: var(--vscode-descriptionForeground);
      font-size: var(--logic-font-small);
      line-height: 1.45;
      overflow-wrap: anywhere;
    }

    .logic-selection-meta {
      font-family: var(--vscode-editor-font-family);
    }

    .logic-selection-value-section {
      display: grid;
      gap: 4px;
      padding-top: 5px;
      border-top: 1px solid color-mix(in srgb, var(--vscode-panel-border) 60%, transparent);
    }

    .logic-selection-value-section > strong {
      font-size: var(--logic-font-small);
    }

    .logic-selection-transfers {
      display: flex;
      flex-wrap: wrap;
      gap: 3px;
      padding-top: 4px;
      border-top: 1px solid color-mix(in srgb, var(--vscode-panel-border) 60%, transparent);
    }

    .flow-badge.logic-transfer {
      max-width: 100%;
      color: var(--vscode-textLink-foreground);
      text-transform: none;
      overflow-wrap: anywhere;
      white-space: normal;
    }

    .flow-badge.logic-transfer.inferred {
      border-style: dashed;
    }

    .flow-badge.logic-transfer.true,
    .flow-badge.logic-transfer.iterate {
      color: var(--vscode-charts-green, var(--vscode-foreground));
    }

    .flow-badge.logic-transfer.false,
    .flow-badge.logic-transfer.exit,
    .flow-badge.logic-transfer.throw,
    .flow-badge.logic-transfer.exception {
      color: var(--vscode-charts-orange, var(--vscode-descriptionForeground));
    }

    .flow-badge.logic-transfer.repeat,
    .flow-badge.logic-transfer.continue {
      color: var(--vscode-charts-purple, var(--vscode-textLink-foreground));
    }

    .flow-badge.logic-transfer.callReturn {
      color: var(--vscode-charts-green, var(--vscode-textLink-foreground));
      border-style: dashed;
    }

    .flow-badge.logic-transfer.event {
      color: var(--vscode-charts-yellow, var(--vscode-charts-orange));
      border-style: dashed;
    }

    .logic-open-statement {
      margin-top: 2px;
    }

    @media (prefers-reduced-motion: reduce) {
      .logic-graph-node.logic-node-entering,
      .logic-edge-entering,
      .logic-edge-label-entering {
        animation: none;
      }
    }

    @media (forced-colors: active) {
      .logic-graph-viewport,
      .logic-graph-node,
      .logic-selection {
        border-color: CanvasText;
      }

      .logic-edge,
      .logic-arrow-head {
        stroke: CanvasText;
        fill: CanvasText;
      }
    }

    @media (max-width: 760px) {
      .logic-understanding-cards {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 430px) {
      .logic-understanding-cards {
        grid-template-columns: 1fr;
      }
    }

    ${getFunctionLogicDataFlowStyles()}
    ${getFunctionLogicInspectorStyles()}
    ${getFunctionLogicValuePreviewStyles()}
    ${getFunctionLogicScenarioTraceStyles()}
    ${getFunctionLogicBranchChoiceStyles()}
  `;
}
