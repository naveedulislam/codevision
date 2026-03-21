/**
 * Agent Request Builder
 *
 * Helps developers create structured context files that give AI agents the
 * information they need to act on a request accurately:
 *
 *   Drop-to-insert    Drag one or more files from the VS Code Explorer
 *                     into any open document — a relative-path Markdown
 *                     link is inserted at the drop position automatically.
 *
 *   New Agent Request Creates a templated markdown file with named
 *                     sections: Task, Files & References, Workspace
 *                     Context, Errors & Diagnostics, Constraints & Notes.
 *
 *   Insert commands
 *     • Insert File Reference  — file picker → [name](relative/path)
 *     • Insert File Content    — file picker → fenced code block
 *     • Insert Workspace Context — project tree + git branch/status
 *     • Insert Errors & Diagnostics — current VS Code problem list
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import * as os from 'os';

// ---------------------------------------------------------------------------
// Drop-to-insert — DocumentDropEditProvider
// ---------------------------------------------------------------------------

/**
 * Handles file drops into any open document.
 * Dragging files from the Explorer inserts the relative path at the drop position.
 *
 * TIP: VS Code competes with its own "open file" default drop behaviour.
 * A more reliable alternative is right-clicking a file in the Explorer and
 * choosing "CodePlanner: Insert Path at Cursor".
 */
export class FileDropEditProvider implements vscode.DocumentDropEditProvider {
  async provideDocumentDropEdits(
    document: vscode.TextDocument,
    _position: vscode.Position,
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken
  ): Promise<vscode.DocumentDropEdit | undefined> {
    // 'text/plain' is what VS Code Explorer puts in the DataTransfer —
    // it contains the absolute filesystem path of the dragged item.
    const item = dataTransfer.get('text/plain');
    if (!item) { return undefined; }

    const draggedPath = item.value as string;
    if (!draggedPath || !path.isAbsolute(draggedPath)) { return undefined; }

    const wsRoot =
      vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath ??
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    const insertText = wsRoot
      ? path.relative(wsRoot, draggedPath).replace(/\\/g, '/')
      : draggedPath;

    return new vscode.DocumentDropEdit(insertText);
  }
}

// ---------------------------------------------------------------------------
// Command: New Agent Request
// ---------------------------------------------------------------------------

export async function cmdNewAgentRequest(): Promise<void> {
  const wsFolder = vscode.workspace.workspaceFolders?.[0];
  const wsName   = wsFolder?.name ?? 'workspace';
  const today    = new Date().toISOString().slice(0, 10);

  const template = buildTemplate(wsName, today);
  const doc = await vscode.workspace.openTextDocument({ content: template, language: 'markdown' });
  const editor = await vscode.window.showTextDocument(doc, { preview: false });

  // Move cursor to the Task section so the user can start typing immediately
  const lines = template.split('\n');
  const taskIdx = lines.findIndex(l => l === '## Task');
  if (taskIdx >= 0) {
    const pos = new vscode.Position(taskIdx + 2, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos));
  }
}

function buildTemplate(wsName: string, date: string): string {
  return [
    `# Agent Request`,
    ``,
    `**Workspace:** ${wsName}  `,
    `**Date:** ${date}  `,
    `**Platform:** ${os.platform()} / Node ${process.version}`,
    ``,
    `---`,
    ``,
    `## Task`,
    `<!-- Describe what you want the agent to do -->`,
    ``,
    ``,
    ``,
    `---`,
    ``,
    `## Files & References`,
    `<!--`,
    `  Right-click a file in the Explorer → "CodePlanner: Insert Path at Cursor"`,
    `  Or drag files from the Explorer and drop here (drop in the text body, not the tab bar).`,
    `-->`,
    `<!-- Paths are relative to the workspace root. -->`,
    `<!-- Example: NutriComposer/web-app/src/App.tsx -->`,
    ``,
    ``,
    ``,
    `---`,
    ``,
    `## Workspace Context`,
    `<!-- Use "CodePlanner: Insert Workspace Context" to add project structure & git status. -->`,
    ``,
    ``,
    ``,
    `---`,
    ``,
    `## Errors & Diagnostics`,
    `<!-- Use "CodePlanner: Insert Errors & Diagnostics" to embed current VS Code problems. -->`,
    ``,
    ``,
    ``,
    `---`,
    ``,
    `## Constraints & Notes`,
    `<!-- Coding style, patterns to follow, anything the agent should know. -->`,
    ``,
    ``,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Command: Insert Workspace Context  (project tree + git branch/status)
// ---------------------------------------------------------------------------

export async function cmdInsertWorkspaceContext(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { return; }

  const wsFolder = vscode.workspace.workspaceFolders?.[0];
  if (!wsFolder) {
    vscode.window.showWarningMessage('CodePlanner: No workspace folder open.');
    return;
  }

  const wsRoot  = wsFolder.uri.fsPath;
  const wsName  = wsFolder.name;
  const tree    = buildFileTree(wsRoot, wsName);
  const branch  = await runGit(wsRoot, 'git rev-parse --abbrev-ref HEAD');
  const status  = await runGit(wsRoot, 'git status --short');

  const parts: string[] = [`### Project: ${wsName}`, ``, '```', tree, '```'];

  if (branch || status) {
    parts.push('', '### Git');
    if (branch) { parts.push('', `Branch: \`${branch.trim()}\``); }
    if (status) { parts.push('', '```', status.trim(), '```'); }
  }

  parts.push('');
  await editor.edit(eb => eb.insert(editor.selection.active, parts.join('\n')));
}

// ---------------------------------------------------------------------------
// Command: Insert Errors & Diagnostics
// ---------------------------------------------------------------------------

export async function cmdInsertErrors(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { return; }

  const wsRoot   = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const allDiags = vscode.languages.getDiagnostics();

  const errors:   string[] = [];
  const warnings: string[] = [];

  for (const [uri, diags] of allDiags) {
    const rel = wsRoot
      ? path.relative(wsRoot, uri.fsPath).replace(/\\/g, '/')
      : uri.fsPath;
    for (const d of diags) {
      const line  = d.range.start.line + 1;
      const msg   = d.message.replace(/\r?\n/g, ' ');
      const entry = `  ${rel}:${line}  ${msg}`;
      if (d.severity === vscode.DiagnosticSeverity.Error)   { errors.push(entry); }
      if (d.severity === vscode.DiagnosticSeverity.Warning) { warnings.push(entry); }
    }
  }

  let text: string;
  if (errors.length === 0 && warnings.length === 0) {
    text = `_No errors or warnings in workspace._\n`;
  } else {
    const lines: string[] = [
      `### Diagnostics (${errors.length} errors, ${warnings.length} warnings)`,
      '', '```'
    ];
    if (errors.length)   { lines.push('ERRORS:',   ...errors,   ''); }
    if (warnings.length) { lines.push('WARNINGS:', ...warnings, ''); }
    lines.push('```', '');
    text = lines.join('\n');
  }

  await editor.edit(eb => eb.insert(editor.selection.active, text));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'out', 'build', '__pycache__',
  '.next', '.nuxt', 'coverage', '.turbo', '.cache'
]);

function buildFileTree(dir: string, name: string, maxDepth = 2): string {
  const lines: string[] = [`${name}/`];

  function walk(cur: string, prefix: string, depth: number): void {
    if (depth > maxDepth) { return; }
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { return; }

    entries = entries
      .filter(e => !SKIP_DIRS.has(e.name) && !e.name.startsWith('.'))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) { return a.isDirectory() ? -1 : 1; }
        return a.name.localeCompare(b.name);
      });

    entries.forEach((entry, i) => {
      const last   = i === entries.length - 1;
      const branch = last ? '└─ ' : '├─ ';
      const child  = last ? '   ' : '│  ';
      lines.push(`${prefix}${branch}${entry.name}${entry.isDirectory() ? '/' : ''}`);
      if (entry.isDirectory()) {
        walk(path.join(cur, entry.name), prefix + child, depth + 1);
      }
    });
  }

  walk(dir, '', 1);
  return lines.join('\n');
}

function runGit(cwd: string, cmd: string): Promise<string> {
  return new Promise(resolve => {
    cp.exec(cmd, { cwd }, (err, stdout) => resolve(err ? '' : stdout));
  });
}
