/**
 * Command implementations for the CodePlanner extension.
 *
 * Each exported function corresponds to a VS Code command registered in extension.ts.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import * as os from 'os';
import { recognizeImage } from './ocrEngine';
import { showTextInEditor, withProgress, saveResult } from './outputPanel';
import type { OcrOptions } from './types';

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function getConfig() {
  const cfg = vscode.workspace.getConfiguration('codeplanner');
  return {
    language:       cfg.get<string>('tesseractLanguage', 'eng'),
    tessDataPath:   cfg.get<string>('tessDataPath', '') || undefined,
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

  const result = await withProgress('CodePlanner: Extracting text…', async (progress) => {
    progress.report({ message: path.basename(imagePath) });
    return recognizeImage(imagePath, buildOcrOptions());
  });

  const header =
    `# CodePlanner OCR Result\n` +
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
    `CodePlanner: Text extracted → ${path.basename(saved)}`
  );
}

// ---------------------------------------------------------------------------
// Command: extractTextFromClipboard
// ---------------------------------------------------------------------------

export async function cmdExtractTextFromClipboard(context: vscode.ExtensionContext): Promise<void> {
  const tmpFile = path.join(os.tmpdir(), `codeplanner-clip-${Date.now()}.png`);

  try {
    await saveClipboardImageToFile(tmpFile);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showWarningMessage(`CodePlanner: No image found in clipboard — ${msg}. Copy an image first, then try again.`);
    return;
  }

  if (!fs.existsSync(tmpFile)) {
    vscode.window.showWarningMessage('CodePlanner: No image found in clipboard. Copy an image first, then try again.');
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
    return new Promise((resolve, reject) => {
      cp.execFile('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o'], (err, stdout) => {
        if (!err && stdout.length > 0) {
          fs.writeFileSync(destPath, stdout, 'binary');
          resolve();
        } else {
          cp.execFile('wl-paste', ['--type', 'image/png'], (err2, stdout2) => {
            if (!err2 && stdout2.length > 0) {
              fs.writeFileSync(destPath, stdout2, 'binary');
              resolve();
            } else {
              reject(new Error('No image in clipboard or no clipboard tool available. Install xclip: sudo apt install xclip'));
            }
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
  const tmpFile = path.join(os.tmpdir(), `codeplanner-capture-${Date.now()}.png`);

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
              'CodePlanner: No screenshot tool found. Install gnome-screenshot or scrot.'
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
  await cmdExtractText(context, vscode.Uri.file(imagePath));
}
