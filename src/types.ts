/**
 * Shared TypeScript types for CodeVision extension.
 */

export interface BoundingBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * A single row from Tesseract TSV output.
 * level: 1=page | 2=block | 3=paragraph | 4=line | 5=word
 */
export interface TsvRow {
  level: number;
  pageNum: number;
  blockNum: number;
  parNum: number;
  lineNum: number;
  wordNum: number;
  left: number;
  top: number;
  width: number;
  height: number;
  conf: number;
  text: string;
}

/** A layout block aggregated from Tesseract TSV rows. */
export interface LayoutBlock {
  blockNum: number;
  bbox: BoundingBox;
  /** Concatenated text of all words in this block. */
  text: string;
  /** Average word bounding-box height (proxy for font size). */
  avgWordHeight: number;
  wordCount: number;
  type: BlockType;
}

export type BlockType =
  | 'header'
  | 'nav'
  | 'heading'
  | 'paragraph'
  | 'sidebar'
  | 'button'
  | 'footer'
  | 'list'
  | 'image_placeholder'
  | 'unknown';

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

export interface WireframeOptions {
  /** 'svg' | 'ascii' | 'html' */
  format?: 'svg' | 'ascii' | 'html';
}

export interface WireframeResult {
  /** SVG markup string. */
  svg: string;
  /** ASCII art wireframe. */
  ascii: string;
  /** Self-contained HTML with embedded SVG + extracted text. */
  html: string;
  blocks: LayoutBlock[];
  imageWidth: number;
  imageHeight: number;
}
