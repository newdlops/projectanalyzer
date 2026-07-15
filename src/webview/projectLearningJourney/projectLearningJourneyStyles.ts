/** Theme-aware styles for the collapsed project learning-method disclosure. */

/** Returns styles kept with the learning feature instead of the explorer shell. */
export function getProjectLearningJourneyStyles(): string {
  return /* css */ `
    .learning-intro,
    .learning-progress-copy,
    .learning-action-copy,
    .learning-roadmap-objective,
    .learning-roadmap-evidence,
    .learning-roadmap-exit,
    .learning-roadmap-states {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      line-height: 1.35;
    }

    .learning-intro {
      margin-bottom: 2px;
    }

    .learning-progress {
      padding: 4px 6px;
      border-left: 2px solid var(--vscode-progressBar-background);
      background: var(--vscode-textBlockQuote-background);
    }

    .learning-current {
      min-width: 0;
    }

    .learning-action {
      display: flex;
      min-width: 0;
      flex-direction: column;
      gap: 4px;
      padding: 6px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
    }

    .learning-action-heading,
    .learning-roadmap-heading {
      font-size: 11px;
      font-weight: 600;
    }

    .learning-action-field {
      display: grid;
      min-width: 0;
      grid-template-columns: 68px minmax(0, 1fr);
      gap: 5px;
    }

    .learning-action-label {
      color: var(--vscode-foreground);
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
    }

    .learning-roadmap-disclosure {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
    }

    .learning-roadmap-disclosure > summary {
      width: fit-content;
      cursor: pointer;
      font-weight: 600;
      user-select: none;
    }

    .learning-roadmap {
      display: flex;
      min-width: 0;
      flex-direction: column;
      gap: 5px;
      padding-top: 5px;
    }

    .learning-roadmap-stage {
      display: flex;
      min-width: 0;
      flex-direction: column;
      gap: 1px;
      padding: 4px 6px;
      border-left: 2px solid var(--vscode-panel-border);
    }

    .learning-roadmap-evidence {
      margin-top: 2px;
      font-size: 10px;
    }

    .learning-roadmap-exit,
    .learning-roadmap-states {
      font-size: 10px;
    }

    .learning-evidence-heading {
      margin-top: 4px;
      padding-top: 6px;
      border-top: 1px solid var(--vscode-panel-border);
    }
  `;
}
