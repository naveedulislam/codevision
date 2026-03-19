/**
 * CodeVision Extension — main activation entry point.
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
  cmdGenerateWireframe,
  cmdAnalyzeImage,
  cmdAnalyzeActiveImage,
  cmdCaptureScreenshot
} from './commands';
import { recognizeImage } from './ocrEngine';
import { generateWireframe } from './wireframeGenerator';
import type { OcrOptions } from './types';

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
  // ── Command Palette commands ────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('codevision.extractText', (uri?: vscode.Uri) =>
      cmdExtractText(context, uri)
    ),

    vscode.commands.registerCommand('codevision.extractTextFromClipboard', () =>
      cmdExtractTextFromClipboard(context)
    ),

    vscode.commands.registerCommand('codevision.generateWireframe', (uri?: vscode.Uri) =>
      cmdGenerateWireframe(context, uri)
    ),

    vscode.commands.registerCommand('codevision.analyzeImage', (uri?: vscode.Uri) =>
      cmdAnalyzeImage(context, uri)
    ),

    vscode.commands.registerCommand('codevision.analyzeActiveImage', () =>
      cmdAnalyzeActiveImage(context)
    ),

    // Context-menu wrappers (pass the URI from the explorer)
    vscode.commands.registerCommand('codevision.extractTextFromUri', (uri: vscode.Uri) =>
      cmdExtractText(context, uri)
    ),

    vscode.commands.registerCommand('codevision.generateWireframeFromUri', (uri: vscode.Uri) =>
      cmdGenerateWireframe(context, uri)
    ),

    vscode.commands.registerCommand('codevision.captureScreenshot', () =>
      cmdCaptureScreenshot(context)
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
  const extractTool = lm.registerTool('codevision_extract_text', {
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

      const cfg = vscode.workspace.getConfiguration('codevision');
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

  // ── Tool 2: generate_wireframe ──────────────────────────────────────────
  const wireframeTool = lm.registerTool('codevision_generate_wireframe', {
    description:
      'Analyze an image using OCR and generate a structured wireframe that describes the spatial ' +
      'layout as labelled blocks (header, nav, paragraph, sidebar, button, footer, heading). ' +
      'Returns extracted text, block metadata (type, bounding box, text), and an SVG wireframe. ' +
      'Ideal for converting UI screenshots into structured context for code generation.',
    inputSchema: {
      type: 'object',
      properties: {
        imagePath: {
          type: 'string',
          description: 'Absolute file path to the image to analyze.'
        },
        lang: {
          type: 'string',
          description: 'Tesseract language code(s). Defaults to "eng".'
        },
        format: {
          type: 'string',
          enum: ['svg', 'ascii', 'html'],
          description:
            'Wireframe output format. "svg" = scalable graphic (default), ' +
            '"ascii" = plain-text grid, "html" = self-contained HTML page.'
        }
      },
      required: ['imagePath']
    },
    invoke: async (opts, _token) => {
      const { imagePath, lang, format } = opts.input as {
        imagePath: string;
        lang?: string;
        format?: 'svg' | 'ascii' | 'html';
      };

      const cfg = vscode.workspace.getConfiguration('codevision');
      const ocrOpts: OcrOptions = {
        language: lang ?? cfg.get<string>('tesseractLanguage', 'eng'),
        tessDataPath: cfg.get<string>('tessDataPath', '') || undefined
      };

      const ocr = await recognizeImage(imagePath, ocrOpts);
      const wf  = generateWireframe(ocr);

      const chosenFormat = format ?? 'svg';
      const wireframeContent =
        chosenFormat === 'ascii' ? wf.ascii :
        chosenFormat === 'html'  ? wf.html  : wf.svg;

      const blockSummary = wf.blocks.map(b => ({
        type:      b.type,
        text:      b.text.slice(0, 100),
        bbox:      b.bbox,
        wordCount: b.wordCount
      }));

      const output = {
        extractedText: ocr.text,
        confidence:    ocr.confidence,
        imageWidth:    ocr.imageWidth,
        imageHeight:   ocr.imageHeight,
        blocksDetected: wf.blocks.length,
        blocks:        blockSummary,
        wireframe:     wireframeContent
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

  context.subscriptions.push(extractTool, wireframeTool);
}
