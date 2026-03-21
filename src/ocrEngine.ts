/**
 * OCR Engine — wraps Tesseract.js for image text extraction.
 *
 * A single Worker is kept alive for the lifetime of the extension to avoid
 * the ~3-5 second cold-start on every command invocation.  The worker is
 * recreated lazily when the configured language changes.
 */

import * as fs from 'fs';
import type { OcrOptions, OcrResult } from './types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createWorker } = require('tesseract.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { imageSize } = require('image-size');

interface TesseractWorker {
  recognize: (
    image: string,
    options?: Record<string, unknown>,
    output?: Record<string, boolean>
  ) => Promise<{ data: { text: string; tsv: string; confidence: number } }>;
  terminate: () => Promise<void>;
}

let _worker: TesseractWorker | null = null;
let _workerLanguage = '';

/** Returns a cached worker, recreating it when the language changes. */
async function getWorker(
  language: string,
  tessDataPath: string | undefined,
  verbose: boolean
): Promise<TesseractWorker> {
  if (_worker && _workerLanguage === language) {
    return _worker;
  }

  if (_worker) {
    await _worker.terminate();
    _worker = null;
  }

  const workerOptions: Record<string, unknown> = {
    logger: verbose
      ? (m: { status: string; progress: number }) => {
          if (m.progress !== undefined) {
            process.stdout.write(`\r[CodePlanner] ${m.status} ${Math.round(m.progress * 100)}%`);
          }
        }
      : undefined
  };

  if (tessDataPath && fs.existsSync(tessDataPath)) {
    workerOptions.langPath = tessDataPath;
  }

  _worker = await createWorker(language, 1, workerOptions);
  _workerLanguage = language;
  return _worker!;
}

/** Release the cached Tesseract worker. Call this on extension deactivate. */
export async function disposeWorker(): Promise<void> {
  if (_worker) {
    await _worker.terminate();
    _worker = null;
    _workerLanguage = '';
  }
}

/**
 * Main OCR function.  Accepts a file path to any image supported by Tesseract.
 */
export async function recognizeImage(
  imagePath: string,
  options: OcrOptions = {}
): Promise<OcrResult> {
  const language = options.language ?? 'eng';
  const verbose = options.verbose ?? false;

  const sourceImage = imagePath;

  // Read image dimensions cheaply from the file header (no full decode).
  let imageWidth = 0;
  let imageHeight = 0;
  try {
    const dims = imageSize(sourceImage) as { width?: number; height?: number };
    imageWidth  = dims.width  ?? 0;
    imageHeight = dims.height ?? 0;
  } catch {
    // Unusual format — dimensions will be estimated from TSV output
  }

  const worker = await getWorker(language, options.tessDataPath, verbose);

  const { data } = await worker.recognize(
    sourceImage,
    {},
    { text: true, tsv: true }
  );

  // Fallback: Tesseract does not directly expose image dims in v5 data;
  // parse from TSV if we didn't get them from Jimp.
  if (imageWidth === 0 || imageHeight === 0) {
    const dims = extractDimsFromTsv(data.tsv);
    imageWidth = dims.width;
    imageHeight = dims.height;
  }

  return {
    text: (data.text ?? '').trim(),
    tsv: data.tsv ?? '',
    confidence: data.confidence ?? 0,
    imageWidth,
    imageHeight
  };
}

/**
 * Fall-back: estimate image bounds from the maximum right/bottom coordinate
 * in the TSV word rows.
 */
function extractDimsFromTsv(tsv: string): { width: number; height: number } {
  let maxRight = 0;
  let maxBottom = 0;
  for (const line of tsv.split('\n').slice(1)) {
    const parts = line.split('\t');
    if (parts.length < 11) { continue; }
    const left = parseInt(parts[6], 10);
    const top = parseInt(parts[7], 10);
    const w = parseInt(parts[8], 10);
    const h = parseInt(parts[9], 10);
    if (!isNaN(left) && !isNaN(w)) { maxRight = Math.max(maxRight, left + w); }
    if (!isNaN(top) && !isNaN(h)) { maxBottom = Math.max(maxBottom, top + h); }
  }
  return { width: maxRight || 800, height: maxBottom || 600 };
}
