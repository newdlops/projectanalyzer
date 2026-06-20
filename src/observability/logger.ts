/**
 * Extension-host logger backed by a VS Code output channel. The logger keeps
 * analyzer, Webview, and host lifecycle events in one chronological stream.
 */

import * as vscode from "vscode";

/** Structured fields attached to one log event. */
export type LogFields = Record<string, unknown>;

/** Minimal logger contract shared across extension modules. */
export interface ProjectAnalyzerLogger {
  debug(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
}

/** Creates the output-channel backed logger used by one extension session. */
export function createProjectAnalyzerLogger(context: vscode.ExtensionContext): ProjectAnalyzerLogger {
  const channel = vscode.window.createOutputChannel("Project Analyzer");
  context.subscriptions.push(channel);

  return {
    debug: (message, fields) => appendLog(channel, "debug", message, fields),
    error: (message, fields) => appendLog(channel, "error", message, fields),
    info: (message, fields) => appendLog(channel, "info", message, fields),
    warn: (message, fields) => appendLog(channel, "warn", message, fields)
  };
}

/** Appends one timestamped log line to the output channel. */
function appendLog(
  channel: vscode.OutputChannel,
  level: string,
  message: string,
  fields: LogFields = {}
): void {
  channel.appendLine(`${new Date().toISOString()} ${level.toUpperCase()} ${message} ${stringifyFields(fields)}`);
}

/** Serializes structured fields without letting logging throw. */
function stringifyFields(fields: LogFields): string {
  try {
    return JSON.stringify(fields);
  } catch {
    return "{\"serialization\":\"failed\"}";
  }
}
