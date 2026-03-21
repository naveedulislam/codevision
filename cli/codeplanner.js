#!/usr/bin/env node
/**
 * CodePlanner CLI
 *
 * Standalone command-line tool for OCR and wireframe generation.
 * Can be used directly from any terminal (also by AI agents in the integrated terminal).
 *
 * Usage:
 *   node codeplanner.js <command> [options] <imagePath>
 *
 * Options:
 *   --lang <code>    Tesseract language(s), e.g. eng, ara, eng+ara  (default: eng)
 *   --output <path>  Write result to this file instead of stdout
 *   --tessdata <dir> Path to local tessdata directory (offline mode)
 *   --json           Output OCR result as JSON
 *   --verbose        Show Tesseract progress
 *   --help           Show this help message
 *
 * Examples:
 *   node codeplanner.js ocr screenshot.png
 *   node codeplanner.js ocr screenshot.png --lang eng+ara --output result.txt
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
CodePlanner CLI — OCR text extraction from images

USAGE
  node codeplanner.js ocr [options] <imagePath>

OPTIONS
  --lang <code>    Tesseract language code(s)  [default: eng]
                   Multi-language: eng+ara, eng+chi_sim, etc.
  --output <path>  Write result to file instead of stdout
  --tessdata <dir> Path to local tessdata dir (for offline environments)
  --json           Output result as JSON with metadata
  --verbose        Show Tesseract progress messages
  --help, -h       Show this help

EXAMPLES
  node codeplanner.js ocr screenshot.png
  node codeplanner.js ocr screenshot.png --lang eng+ara --output text.txt
  `.trimStart());
}

// ---------------------------------------------------------------------------
// OCR
// ---------------------------------------------------------------------------

async function runOcr(args) {
  const { createWorker } = require('tesseract.js');
  const { imageSize } = require('image-size');

  if (!args.imagePath || !fs.existsSync(args.imagePath)) {
    console.error(`[CodePlanner] Error: image not found: ${args.imagePath}`);
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
        process.stderr.write(`\r[CodePlanner] ${m.status} ${Math.round(m.progress * 100)}%`);
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
// Output helpers
// ---------------------------------------------------------------------------

function writeOutput(content, outputPath) {
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, content, 'utf8');
    console.error(`[CodePlanner] Saved → ${outputPath}`);
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

  if (args.command !== 'ocr') {
    console.error(`[CodePlanner] Unknown command: ${args.command}`);
    printHelp();
    process.exit(1);
  }

  if (!args.imagePath) {
    console.error('[CodePlanner] Error: imagePath argument is required.');
    printHelp();
    process.exit(1);
  }

  if (!fs.existsSync(args.imagePath)) {
    console.error(`[CodePlanner] Error: file not found: ${args.imagePath}`);
    process.exit(1);
  }

  // Check deps
  try {
    require.resolve('tesseract.js');
    require.resolve('image-size');
  } catch (e) {
    console.error(
      '[CodePlanner] Missing dependencies. Run:\n  npm install tesseract.js image-size\n' +
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

    }
  } catch (err) {
    console.error(`[CodePlanner] Error: ${err.message || err}`);
    if (args.verbose) { console.error(err.stack); }
    process.exit(1);
  }
}

main();
