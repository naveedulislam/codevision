/**
 * CodePlanner Extension — main activation entry point.
 *
 * Registers:
 *   1. VS Code Command Palette commands  (for manual use)
 *   2. Language Model Tools              (for Copilot / AI agents)
 */

import * as vscode from 'vscode';
import { disposeWorker } from './ocrEngine';
import {
  cmdExtractText,
  cmdExtractTextFromClipboard,
  cmdCaptureScreenshot
} from './commands';
import {
  FileDropEditProvider,
  cmdNewAgentRequest,
  cmdInsertWorkspaceContext,
  cmdInsertErrors
} from './agentRequestBuilder';
import {
  CopilotFilesProvider,
  cmdSendToM365Copilot,
} from './copilotBridge';
import { recognizeImage } from './ocrEngine';
import type { OcrOptions } from './types';

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
  // ── Command Palette commands ────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('codeplanner.extractText', (uri?: vscode.Uri) =>
      cmdExtractText(context, uri)
    ),

    vscode.commands.registerCommand('codeplanner.extractTextFromClipboard', () =>
      cmdExtractTextFromClipboard(context)
    ),

    // Context-menu wrapper (pass the URI from the explorer)
    vscode.commands.registerCommand('codeplanner.extractTextFromUri', (uri: vscode.Uri) =>
      cmdExtractText(context, uri)
    ),

    vscode.commands.registerCommand('codeplanner.captureScreenshot', () =>
      cmdCaptureScreenshot(context)
    ),

    // Agent Request Builder commands
    vscode.commands.registerCommand('codeplanner.newAgentRequest', () =>
      cmdNewAgentRequest()
    ),

    vscode.commands.registerCommand('codeplanner.insertWorkspaceContext', () =>
      cmdInsertWorkspaceContext()
    ),

    vscode.commands.registerCommand('codeplanner.insertErrors', () =>
      cmdInsertErrors()
    ),

    // ── M365 Copilot File Bridge ──────────────────────────────────────────

    // Sidebar panel — shows staged files and accepts Explorer drag-drops.
    ...((): vscode.Disposable[] => {
      const provider = new CopilotFilesProvider();

      const treeView = vscode.window.createTreeView('codeplanner.copilotFiles', {
        treeDataProvider: provider,
        dragAndDropController: provider,
        canSelectMany: true,
        showCollapseAll: false,
      });

      const cmds: vscode.Disposable[] = [
        treeView,

        // Explorer right-click → "Send to M365 Copilot Chat"
        // VS Code passes (rightClickedUri, allSelectedUris[]) for multi-select.
        vscode.commands.registerCommand(
          'codeplanner.sendToM365Copilot',
          (uri?: vscode.Uri, selectedUris?: vscode.Uri[]) =>
            cmdSendToM365Copilot(provider, uri, selectedUris),
        ),

        // Clicking a staged file in the tree re-copies it to the clipboard.
        vscode.commands.registerCommand(
          'codeplanner.copilotRecopyFile',
          (item: { filePath: string }) =>
            provider.copyAndNotify(item.filePath),
        ),

        // Copy icon in the tree view title bar — copies ALL staged files at once.
        vscode.commands.registerCommand(
          'codeplanner.copilotCopyAllFiles',
          () => provider.copyAllAndNotify(),
        ),

        // Trash icon in the tree view title bar.
        vscode.commands.registerCommand(
          'codeplanner.clearCopilotFiles',
          () => provider.clearFiles(),
        ),

        // Globe icon — open M365 Copilot in the built-in Simple Browser.
        vscode.commands.registerCommand('codeplanner.openM365Copilot', () =>
          vscode.commands.executeCommand(
            'simpleBrowser.show',
            'https://m365.cloud.microsoft/chat/',
          ),
        ),
      ];

      return cmds;
    })(),

    // Drop-to-insert: drag files/folders from Explorer → inserts relative path.
    // No dropMimeTypes filter: let VS Code pass all DataTransfer data so
    // 'text/plain' (which carries the absolute path) is always available.
    vscode.languages.registerDocumentDropEditProvider(
      [
        { language: 'markdown',   scheme: 'file' },
        { language: 'markdown',   scheme: 'untitled' },
        { language: 'plaintext',  scheme: 'file' },
        { language: 'plaintext',  scheme: 'untitled' },
        { language: 'javascript', scheme: 'file' },
        { language: 'typescript', scheme: 'file' },
        { language: 'html',       scheme: 'file' },
        { language: 'css',        scheme: 'file' },
        { language: 'json',       scheme: 'file' },
        { language: 'yaml',       scheme: 'file' },
        { language: 'python',     scheme: 'file' },
        { language: 'swift',      scheme: 'file' },
      ],
      new FileDropEditProvider()
    )
  );

  // ── Language Model Tools (Copilot / AI agent tools) ─────────────────────
  // These are discoverable and invocable by AI agents inside VS Code ≥ 1.90.

  if (typeof vscode.lm !== 'undefined' && typeof (vscode.lm as unknown as Record<string, unknown>).registerTool === 'function') {
    registerLmTools(context);
  }
}

// ---------------------------------------------------------------------------
// Deactivation
// ---------------------------------------------------------------------------

export function deactivate(): void {
  // Terminate the cached Tesseract worker cleanly
  disposeWorker().catch(() => { /* ignore */ });
}

// ---------------------------------------------------------------------------
// Language Model Tool registration
// ---------------------------------------------------------------------------

function registerLmTools(context: vscode.ExtensionContext): void {
  // Using dynamic access to avoid compile-time errors on older VS Code types
  const lm = vscode.lm as unknown as {
    registerTool: (
      id: string,
      tool: {
        description: string;
        inputSchema: object;
        invoke: (
          opts: { input: Record<string, unknown> },
          token: vscode.CancellationToken
        ) => Promise<unknown>;
      }
    ) => vscode.Disposable;
  };

  // ── Tool 1: extract_text ────────────────────────────────────────────────
  const extractTool = lm.registerTool('codeplanner_extract_text', {
    description:
      'Extract text from an image file using Tesseract OCR. ' +
      'Returns the plain text content of the image, confidence score, and image dimensions. ' +
      'Supports PNG, JPEG, BMP, TIFF, GIF, WEBP. ' +
      'Multi-language: set lang to e.g. "eng+ara" for English and Arabic.',
    inputSchema: {
      type: 'object',
      properties: {
        imagePath: {
          type: 'string',
          description: 'Absolute file path to the image to analyze.'
        },
        lang: {
          type: 'string',
          description:
            'Tesseract language code(s), e.g. "eng", "ara", "chi_sim", "eng+ara". Defaults to "eng".'
        },
        tessDataPath: {
          type: 'string',
          description: 'Optional path to local tessdata directory (for offline environments).'
        }
      },
      required: ['imagePath']
    },
    invoke: async (opts, _token) => {
      const { imagePath, lang, tessDataPath } = opts.input as {
        imagePath: string;
        lang?: string;
        tessDataPath?: string;
      };

      const cfg = vscode.workspace.getConfiguration('codeplanner');
      const ocrOpts: OcrOptions = {
        language:     lang ?? cfg.get<string>('tesseractLanguage', 'eng'),
        tessDataPath: (tessDataPath ?? cfg.get<string>('tessDataPath', '')) || undefined
      };

      const result = await recognizeImage(imagePath, ocrOpts);

      const output = {
        text:        result.text,
        confidence:  result.confidence,
        imageWidth:  result.imageWidth,
        imageHeight: result.imageHeight
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(output, null, 2)
          }
        ]
      };
    }
  });

    context.subscriptions.push(extractTool);
}
