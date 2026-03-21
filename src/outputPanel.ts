/**
 * Output Panel — helpers for displaying CodePlanner results inside VS Code.
 *
 * Text results are shown in a new untitled text editor.
 * Wireframe / HTML results are shown in a Webview panel.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Show plain text in a new editor tab
// ---------------------------------------------------------------------------

export async function showTextInEditor(content: string, language = 'plaintext'): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({
    content,
    language
  });
  await vscode.window.showTextDocument(doc, { preview: false });
}

// ---------------------------------------------------------------------------
// Webview panel — shared instance (one per session)
// ---------------------------------------------------------------------------

let _panel: vscode.WebviewPanel | undefined;

export function showHtmlInWebview(
  context: vscode.ExtensionContext,
  title: string,
  htmlContent: string
): void {
  if (_panel) {
    _panel.title    = title;
    _panel.webview.html = sanitiseHtml(htmlContent, _panel.webview);
    _panel.reveal(vscode.ViewColumn.Beside, true);
    return;
  }

  _panel = vscode.window.createWebviewPanel(
    'codeplannerResult',
    title,
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    {
      enableScripts: false,     // No JS required for static SVG/HTML
      localResourceRoots: []
    }
  );

  _panel.webview.html = sanitiseHtml(htmlContent, _panel.webview);

  _panel.onDidDispose(() => {
    _panel = undefined;
  }, null, context.subscriptions);
}

/**
 * Wraps the user-generated HTML in a VS Code-safe shell with a strict
 * Content-Security-Policy and a nonce (no user scripts are injected).
 */
function sanitiseHtml(inner: string, _webview: vscode.Webview): string {
  // Produce a random nonce for each render (nothing to inject here, but
  // it signals intent and satisfies the CSP header requirement).
  const nonce = crypto.randomBytes(16).toString('base64');

  // The inner HTML already contains a full <html> document — strip it and
  // re-wrap with the VS Code CSP header.
  const bodyMatch = inner.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const headStyleMatch = inner.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  const bodyContent  = bodyMatch  ? bodyMatch[1]  : inner;
  const inlineStyles = headStyleMatch ? headStyleMatch[1] : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'nonce-${nonce}'; img-src data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style nonce="${nonce}">
    ${inlineStyles}
  </style>
</head>
<body>
  ${bodyContent}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Progress helper
// ---------------------------------------------------------------------------

export async function withProgress<T>(
  title: string,
  task: (progress: vscode.Progress<{ message?: string; increment?: number }>) => Promise<T>
): Promise<T> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title, cancellable: false },
    task
  );
}

// ---------------------------------------------------------------------------
// Save helper — write content to a file next to the source image
// ---------------------------------------------------------------------------

export async function saveResult(
  sourceImagePath: string,
  suffix: string,
  ext: string,
  content: string
): Promise<string> {
  const dir      = path.dirname(sourceImagePath);
  const base     = path.basename(sourceImagePath, path.extname(sourceImagePath));
  const outPath  = path.join(dir, `${base}${suffix}${ext}`);
  const encoder  = new TextEncoder();
  await vscode.workspace.fs.writeFile(vscode.Uri.file(outPath), encoder.encode(content));
  return outPath;
}
