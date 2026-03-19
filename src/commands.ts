/**
 * Command implementations for the CodeVision extension.
 *
 * Each exported function corresponds to a VS Code command registered in extension.ts.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import * as os from 'os';
import { recognizeImage } from './ocrEngine';
import { generateWireframe } from './wireframeGenerator';
import { showTextInEditor, showHtmlInWebview, withProgress, saveResult } from './outputPanel';
import type { OcrOptions, WireframeOptions } from './types';

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function getConfig() {
  const cfg = vscode.workspace.getConfiguration('codevision');
  return {
    language:       cfg.get<string>('tesseractLanguage', 'eng'),
    tessDataPath:   cfg.get<string>('tessDataPath', '') || undefined,
    wireframeFormat: cfg.get<'svg' | 'ascii' | 'html'>('wireframeFormat', 'svg'),
    openInEditor:   cfg.get<boolean>('openResultInEditor', true)
  };
}

function buildOcrOptions(): OcrOptions {
  const cfg = getConfig();
  return {
    language:     cfg.language,
    tessDataPath: cfg.tessDataPath,
    verbose:      false
  };
}

// ---------------------------------------------------------------------------
// Pick an image file via the open dialog
// ---------------------------------------------------------------------------

async function pickImageFile(): Promise<string | undefined> {
  const uris = await vscode.window.showOpenDialog({
    canSelectMany:    false,
    canSelectFiles:   true,
    canSelectFolders: false,
    filters: {
      Images: ['png', 'jpg', 'jpeg', 'bmp', 'tiff', 'gif', 'webp']
    },
    openLabel: 'Select Image'
  });
  return uris?.[0]?.fsPath;
}

// ---------------------------------------------------------------------------
// Command: extractText
// ---------------------------------------------------------------------------

export async function cmdExtractText(
  context: vscode.ExtensionContext,
  uriArg?: vscode.Uri
): Promise<void> {
  const imagePath = uriArg?.fsPath ?? await pickImageFile();
  if (!imagePath) { return; }

  const result = await withProgress('CodeVision: Extracting text…', async (progress) => {
    progress.report({ message: path.basename(imagePath) });
    return recognizeImage(imagePath, buildOcrOptions());
  });

  const header =
    `# CodeVision OCR Result\n` +
    `# Source : ${imagePath}\n` +
    `# Language: ${getConfig().language}\n` +
    `# Confidence: ${result.confidence.toFixed(1)}%\n` +
    `# Image size: ${result.imageWidth}×${result.imageHeight}px\n\n`;

  const output = header + result.text;

  if (getConfig().openInEditor) {
    await showTextInEditor(output, 'plaintext');
  }

  const saved = await saveResult(imagePath, '_ocr', '.txt', output);
  vscode.window.showInformationMessage(
    `CodeVision: Text extracted → ${path.basename(saved)}`
  );
}

// ---------------------------------------------------------------------------
// Command: generateWireframe
// ---------------------------------------------------------------------------

export async function cmdGenerateWireframe(
  context: vscode.ExtensionContext,
  uriArg?: vscode.Uri
): Promise<void> {
  const imagePath = uriArg?.fsPath ?? await pickImageFile();
  if (!imagePath) { return; }

  const cfg = getConfig();

  const wireframe = await withProgress('CodeVision: Generating wireframe…', async (progress) => {
    progress.report({ message: `OCR pass (${cfg.language})` });
    const ocr = await recognizeImage(imagePath, buildOcrOptions());
    progress.report({ message: 'Building wireframe…', increment: 60 });
    return generateWireframe(ocr, { format: cfg.wireframeFormat } as WireframeOptions);
  });

  let content: string;
  let ext: string;
  let suffix: string;
  let editorLang: string;

  if (cfg.wireframeFormat === 'ascii') {
    content = wireframe.ascii;
    ext = '.txt';
    suffix = '_wireframe';
    editorLang = 'plaintext';
  } else if (cfg.wireframeFormat === 'html') {
    content = wireframe.html;
    ext = '.html';
    suffix = '_wireframe';
    editorLang = 'html';
  } else {
    content = wireframe.svg;
    ext = '.svg';
    suffix = '_wireframe';
    editorLang = 'xml';
  }

  if (cfg.wireframeFormat === 'html') {
    showHtmlInWebview(context, `Wireframe — ${path.basename(imagePath)}`, wireframe.html);
  } else if (cfg.openInEditor) {
    await showTextInEditor(content, editorLang);
  }

  const saved = await saveResult(imagePath, suffix, ext, content);
  vscode.window.showInformationMessage(
    `CodeVision: Wireframe saved → ${path.basename(saved)}` +
    ` (${wireframe.blocks.length} blocks)`
  );
}

// ---------------------------------------------------------------------------
// Command: analyzeImage (Text + Wireframe together)
// ---------------------------------------------------------------------------

export async function cmdAnalyzeImage(
  context: vscode.ExtensionContext,
  uriArg?: vscode.Uri
): Promise<void> {
  const imagePath = uriArg?.fsPath ?? await pickImageFile();
  if (!imagePath) { return; }

  const cfg = getConfig();

  const { ocr, wireframe } = await withProgress('CodeVision: Analyzing image…', async (progress) => {
    progress.report({ message: `Running OCR (${cfg.language})` });
    const ocr = await recognizeImage(imagePath, buildOcrOptions());
    progress.report({ message: 'Building wireframe…', increment: 60 });
    const wf = generateWireframe(ocr);
    return { ocr, wireframe: wf };
  });

  // Always show the combined HTML in the webview
  showHtmlInWebview(
    context,
    `Analysis — ${path.basename(imagePath)}`,
    wireframe.html
  );

  // Save both text and HTML outputs
  await saveResult(imagePath, '_ocr', '.txt', ocr.text);
  const savedHtml = await saveResult(imagePath, '_analysis', '.html', wireframe.html);

  vscode.window.showInformationMessage(
    `CodeVision: Analysis complete → ${path.basename(savedHtml)}` +
    ` (${wireframe.blocks.length} blocks, confidence ${ocr.confidence.toFixed(1)}%)`
  );
}

// ---------------------------------------------------------------------------
// Command: analyzeActiveImage (for the active editor's file)
// ---------------------------------------------------------------------------

export async function cmdAnalyzeActiveImage(context: vscode.ExtensionContext): Promise<void> {
  // Images open in VS Code's built-in image viewer are NOT a text editor.
  // vscode.window.activeTextEditor is undefined for them, so we must check the
  // active tab via tabGroups first, then fall back to text/notebook editors.
  let filePath: string | undefined;

  const activeTab = vscode.window.tabGroups?.activeTabGroup?.activeTab;
  if (activeTab) {
    const input = activeTab.input;
    // TabInputCustom = built-in image viewer, custom editors
    // TabInputText   = text editors (e.g. .svg opened as text)
    if (input instanceof vscode.TabInputCustom) {
      filePath = input.uri.fsPath;
    } else if (input instanceof vscode.TabInputText) {
      filePath = input.uri.fsPath;
    }
  }
  if (!filePath) {
    const editor = vscode.window.activeTextEditor;
    const activeUri = editor?.document.uri ?? vscode.window.activeNotebookEditor?.notebook.uri;
    filePath = activeUri?.fsPath;
  }

  if (!filePath) {
    vscode.window.showWarningMessage('CodeVision: No active image file found. Open an image file first.');
    return;
  }

  const SUPPORTED_EXT = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.tiff', '.gif', '.webp']);
  if (!SUPPORTED_EXT.has(path.extname(filePath).toLowerCase())) {
    vscode.window.showWarningMessage(
      `CodeVision: File type '${path.extname(filePath)}' is not a supported image format.`
    );
    return;
  }

  await cmdAnalyzeImage(context, vscode.Uri.file(filePath));
}

// ---------------------------------------------------------------------------
// Command: extractTextFromClipboard
// ---------------------------------------------------------------------------

export async function cmdExtractTextFromClipboard(context: vscode.ExtensionContext): Promise<void> {
  const tmpFile = path.join(os.tmpdir(), `codevision-clip-${Date.now()}.png`);

  try {
    await saveClipboardImageToFile(tmpFile);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showWarningMessage(`CodeVision: No image found in clipboard — ${msg}. Copy an image first, then try again.`);
    return;
  }

  if (!fs.existsSync(tmpFile)) {
    vscode.window.showWarningMessage('CodeVision: No image found in clipboard. Copy an image first, then try again.');
    return;
  }

  try {
    await cmdExtractText(context, vscode.Uri.file(tmpFile));
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Helper: save clipboard image to a temp PNG file (OS-specific)
// ---------------------------------------------------------------------------

function saveClipboardImageToFile(destPath: string): Promise<void> {
  if (process.platform === 'darwin') {
    // AppleScript reads clipboard PNG data and writes to file
    const script = [
      'try',
      '  set pngData to the clipboard as «class PNGf»',
      `  set fp to open for access POSIX file "${destPath}" with write permission`,
      '  set eof of fp to 0',
      '  write pngData to fp',
      '  close access fp',
      'on error errMsg',
      '  error errMsg',
      'end try'
    ].join('\n');
    return new Promise((resolve, reject) => {
      cp.execFile('osascript', ['-e', script], (err, _stdout, stderr) => {
        if (err) { reject(new Error(stderr || err.message)); }
        else { resolve(); }
      });
    });
  } else if (process.platform === 'win32') {
    const ps = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$img = [System.Windows.Forms.Clipboard]::GetImage()',
      'if ($img -eq $null) { throw "No image in clipboard" }',
      `$img.Save("${destPath}", [System.Drawing.Imaging.ImageFormat]::Png)`
    ].join('; ');
    return new Promise((resolve, reject) => {
      cp.execFile('powershell', ['-NonInteractive', '-Command', ps], (err, _stdout, stderr) => {
        if (err) { reject(new Error(stderr || err.message)); }
        else { resolve(); }
      });
    });
  } else {
    // Linux: try xclip, fall back to xsel
    return new Promise((resolve, reject) => {
      cp.execFile('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o'], (err, stdout) => {
        if (!err && stdout.length > 0) {
          fs.writeFileSync(destPath, stdout, 'binary');
          resolve();
        } else {
          cp.exec(`xsel --clipboard --output | file -`, (err2) => {
            reject(new Error('xclip not found. Install xclip: sudo apt install xclip'));
          });
        }
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Command: captureScreenshot
// ---------------------------------------------------------------------------

export async function cmdCaptureScreenshot(context: vscode.ExtensionContext): Promise<void> {
  const tmpFile = path.join(os.tmpdir(), `codevision-capture-${Date.now()}.png`);

  if (process.platform === 'darwin') {
    // screencapture -i: interactive crosshair selection → saves to file
    // If user presses Escape, the file is NOT created (no error thrown)
    await new Promise<void>((resolve, reject) => {
      cp.execFile('screencapture', ['-i', tmpFile], (err) => {
        if (err) { reject(err); } else { resolve(); }
      });
    });
  } else if (process.platform === 'win32') {
    // Launch the Windows Snipping Tool (ms-screensketch) then prompt to pick the saved file
    cp.exec('start ms-screensketch:');
    vscode.window.showInformationMessage(
      'Take your screenshot with the Snipping Tool, save the file, then click "Pick File".',
      'Pick File'
    ).then(async (action) => {
      if (action === 'Pick File') {
        const uris = await vscode.window.showOpenDialog({
          canSelectMany: false, canSelectFiles: true, canSelectFolders: false,
          filters: { Images: ['png', 'jpg', 'jpeg'] }, openLabel: 'Select Screenshot'
        });
        if (uris?.[0]) { await runCaptureAction(context, uris[0].fsPath); }
      }
    });
    return;
  } else {
    // Linux: try gnome-screenshot -a then scrot -s
    const captured = await new Promise<boolean>((resolve) => {
      cp.execFile('gnome-screenshot', ['-a', '-f', tmpFile], (err) => {
        if (!err) { resolve(true); return; }
        cp.execFile('scrot', ['-s', tmpFile], (err2) => {
          if (!err2) { resolve(true); }
          else {
            vscode.window.showErrorMessage(
              'CodeVision: No screenshot tool found. Install gnome-screenshot or scrot.'
            );
            resolve(false);
          }
        });
      });
    });
    if (!captured) { return; }
  }

  if (!fs.existsSync(tmpFile)) {
    return; // User cancelled (pressed Escape)
  }

  await runCaptureAction(context, tmpFile);
  try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
}

async function runCaptureAction(
  context: vscode.ExtensionContext,
  imagePath: string
): Promise<void> {
  const items = [
    { label: '$(file-text) Extract Text (OCR)', action: 'ocr' as const },
    { label: '$(layout) Generate Wireframe', action: 'wireframe' as const },
    { label: '$(search) Full Analysis (Text + Wireframe)', action: 'analyze' as const }
  ];
  const choice = await vscode.window.showQuickPick(items, {
    placeHolder: 'What would you like to do with the screenshot?'
  });
  if (!choice) { return; }

  const uri = vscode.Uri.file(imagePath);
  if (choice.action === 'ocr') {
    await cmdExtractText(context, uri);
  } else if (choice.action === 'wireframe') {
    await cmdGenerateWireframe(context, uri);
  } else {
    await cmdAnalyzeImage(context, uri);
  }
}
