# CodeVision — Project Status 01

**Date:** 2026-03-18  
**Status:** Initial setup / pre-release

---

## Current State

| Area | Status | Notes |
| ---- | ------ | ----- |
| Core OCR engine (`ocrEngine.ts`) | Complete | Tesseract.js worker with caching |
| Wireframe generator (`wireframeGenerator.ts`) | Complete | SVG, ASCII, and HTML output formats |
| VS Code commands (`commands.ts`) | Complete | All 6 commands implemented |
| CLI tool (`cli/codevision.js`) | Complete | Standalone, no VS Code dependency |
| LM Tool registration | Complete | `codevision_extract_text`, `codevision_generate_wireframe` |
| Screenshot capture shortcut | Complete | macOS `screencapture` + Windows/Linux |
| Clipboard extraction | Complete | macOS `osascript`; Linux requires `xclip` |
| Packaging / VSIX | Pending | `npm run package` not yet run |
| Marketplace publish | Pending | Not yet submitted to VS Code Marketplace |
| Tests | Not started | No unit or integration tests yet |

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
