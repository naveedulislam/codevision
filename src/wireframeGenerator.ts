/**
 * Wireframe Generator
 *
 * Parses Tesseract TSV output to reconstruct the spatial layout of an image
 * and converts it into:
 *   - An SVG wireframe (coloured, labelled rectangles per block)
 *   - An ASCII wireframe
 *   - A self-contained HTML combining both with the extracted text
 */

import type {
  TsvRow,
  LayoutBlock,
  BlockType,
  BoundingBox,
  OcrResult,
  WireframeOptions,
  WireframeResult
} from './types';

// ---------------------------------------------------------------------------
// TSV parsing
// ---------------------------------------------------------------------------

function parseTsv(tsv: string): TsvRow[] {
  const lines = tsv.split('\n');
  const rows: TsvRow[] = [];

  // First line is the header; skip it
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) { continue; }
    const parts = line.split('\t');
    if (parts.length < 12) { continue; }
    const row: TsvRow = {
      level: parseInt(parts[0], 10),
      pageNum: parseInt(parts[1], 10),
      blockNum: parseInt(parts[2], 10),
      parNum: parseInt(parts[3], 10),
      lineNum: parseInt(parts[4], 10),
      wordNum: parseInt(parts[5], 10),
      left: parseInt(parts[6], 10),
      top: parseInt(parts[7], 10),
      width: parseInt(parts[8], 10),
      height: parseInt(parts[9], 10),
      conf: parseFloat(parts[10]),
      // Join remaining parts (text may contain tabs in edge cases)
      text: parts.slice(11).join('\t')
    };
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Block aggregation
// ---------------------------------------------------------------------------

function aggregateBlocks(rows: TsvRow[]): Map<string, {
  blockNum: number;
  words: TsvRow[];
  bbox: BoundingBox;
  totalHeight: number;
}> {
  const blocks = new Map<string, {
    blockNum: number;
    words: TsvRow[];
    bbox: BoundingBox;
    totalHeight: number;
  }>();

  for (const row of rows) {
    // Only pick up word-level rows with actual text
    if (row.level !== 5 || !row.text.trim() || row.conf < 0) { continue; }

    const key = String(row.blockNum);
    if (!blocks.has(key)) {
      blocks.set(key, {
        blockNum: row.blockNum,
        words: [],
        bbox: { x0: row.left, y0: row.top, x1: row.left + row.width, y1: row.top + row.height },
        totalHeight: 0
      });
    }

    const block = blocks.get(key)!;
    block.words.push(row);
    block.totalHeight += row.height;

    // Expand bounding box to encompass this word
    block.bbox.x0 = Math.min(block.bbox.x0, row.left);
    block.bbox.y0 = Math.min(block.bbox.y0, row.top);
    block.bbox.x1 = Math.max(block.bbox.x1, row.left + row.width);
    block.bbox.y1 = Math.max(block.bbox.y1, row.top + row.height);
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Block type classification (heuristic)
// ---------------------------------------------------------------------------

function classifyBlock(
  bbox: BoundingBox,
  avgWordHeight: number,
  wordCount: number,
  imageWidth: number,
  imageHeight: number
): BlockType {
  const blockWidth  = bbox.x1 - bbox.x0;
  const blockHeight = bbox.y1 - bbox.y0;
  const relY        = bbox.y0 / imageHeight;
  const relWidth    = blockWidth / imageWidth;

  // Footer zone: bottom 8%
  if (relY > 0.92) { return 'footer'; }

  // Top 12% of the page
  if (relY < 0.12) {
    if (avgWordHeight > 22) { return 'header'; }
    // Wide shallow strip near top → navigation bar
    if (relWidth > 0.6 && blockHeight < imageHeight * 0.06) { return 'nav'; }
    return relWidth > 0.5 ? 'header' : 'nav';
  }

  // Large font mid-page → section heading
  if (avgWordHeight > 22) { return 'heading'; }

  // Very few words in a small area → button
  if (wordCount <= 4 && blockWidth < imageWidth * 0.25 && blockHeight < imageHeight * 0.06) {
    return 'button';
  }

  // Narrow column on either side → sidebar
  if (relWidth < 0.28 && (bbox.x0 > imageWidth * 0.65 || bbox.x1 < imageWidth * 0.35)) {
    return 'sidebar';
  }

  // Wide block → main content paragraph
  if (relWidth > 0.55) { return 'paragraph'; }

  return 'unknown';
}

// ---------------------------------------------------------------------------
// Build LayoutBlock list
// ---------------------------------------------------------------------------

export function buildLayoutBlocks(
  tsv: string,
  imageWidth: number,
  imageHeight: number
): LayoutBlock[] {
  const rows   = parseTsv(tsv);
  const rawMap = aggregateBlocks(rows);
  const blocks: LayoutBlock[] = [];

  for (const [, raw] of rawMap) {
    if (raw.words.length === 0) { continue; }

    const avgWordHeight = raw.totalHeight / raw.words.length;
    const text = raw.words.map(w => w.text).join(' ');
    const type = classifyBlock(raw.bbox, avgWordHeight, raw.words.length, imageWidth, imageHeight);

    blocks.push({
      blockNum: raw.blockNum,
      bbox: raw.bbox,
      text,
      avgWordHeight,
      wordCount: raw.words.length,
      type
    });
  }

  // Sort top-to-bottom, left-to-right for logical reading order
  blocks.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  return blocks;
}

// ---------------------------------------------------------------------------
// SVG generation
// ---------------------------------------------------------------------------

const BLOCK_STYLES: Record<BlockType, { fill: string; stroke: string; text: string }> = {
  header:            { fill: '#dbeafe', stroke: '#1d4ed8', text: '#1d4ed8' },
  nav:               { fill: '#dcfce7', stroke: '#15803d', text: '#15803d' },
  heading:           { fill: '#ede9fe', stroke: '#6d28d9', text: '#6d28d9' },
  paragraph:         { fill: '#fef9c3', stroke: '#a16207', text: '#a16207' },
  sidebar:           { fill: '#fce7f3', stroke: '#be185d', text: '#be185d' },
  button:            { fill: '#fee2e2', stroke: '#b91c1c', text: '#b91c1c' },
  footer:            { fill: '#f3f4f6', stroke: '#6b7280', text: '#6b7280' },
  list:              { fill: '#ecfdf5', stroke: '#059669', text: '#059669' },
  image_placeholder: { fill: '#e0f2fe', stroke: '#0369a1', text: '#0369a1' },
  unknown:           { fill: '#f9fafb', stroke: '#9ca3af', text: '#9ca3af' }
};

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen - 3) + '...' : s;
}

export function buildSvg(
  blocks: LayoutBlock[],
  imageWidth: number,
  imageHeight: number
): string {
  const SVG_WIDTH = Math.min(1200, Math.max(600, imageWidth));
  const SVG_HEIGHT = Math.round(SVG_WIDTH * (imageHeight / imageWidth));
  const scale = SVG_WIDTH / imageWidth;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" width="${SVG_WIDTH}" height="${SVG_HEIGHT}">`,
    `  <rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="white" stroke="#d1d5db" stroke-width="2"/>`,
    `  <!-- Generated by CodeVision — block count: ${blocks.length} -->`
  ];

  for (const block of blocks) {
    const x = Math.round(block.bbox.x0 * scale);
    const y = Math.round(block.bbox.y0 * scale);
    const w = Math.max(20, Math.round((block.bbox.x1 - block.bbox.x0) * scale));
    const h = Math.max(12, Math.round((block.bbox.y1 - block.bbox.y0) * scale));
    const { fill, stroke, text: textColor } = BLOCK_STYLES[block.type];
    const label = `[${block.type.toUpperCase()}]`;
    const content = escapeXml(truncate(block.text, 70));
    const fontSize = Math.max(8, Math.min(13, Math.round(h * 0.28)));
    const midX = x + w / 2;
    const midY = y + h / 2;

    parts.push(
      `  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" rx="3" opacity="0.9"/>`,
      `  <text x="${midX}" y="${midY - fontSize * 0.6}" text-anchor="middle" dominant-baseline="middle" font-size="${fontSize}" font-weight="bold" fill="${textColor}" font-family="ui-sans-serif,sans-serif">${label}</text>`,
      `  <text x="${midX}" y="${midY + fontSize * 0.8}" text-anchor="middle" dominant-baseline="middle" font-size="${Math.max(7, fontSize - 2)}" fill="${textColor}" font-family="ui-monospace,monospace" opacity="0.85">${content}</text>`
    );
  }

  // Legend
  const legendY = SVG_HEIGHT - 10;
  parts.push(
    `  <text x="8" y="${legendY}" font-size="9" fill="#6b7280" font-family="ui-sans-serif,sans-serif">CodeVision Wireframe · ${blocks.length} blocks detected</text>`
  );

  parts.push('</svg>');
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// ASCII wireframe
// ---------------------------------------------------------------------------

const ASCII_COLS = 100;
const ASCII_ROWS = 40;

export function buildAscii(
  blocks: LayoutBlock[],
  imageWidth: number,
  imageHeight: number
): string {
  const grid: string[][] = Array.from({ length: ASCII_ROWS }, () =>
    Array(ASCII_COLS).fill(' ')
  );

  const scaleX = ASCII_COLS / imageWidth;
  const scaleY = ASCII_ROWS / imageHeight;

  for (const block of blocks) {
    const col0 = Math.max(0, Math.floor(block.bbox.x0 * scaleX));
    const row0 = Math.max(0, Math.floor(block.bbox.y0 * scaleY));
    const col1 = Math.min(ASCII_COLS - 1, Math.floor(block.bbox.x1 * scaleX));
    const row1 = Math.min(ASCII_ROWS - 1, Math.floor(block.bbox.y1 * scaleY));

    // Draw border
    for (let c = col0; c <= col1; c++) {
      if (row0 < ASCII_ROWS) { grid[row0][c] = '-'; }
      if (row1 < ASCII_ROWS) { grid[row1][c] = '-'; }
    }
    for (let r = row0; r <= row1; r++) {
      if (r < ASCII_ROWS) {
        if (col0 < ASCII_COLS) { grid[r][col0] = '|'; }
        if (col1 < ASCII_COLS) { grid[r][col1] = '|'; }
      }
    }
    // Label inside box
    const labelRow = Math.round((row0 + row1) / 2);
    const labelStr = `[${block.type.toUpperCase()}] ${truncate(block.text, col1 - col0 - 4)}`;
    const startCol = col0 + 2;
    for (let i = 0; i < labelStr.length && startCol + i < col1; i++) {
      if (labelRow >= 0 && labelRow < ASCII_ROWS) {
        grid[labelRow][startCol + i] = labelStr[i];
      }
    }
  }

  return grid.map(row => row.join('')).join('\n');
}

// ---------------------------------------------------------------------------
// Self-contained HTML output
// ---------------------------------------------------------------------------

export function buildHtml(
  svg: string,
  blocks: LayoutBlock[],
  ocrText: string,
  imageWidth: number,
  imageHeight: number
): string {
  const blockRows = blocks.map(b =>
    `<tr>
      <td>${b.blockNum}</td>
      <td><strong>${b.type}</strong></td>
      <td>${escapeXml(truncate(b.text, 120))}</td>
    </tr>`
  ).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CodeVision Analysis</title>
  <style>
    body { font-family: ui-sans-serif, sans-serif; margin: 0; padding: 16px; background: #f8fafc; color: #1e293b; }
    h1 { font-size: 1.4rem; margin-bottom: 4px; }
    .meta { color: #64748b; font-size: 0.85rem; margin-bottom: 16px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .card { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
    .card h2 { font-size: 1rem; margin: 0 0 12px; color: #475569; }
    svg { max-width: 100%; height: auto; border: 1px solid #e2e8f0; border-radius: 4px; }
    pre { white-space: pre-wrap; word-break: break-word; font-size: 0.85rem; max-height: 400px; overflow-y: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e2e8f0; }
    th { background: #f1f5f9; }
    @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <h1>CodeVision Analysis</h1>
  <p class="meta">Image: ${imageWidth}×${imageHeight}px &nbsp;·&nbsp; ${blocks.length} layout blocks detected</p>
  <div class="grid">
    <div class="card">
      <h2>Wireframe</h2>
      ${svg}
    </div>
    <div class="card">
      <h2>Extracted Text</h2>
      <pre>${escapeXml(ocrText)}</pre>
    </div>
  </div>
  <div class="card" style="margin-top:16px;">
    <h2>Block Details</h2>
    <table>
      <thead><tr><th>#</th><th>Type</th><th>Text (truncated)</th></tr></thead>
      <tbody>${blockRows}</tbody>
    </table>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main entry-point
// ---------------------------------------------------------------------------

export function generateWireframe(
  ocr: OcrResult,
  options: WireframeOptions = {}
): WireframeResult {
  const { imageWidth, imageHeight, tsv, text } = ocr;
  const blocks = buildLayoutBlocks(tsv, imageWidth, imageHeight);
  const svg    = buildSvg(blocks, imageWidth, imageHeight);
  const ascii  = buildAscii(blocks, imageWidth, imageHeight);
  const html   = buildHtml(svg, blocks, text, imageWidth, imageHeight);

  return { svg, ascii, html, blocks, imageWidth, imageHeight };
}
