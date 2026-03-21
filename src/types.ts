/**
 * Shared TypeScript types for CodePlanner extension.
 */

export interface OcrResult {
  /** Plain extracted text. */
  text: string;
  /** Raw TSV output from Tesseract (contains per-word bounding boxes). */
  tsv: string;
  /** Overall average confidence (0–100). */
  confidence: number;
  /** Image width in pixels. */
  imageWidth: number;
  /** Image height in pixels. */
  imageHeight: number;
}

export interface OcrOptions {
  language?: string;
  tessDataPath?: string;
  /** Show console progress during OCR. */
  verbose?: boolean;
}
