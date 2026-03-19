# CodeVision — Project Status 01

**Date:** 2026-03-18  
**Status:** Initial setup / pre-release

---

## Session Summary (2026-03-18)

This session covered the full creation of the CodeVision VS Code extension from scratch — concept through working code and initial GitHub publish.

### 1. Project Concept & Goals

The goal was to build a VS Code / Cursor extension that lets developers (and AI agents) extract meaning from UI screenshots without feeding raw images to a vision model. Two core capabilities were defined:

- **OCR text extraction** — pull all text out of a screenshot using Tesseract.js
- **Wireframe generation** — convert a screenshot's spatial layout into a structured SVG, ASCII, or HTML wireframe with labelled blocks (`[HEADER]`, `[NAV]`, `[PARAGRAPH]`, etc.)

A secondary goal was to register these capabilities as **VS Code Language Model Tools** so GitHub Copilot and other AI agents can invoke them automatically during code-generation tasks (e.g. "build a React component that matches this screenshot").

---

### 2. Technology Choices

| Decision                | Choice              | Rationale                                                                          |
| ----------------------- | ------------------- | ---------------------------------------------------------------------------------- |
| OCR engine              | **Tesseract.js**    | Pure JavaScript — no native binaries, works offline / air-gapped, npm install only |
| Image dimension reading | **image-size**      | Replaces `jimp`; lightweight pure-JS, no native canvas dependency                  |
| Extension bundler       | **webpack**         | Tree-shakes `tesseract.js` to keep the VSIX small                                  |
| Language                | **TypeScript**      | Type safety across all modules; `tsconfig.json` targets ES2020                     |
| CLI                     | Plain `node` script | No VS Code host required; usable in any terminal or CI pipeline                    |

---

### 3. Source Files Created

#### `src/types.ts`

Defined all shared TypeScript interfaces used across the extension:

- `BoundingBox`, `TsvRow` — raw Tesseract TSV data structures
- `LayoutBlock`, `BlockType` — aggregated block with spatial position and semantic type (`header`, `nav`, `heading`, `paragraph`, `sidebar`, `button`, `footer`, `list`, `image_placeholder`, `unknown`)
- `OcrResult`, `OcrOptions` — OCR inputs and outputs
- `WireframeResult`, `WireframeOptions` — wireframe inputs and outputs

#### `src/ocrEngine.ts`

Tesseract.js wrapper with a **persistent cached worker**:

- Worker is created once and reused across all command invocations (avoids 3–5 second cold-start per call)
- Worker is automatically recreated when the configured language changes
- Supports offline/air-gapped mode via a local `tessDataPath` directory
- `disposeWorker()` terminates the worker cleanly on extension deactivation
- Returns `OcrResult` containing plain text, raw TSV (with per-word bounding boxes), confidence score, and image dimensions

#### `src/wireframeGenerator.ts`

Full pipeline: Tesseract TSV → layout blocks → wireframe output:

- **TSV parser** — splits raw Tesseract TSV into typed `TsvRow` objects
- **Block aggregator** — groups word-level rows into blocks, computes union bounding boxes and average word height
- **Block classifier** — heuristic rules using position (top 10% → header/nav, bottom 10% → footer), average word height (large text → heading), and word count (low → button, moderate → sidebar) to assign `BlockType`
- **SVG renderer** — coloured, labelled rectangles scaled to a 900px canvas
- **ASCII renderer** — text-art wireframe using box-drawing characters, suitable for feeding to text-only LLMs
- **HTML renderer** — self-contained HTML combining SVG wireframe + extracted text + block metadata table

#### `src/commands.ts`

Six Command Palette commands, each reading config from VS Code settings:

- `cmdExtractText` — file picker → OCR → text editor + saved `.txt` file
- `cmdExtractTextFromClipboard` — reads image from OS clipboard (macOS `osascript`; Linux `xclip`) → OCR
- `cmdGenerateWireframe` — file picker → OCR + wireframe → SVG/ASCII/HTML depending on `codevision.wireframeFormat` setting
- `cmdAnalyzeImage` — runs both OCR and wireframe in one step, opens combined HTML report in a side panel
- `cmdAnalyzeActiveImage` — same as above but acts on the image file currently open in the editor
- `cmdCaptureScreenshot` — triggers the OS screenshot tool (`screencapture` on macOS, `PrintScreen` on Windows/Linux), then presents a quick-pick menu to choose OCR / Wireframe / Full Analysis

#### `src/extension.ts`

VS Code activation entry point:

- Registers all 6 commands plus 2 Explorer context-menu URI variants
- Conditionally registers **Language Model Tools** (`codevision_extract_text`, `codevision_generate_wireframe`) when running on VS Code ≥ 1.90 with `vscode.lm.registerTool` available
- Calls `disposeWorker()` on deactivation

#### `src/outputPanel.ts`

Output display helpers:

- `showTextInEditor` — opens extracted text in a new untitled editor tab
- `showHtmlInWebview` — renders wireframe/HTML reports in a reusable Webview panel beside the editor; applies a strict Content Security Policy to prevent XSS from processed image content
- `saveResult` — writes output files alongside the source image
- `withProgress` — wraps long-running operations in a VS Code progress notification

#### `cli/codevision.js`

Standalone command-line tool (no VS Code dependency):

- Commands: `ocr`, `wireframe`, `analyze`
- Flags: `--lang`, `--format`, `--output`, `--output-dir`, `--tessdata`, `--json`, `--verbose`
- Outputs to stdout by default; writes files when `--output` / `--output-dir` is specified
- Intended for use in CI pipelines, terminal workflows, and testing outside of the editor

---

### 4. Project Configuration Files

- **`package.json`** — extension manifest: contributed commands, keyboard shortcuts (`Ctrl+Shift+Cmd+4` / `Ctrl+Shift+Alt+4`), Explorer context menus, settings schema, LM tool declarations, webpack build scripts
- **`tsconfig.json`** — TypeScript compiler config targeting ES2020, CommonJS modules, strict mode
- **`webpack.config.js`** — bundles the extension to `dist/extension.js`; marks `vscode` as external
- **`.vscodeignore`** — excludes `src/`, `node_modules/`, config files from the packaged VSIX

---

### 5. Documentation

- **`README.md`** — full documentation covering features, commands, keyboard shortcuts, settings, CLI usage, AI agent tool API, token cost analysis (screenshot vs wireframe+OCR), development setup, and project structure

---

### 6. Repository Setup

- Created `.gitignore` excluding `node_modules/`, `dist/`, `*.vsix`, `*.profraw`
- Initialised local git repo and set branch to `main`
- Added GitHub remote: `https://github.com/naveedulislam/codevision.git`
- Created initial commit (16 files, ~7 400 lines) and pushed to `origin/main`

---

## Current State

| Area                                          | Status      | Notes                                                      |
| --------------------------------------------- | ----------- | ---------------------------------------------------------- |
| Core OCR engine (`ocrEngine.ts`)              | Complete    | Tesseract.js worker with caching                           |
| Wireframe generator (`wireframeGenerator.ts`) | Complete    | SVG, ASCII, and HTML output formats                        |
| VS Code commands (`commands.ts`)              | Complete    | All 6 commands implemented                                 |
| CLI tool (`cli/codevision.js`)                | Complete    | Standalone, no VS Code dependency                          |
| LM Tool registration                          | Complete    | `codevision_extract_text`, `codevision_generate_wireframe` |
| Screenshot capture shortcut                   | Complete    | macOS `screencapture` + Windows/Linux                      |
| Clipboard extraction                          | Complete    | macOS `osascript`; Linux requires `xclip`                  |
| Packaging / VSIX                              | Pending     | `npm run package` not yet run                              |
| Marketplace publish                           | Pending     | Not yet submitted to VS Code Marketplace                   |
| Tests                                         | Not started | No unit or integration tests yet                           |

---

## Architecture Decisions

- **Tesseract.js** chosen over native Tesseract binary for zero-install / air-gapped support.
- **image-size** replaces `jimp` to reduce bundle weight (pure JS, no native canvas).
- Wireframe blocks typed via `src/types.ts` to keep generator and commands decoupled.
- CLI is a plain `node` script so it works without the VS Code extension host.

---

## Known Issues / TODOs

- [ ] Add unit tests for `ocrEngine` and `wireframeGenerator`
- [ ] Confirm `xclip` fallback works on all major Linux distros
- [ ] Publish VSIX to the VS Code Marketplace
- [ ] Add progress indicator for large images (OCR can take several seconds)
- [ ] Support PDF input (stretch goal)

---

## Git Setup

Repository: `https://github.com/naveedulislam/codevision`  
Branch: `main`
