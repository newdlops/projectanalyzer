/**
 * CSS source for the sidebar Project Map, Reading Guide, and three lazy
 * disclosure regions. Keeping these rules together preserves their visual
 * hierarchy while the shared explorer stylesheet remains responsibility-bound.
 */

/** Returns Project Map, Reading Guide, and overview signal styles. */
export function getProjectGuideStyles(): string {
  return PROJECT_GUIDE_STYLES;
}

/** Returns the layout and affordances for the three sidebar disclosures. */
export function getSidebarDisclosureStyles(): string {
  return SIDEBAR_DISCLOSURE_STYLES;
}

/** Static Project Map and first-read guide CSS injected into the Webview. */
const PROJECT_GUIDE_STYLES = /* css */ `    .project-guide,
    .project-overview {
      display: flex;
      min-width: 0;
      flex-direction: column;
      gap: 8px;
    }

    .project-guide {
      gap: 5px;
      padding: 7px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 5px;
      background: var(--vscode-editor-background);
    }

    .guide-summary,
    .guide-scopes,
    .guide-scope-detail,
    .guide-flow-steps {
      display: flex;
      min-width: 0;
      flex-direction: column;
      gap: 4px;
    }

    .guide-headline,
    .guide-scope-path,
    .guide-detail-heading,
    .guide-area-path {
      overflow: hidden;
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .guide-detail,
    .guide-scope-stack,
    .guide-scope-execution,
    .guide-area-counts,
    .guide-empty {
      overflow: hidden;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .guide-section-label {
      margin-top: 3px;
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
    }

    .guide-scope {
      display: flex;
      min-width: 0;
      flex-direction: column;
      gap: 1px;
      padding: 5px 7px;
      border: 0;
      border-left: 2px solid var(--vscode-panel-border);
      color: inherit;
      background: transparent;
      text-align: left;
      cursor: pointer;
    }

    .guide-scope:hover,
    .guide-scope:focus-visible,
    .guide-scope.selected {
      background: var(--vscode-list-hoverBackground);
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }

    .guide-scope.selected {
      border-left-color: var(--vscode-focusBorder);
    }

    .guide-scope-detail {
      margin-top: 4px;
      padding-top: 6px;
      border-top: 1px solid var(--vscode-panel-border);
    }

    .guide-area {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 6px;
      padding: 2px 0;
    }

    .guide-flow {
      border-left: 2px solid var(--vscode-panel-border);
      padding-left: 6px;
    }

    .guide-flow-summary {
      overflow: hidden;
      cursor: pointer;
      font-size: 11px;
      font-weight: 500;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .guide-flow-steps {
      gap: 1px;
      padding-top: 3px;
    }

    .guide-step {
      display: grid;
      grid-template-columns: 62px minmax(0, 1fr);
      min-width: 0;
      gap: 5px;
      padding: 2px 4px;
      border: 0;
      color: inherit;
      background: transparent;
      font: inherit;
      text-align: left;
    }

    button.guide-step {
      cursor: pointer;
    }

    button.guide-step:hover,
    button.guide-step:focus-visible {
      background: var(--vscode-list-hoverBackground);
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }

    .guide-step-role {
      overflow: hidden;
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
      text-overflow: ellipsis;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .guide-step-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .overview-block {
      min-width: 0;
      border-top: 1px solid var(--vscode-panel-border);
      padding-top: 6px;
    }

    .summary-title {
      margin-bottom: 4px;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }

    .overview-list,
    .signal-list {
      display: flex;
      min-width: 0;
      flex-direction: column;
      gap: 4px;
    }

    .overview-fact,
    .overview-signal {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      min-width: 0;
      gap: 1px 6px;
      padding: 4px 6px;
      border-left: 2px solid var(--vscode-panel-border);
      background: var(--vscode-editor-background);
    }

    .overview-label,
    .overview-value,
    .overview-count,
    .overview-detail,
    .overview-empty {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .overview-label {
      grid-column: 1 / -1;
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
    }

    .overview-value {
      font-weight: 500;
    }

    .overview-count {
      color: var(--vscode-descriptionForeground);
      font-variant-numeric: tabular-nums;
    }

    .overview-detail,
    .overview-empty {
      grid-column: 1 / -1;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
    }

    .overview-signal {
      border-left-color: var(--vscode-charts-yellow, var(--vscode-panel-border));
    }

    .actionable-signal {
      width: 100%;
      border-top: 0;
      border-right: 0;
      border-bottom: 0;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .actionable-signal:hover,
    .actionable-signal:focus-visible {
      background: var(--vscode-list-hoverBackground);
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }

    .overview-empty {
      padding: 2px 0;
    }
`;

/** Static disclosure CSS injected after the shared scroll-list rules. */
const SIDEBAR_DISCLOSURE_STYLES = /* css */ `    .accordion {
      display: flex;
      min-height: 0;
      flex: 1 1 auto;
      flex-direction: column;
      gap: 2px;
      overflow: hidden;
    }

    .tree-section {
      display: flex;
      min-height: 0;
      flex-direction: column;
      border-top: 1px solid var(--vscode-panel-border);
      overflow: hidden;
    }

    .calls-section,
    .structure-section,
    .analysis-section {
      flex: 1 1 220px;
      max-height: 42vh;
    }

    .tree-section:not(.collapsed) {
      min-height: 96px;
    }

    .tree-section.collapsed {
      flex: 0 0 auto;
      min-height: 0;
      max-height: none;
    }

    .accordion-panel {
      display: flex;
      min-height: 0;
      flex: 1 1 auto;
      padding-top: 2px;
      overflow: hidden;
    }

    .accordion-panel[hidden] {
      display: none;
    }

    .structure-panel,
    .analysis-panel {
      flex-direction: column;
    }

    .structure-switch {
      display: flex;
      flex: 0 0 auto;
      gap: 3px;
      margin: 2px 0 4px;
    }

    .structure-switch .view-button {
      padding: 3px 6px;
      font-size: 11px;
    }

    .analysis-panel {
      overflow: auto;
    }

    .accordion-header {
      display: grid;
      grid-template-columns: 16px minmax(0, 1fr);
      align-items: center;
      width: 100%;
      flex: 0 0 24px;
      height: 24px;
      padding: 0 6px 0 0;
      overflow: hidden;
      border: 0;
      border-radius: 0;
      color: var(--vscode-descriptionForeground);
      background: transparent;
      cursor: pointer;
      font-size: 11px;
      font-weight: 600;
      text-align: left;
      text-overflow: ellipsis;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .accordion-header:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .accordion-header:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }

    .accordion-disclosure {
      position: relative;
      width: 16px;
      height: 24px;
    }

    .accordion-disclosure::before {
      position: absolute;
      top: 8px;
      left: 5px;
      width: 0;
      height: 0;
      border-top: 4px solid transparent;
      border-bottom: 4px solid transparent;
      border-left: 5px solid var(--vscode-icon-foreground);
      content: "";
      opacity: 0.82;
    }

    .accordion-header[aria-expanded="true"] .accordion-disclosure::before {
      transform: rotate(90deg);
      transform-origin: 2px 4px;
    }

    .accordion-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
`;
