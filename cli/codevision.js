#!/usr/bin/env node
/**
 * CodeVision CLI
 *
 * Standalone command-line tool for OCR and wireframe generation.
 * Can be used directly from any terminal (also by AI agents in the integrated terminal).
 *
 * Usage:
 *   node codevision.js <command> [options] <imagePath>
 *
 * Commands:
 *   ocr        Extract text from an image
 *   wireframe  Generate a wireframe from an image
 *   analyze    Do both (OCR + wireframe) and save all outputs
 *
 * Options:
 *   --lang <code>          Tesseract language(s), e.g. eng, ara, eng+ara  (default: eng)
 *   --format <fmt>         Wireframe format: svg | ascii | html            (default: svg)
 *   --output <path>        Write result to this file instead of stdout
 *   --tessdata <dir>       Path to local tessdata directory (offline mode)
 *   --json                 Output OCR result as JSON
 *   --verbose              Show Tesseract progress
 *   --help                 Show this help message
 *
 * Examples:
 *   node codevision.js ocr screenshot.png
 *   node codevision.js ocr screenshot.png --lang eng+ara --output result.txt
 *   node codevision.js wireframe screenshot.png --format svg --output wireframe.svg
 *   node codevision.js analyze screenshot.png --output-dir ./output
 */

'use strict';

const path  = require('path');
const fs    = require('fs');
const os    = require('os');

// ---------------------------------------------------------------------------
// Argument parsing (no external deps)
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const result = {
    command:    null,
    imagePath:  null,
    lang:       'eng',
    format:     'svg',
    output:     null,
    outputDir:  null,
    tessdata:   null,
    json:       false,
    verbose:    false,
    help:       false
  };

  let i = 2;
  const remaining = [];

  while (i < argv.length) {
    const arg = argv[i];
    switch (arg) {
      case '--lang':
        result.lang = argv[++i]; break;
      case '--format':
        result.format = argv[++i]; break;
      case '--output':
        result.output = argv[++i]; break;
      case '--output-dir':
        result.outputDir = argv[++i]; break;
      case '--tessdata':
        result.tessdata = argv[++i]; break;
      case '--json':
        result.json = true; break;
      case '--verbose':
        result.verbose = true; break;
      case '--help':
      case '-h':
        result.help = true; break;
      default:
        remaining.push(arg);
    }
    i++;
  }

  if (remaining[0]) { result.command   = remaining[0]; }
  if (remaining[1]) { result.imagePath = path.resolve(remaining[1]); }

  return result;
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`
CodeVision CLI — OCR and wireframe generation for images

USAGE
  node codevision.js <command> [options] <imagePath>

COMMANDS
  ocr        Extract text from an image using Tesseract OCR
  wireframe  Generate a layout wireframe (SVG / ASCII / HTML)
  analyze    Extract text AND generate wireframe, save all output files

OPTIONS
  --lang <code>       Tesseract language code(s)  [default: eng]
                      Multi-language: eng+ara, eng+chi_sim, etc.
  --format <fmt>      Wireframe format: svg | ascii | html  [default: svg]
  --output <path>     Write result to file instead of stdout
  --output-dir <dir>  (analyze) Directory to write all output files
  --tessdata <dir>    Path to local tessdata dir (for offline environments)
  --json              OCR: output result as JSON with metadata
  --verbose           Show Tesseract progress messages
  --help, -h          Show this help

EXAMPLES
  node codevision.js ocr screenshot.png
  node codevision.js ocr screenshot.png --lang eng+ara --output text.txt
  node codevision.js wireframe ui.png --format svg --output ui.svg
  node codevision.js wireframe ui.png --format ascii
  node codevision.js analyze ui.png --output-dir ./cv-output
  `.trimStart());
}

// ---------------------------------------------------------------------------
// OCR
// ---------------------------------------------------------------------------

async function runOcr(args) {
  const { createWorker } = require('tesseract.js');
  const { imageSize } = require('image-size');

  if (!args.imagePath || !fs.existsSync(args.imagePath)) {
    console.error(`[CodeVision] Error: image not found: ${args.imagePath}`);
    process.exit(1);
  }

  const sourceImage = args.imagePath;

  // Read image dimensions cheaply from the file header (no full-image decode)
  let imageWidth = 0, imageHeight = 0;
  try {
    const dims = imageSize(sourceImage);
    imageWidth  = dims.width  ?? 0;
    imageHeight = dims.height ?? 0;
  } catch { /* ignore — will estimate from TSV */ }

  const workerOpts = {};
  if (args.tessdata && fs.existsSync(args.tessdata)) {
    workerOpts.langPath = args.tessdata;
  }
  if (args.verbose) {
    workerOpts.logger = (m) => {
      if (m.progress !== undefined) {
        process.stderr.write(`\r[CodeVision] ${m.status} ${Math.round(m.progress * 100)}%`);
      }
    };
  }

  const worker = await createWorker(args.lang, 1, workerOpts);
  const { data } = await worker.recognize(sourceImage, {}, { text: true, tsv: true });
  await worker.terminate();

  if (args.verbose) { process.stderr.write('\n'); }

  return {
    text:        (data.text || '').trim(),
    tsv:          data.tsv || '',
    confidence:  data.confidence || 0,
    imageWidth,
    imageHeight
  };
}

// ---------------------------------------------------------------------------
// Wireframe generation (mirrors the TypeScript implementation)
// ---------------------------------------------------------------------------

const BLOCK_STYLES = {
  header:  { fill: '#dbeafe', stroke: '#1d4ed8', text: '#1d4ed8' },
  nav:     { fill: '#dcfce7', stroke: '#15803d', text: '#15803d' },
  heading: { fill: '#ede9fe', stroke: '#6d28d9', text: '#6d28d9' },
  paragraph: { fill: '#fef9c3', stroke: '#a16207', text: '#a16207' },
  sidebar: { fill: '#fce7f3', stroke: '#be185d', text: '#be185d' },
  button:  { fill: '#fee2e2', stroke: '#b91c1c', text: '#b91c1c' },
  footer:  { fill: '#f3f4f6', stroke: '#6b7280', text: '#6b7280' },
  list:    { fill: '#ecfdf5', stroke: '#059669', text: '#059669' },
  image_placeholder: { fill: '#e0f2fe', stroke: '#0369a1', text: '#0369a1' },
  unknown: { fill: '#f9fafb', stroke: '#9ca3af', text: '#9ca3af' }
};

function parseTsv(tsv) {
  return tsv.split('\n').slice(1).filter(Boolean).map(line => {
    const p = line.split('\t');
    if (p.length < 12) { return null; }
    return {
      level:    parseInt(p[0], 10),
      blockNum: parseInt(p[2], 10),
      parNum:   parseInt(p[3], 10),
      lineNum:  parseInt(p[4], 10),
      left:     parseInt(p[6], 10),
      top:      parseInt(p[7], 10),
      width:    parseInt(p[8], 10),
      height:   parseInt(p[9], 10),
      conf:     parseFloat(p[10]),
      text:     p.slice(11).join('\t')
    };
  }).filter(Boolean);
}

function classifyBlock(bbox, avgH, wordCount, imgW, imgH) {
  const bw  = bbox.x1 - bbox.x0;
  const bh  = bbox.y1 - bbox.y0;
  const relY = bbox.y0 / imgH;
  const relW = bw / imgW;

  if (relY > 0.92)  { return 'footer'; }
  if (relY < 0.12) {
    if (avgH > 22) { return 'header'; }
    if (relW > 0.6 && bh < imgH * 0.06) { return 'nav'; }
    return relW > 0.5 ? 'header' : 'nav';
  }
  // Relative heading threshold (3% of image height, min 30 px) reduces false
  // positives from normally-sized sketch text (median word height ~24 px).
  const headingThreshold = Math.max(30, imgH * 0.03);
  if (avgH > headingThreshold) { return 'heading'; }
  // Button check after heading so single-word headings aren't mis-classified
  if (wordCount <= 4 && bw < imgW * 0.25 && bh < imgH * 0.06) { return 'button'; }
  if (relW < 0.28 && (bbox.x0 > imgW * 0.65 || bbox.x1 < imgW * 0.35)) { return 'sidebar'; }
  if (relW > 0.55) { return 'paragraph'; }
  return 'unknown';
}

function buildBlocks(tsv, imgW, imgH) {
  const rows   = parseTsv(tsv);
  const map    = new Map();
  let seqId    = 0;

  for (const row of rows) {
    if (row.level !== 5 || !row.text.trim() || row.conf < 0) { continue; }
    // Group at line level so each detected text line is its own wireframe block
    const key = `${row.blockNum}_${row.parNum}_${row.lineNum}`;
    if (!map.has(key)) {
      map.set(key, {
        blockNum: ++seqId, words: [],
        bbox: { x0: row.left, y0: row.top, x1: row.left + row.width, y1: row.top + row.height },
        totalHeight: 0
      });
    }
    const b = map.get(key);
    b.words.push(row);
    b.totalHeight += row.height;
    b.bbox.x0 = Math.min(b.bbox.x0, row.left);
    b.bbox.y0 = Math.min(b.bbox.y0, row.top);
    b.bbox.x1 = Math.max(b.bbox.x1, row.left + row.width);
    b.bbox.y1 = Math.max(b.bbox.y1, row.top + row.height);
  }

  const blocks = [];
  for (const [, raw] of map) {
    if (!raw.words.length) { continue; }
    const avgH = raw.totalHeight / raw.words.length;
    const text = raw.words.map(w => w.text).join(' ');
    blocks.push({
      blockNum: raw.blockNum,
      bbox: raw.bbox,
      text,
      avgWordHeight: avgH,
      wordCount: raw.words.length,
      type: classifyBlock(raw.bbox, avgH, raw.words.length, imgW, imgH)
    });
  }
  return blocks.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
           .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 3) + '...' : s;
}

function buildSvg(blocks, imgW, imgH) {
  const W = Math.min(1200, Math.max(600, imgW));
  const H = Math.round(W * (imgH / imgW));
  const scale = W / imgW;

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`,
    `  <rect width="${W}" height="${H}" fill="white" stroke="#d1d5db" stroke-width="2"/>`
  ];

  for (const b of blocks) {
    const x = Math.round(b.bbox.x0 * scale);
    const y = Math.round(b.bbox.y0 * scale);
    const w = Math.max(20, Math.round((b.bbox.x1 - b.bbox.x0) * scale));
    const h = Math.max(12, Math.round((b.bbox.y1 - b.bbox.y0) * scale));
    const st = BLOCK_STYLES[b.type] || BLOCK_STYLES.unknown;
    const fs = Math.max(8, Math.min(13, Math.round(h * 0.28)));
    const mx = x + w / 2, my = y + h / 2;
    const label = `[${b.type.toUpperCase()}]`;
    const content = escapeXml(truncate(b.text, 70));
    parts.push(
      `  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${st.fill}" stroke="${st.stroke}" stroke-width="1.5" rx="3" opacity="0.9"/>`,
      `  <text x="${mx}" y="${my - fs * 0.6}" text-anchor="middle" dominant-baseline="middle" font-size="${fs}" font-weight="bold" fill="${st.text}" font-family="ui-sans-serif,sans-serif">${label}</text>`,
      `  <text x="${mx}" y="${my + fs * 0.8}" text-anchor="middle" dominant-baseline="middle" font-size="${Math.max(7, fs - 2)}" fill="${st.text}" font-family="ui-monospace,monospace" opacity="0.85">${content}</text>`
    );
  }

  parts.push(
    `  <text x="8" y="${H - 10}" font-size="9" fill="#6b7280" font-family="ui-sans-serif,sans-serif">CodeVision CLI · ${blocks.length} blocks</text>`,
    '</svg>'
  );
  return parts.join('\n');
}

function buildAscii(blocks, imgW, imgH, cols = 100, rows = 40) {
  const grid = Array.from({ length: rows }, () => Array(cols).fill(' '));
  const sx = cols / imgW, sy = rows / imgH;

  for (const b of blocks) {
    const c0 = Math.max(0, Math.floor(b.bbox.x0 * sx));
    const r0 = Math.max(0, Math.floor(b.bbox.y0 * sy));
    const c1 = Math.min(cols - 1, Math.floor(b.bbox.x1 * sx));
    const r1 = Math.min(rows - 1, Math.floor(b.bbox.y1 * sy));

    for (let c = c0; c <= c1; c++) {
      if (r0 < rows) grid[r0][c] = '-';
      if (r1 < rows) grid[r1][c] = '-';
    }
    for (let r = r0; r <= r1; r++) {
      if (r < rows) {
        if (c0 < cols) grid[r][c0] = '|';
        if (c1 < cols) grid[r][c1] = '|';
      }
    }
    const lr = Math.round((r0 + r1) / 2);
    const lbl = `[${b.type.toUpperCase()}] ${truncate(b.text, c1 - c0 - 4)}`;
    for (let ci = 0; ci < lbl.length && c0 + 2 + ci < c1; ci++) {
      if (lr >= 0 && lr < rows) grid[lr][c0 + 2 + ci] = lbl[ci];
    }
  }
  return grid.map(r => r.join('')).join('\n');
}

function buildHtml(svg, blocks, ocrText, imgW, imgH) {
  const rows = blocks.map(b =>
    `<tr><td>${b.blockNum}</td><td><strong>${b.type}</strong></td><td>${escapeXml(truncate(b.text, 120))}</td></tr>`
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
  <p class="meta">Image: ${imgW}×${imgH}px &nbsp;·&nbsp; ${blocks.length} layout blocks</p>
  <div class="grid">
    <div class="card"><h2>Wireframe</h2>${svg}</div>
    <div class="card"><h2>Extracted Text</h2><pre>${escapeXml(ocrText)}</pre></div>
  </div>
  <div class="card" style="margin-top:16px;">
    <h2>Block Details</h2>
    <table><thead><tr><th>#</th><th>Type</th><th>Text (truncated)</th></tr></thead>
    <tbody>${rows}</tbody></table>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function writeOutput(content, outputPath) {
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, content, 'utf8');
    console.error(`[CodeVision] Saved → ${outputPath}`);
  } else {
    process.stdout.write(content);
    if (!content.endsWith('\n')) { process.stdout.write('\n'); }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  if (args.help || !args.command) {
    printHelp();
    process.exit(0);
  }

  if (!['ocr', 'wireframe', 'analyze'].includes(args.command)) {
    console.error(`[CodeVision] Unknown command: ${args.command}`);
    printHelp();
    process.exit(1);
  }

  if (!args.imagePath) {
    console.error('[CodeVision] Error: imagePath argument is required.');
    printHelp();
    process.exit(1);
  }

  if (!fs.existsSync(args.imagePath)) {
    console.error(`[CodeVision] Error: file not found: ${args.imagePath}`);
    process.exit(1);
  }

  // Check deps
  try {
    require.resolve('tesseract.js');
    require.resolve('image-size');
  } catch (e) {
    console.error(
      '[CodeVision] Missing dependencies. Run:\n  npm install tesseract.js image-size\n' +
      'in the extension directory or your project.'
    );
    process.exit(1);
  }

  try {
    if (args.command === 'ocr') {
      const result = await runOcr(args);
      if (args.json) {
        writeOutput(JSON.stringify({
          text:       result.text,
          confidence: result.confidence,
          imageWidth: result.imageWidth,
          imageHeight: result.imageHeight
        }, null, 2), args.output);
      } else {
        writeOutput(result.text, args.output);
      }

    } else if (args.command === 'wireframe') {
      const result  = await runOcr(args);
      const blocks  = buildBlocks(result.tsv, result.imageWidth, result.imageHeight);
      let content;
      let defaultExt;

      if (args.format === 'ascii') {
        content    = buildAscii(blocks, result.imageWidth, result.imageHeight);
        defaultExt = '.txt';
      } else if (args.format === 'html') {
        content    = buildHtml(buildSvg(blocks, result.imageWidth, result.imageHeight), blocks, result.text, result.imageWidth, result.imageHeight);
        defaultExt = '.html';
      } else {
        content    = buildSvg(blocks, result.imageWidth, result.imageHeight);
        defaultExt = '.svg';
      }

      const outPath = args.output;
      writeOutput(content, outPath);

    } else if (args.command === 'analyze') {
      const result = await runOcr(args);
      const blocks = buildBlocks(result.tsv, result.imageWidth, result.imageHeight);
      const svg    = buildSvg(blocks, result.imageWidth, result.imageHeight);
      const ascii  = buildAscii(blocks, result.imageWidth, result.imageHeight);
      const html   = buildHtml(svg, blocks, result.text, result.imageWidth, result.imageHeight);

      const outDir = args.outputDir ?? path.dirname(args.imagePath);
      const base   = path.basename(args.imagePath, path.extname(args.imagePath));
      fs.mkdirSync(outDir, { recursive: true });

      const txtPath   = path.join(outDir, `${base}_ocr.txt`);
      const svgPath   = path.join(outDir, `${base}_wireframe.svg`);
      const asciiPath = path.join(outDir, `${base}_wireframe.txt`);
      const htmlPath  = path.join(outDir, `${base}_analysis.html`);

      fs.writeFileSync(txtPath,   result.text, 'utf8');
      fs.writeFileSync(svgPath,   svg,         'utf8');
      fs.writeFileSync(asciiPath, ascii,       'utf8');
      fs.writeFileSync(htmlPath,  html,        'utf8');

      if (args.json) {
        const summary = {
          text:       result.text,
          confidence: result.confidence,
          imageWidth: result.imageWidth,
          imageHeight: result.imageHeight,
          blocksDetected: blocks.length,
          outputs: { txt: txtPath, svg: svgPath, ascii: asciiPath, html: htmlPath }
        };
        process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
      } else {
        console.log(`[CodeVision] Analysis complete:`);
        console.log(`  Text       → ${txtPath}`);
        console.log(`  SVG        → ${svgPath}`);
        console.log(`  ASCII      → ${asciiPath}`);
        console.log(`  HTML       → ${htmlPath}`);
        console.log(`  Confidence : ${result.confidence.toFixed(1)}%`);
        console.log(`  Blocks     : ${blocks.length}`);
      }
    }
  } catch (err) {
    console.error(`[CodeVision] Error: ${err.message || err}`);
    if (args.verbose) { console.error(err.stack); }
    process.exit(1);
  }
}

main();
