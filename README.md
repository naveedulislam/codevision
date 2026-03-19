# CodeVision

A VS Code / Cursor extension (and standalone CLI) for **OCR text extraction** and **layout wireframe generation** from images. Works in any VS Code-compatible editor.

---

## Features

| Feature                          | Description                                                                                                                                                                 |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OCR text extraction**          | Extract text from PNG, JPEG, BMP, TIFF, GIF, WEBP images using [Tesseract.js](https://github.com/naptha/tesseract.js) — no native binaries required                         |
| **Multi-language OCR**           | Supports 100+ languages: `eng`, `ara`, `chi_sim`, `fra`, `deu`, `eng+ara`, etc.                                                                                             |
| **Wireframe generation**         | Converts a screenshot into a structured SVG / ASCII / HTML wireframe, labelling each block by type (`header`, `nav`, `heading`, `paragraph`, `sidebar`, `button`, `footer`) |
| **Combined analysis**            | Single command produces OCR text + wireframe + HTML report                                                                                                                  |
| **Screenshot capture**           | `Ctrl+Shift+Cmd+4` (macOS) / `Ctrl+Shift+Alt+4` (Windows/Linux) triggers OS screenshot tool → choose OCR, Wireframe or Full Analysis                                        |
| **Clipboard extraction**         | Extract text or wireframe directly from an image copied to the clipboard                                                                                                    |
| **AI agent tools**               | Registered as VS Code Language Model Tools so Copilot and other agents can call `codevision_extract_text` and `codevision_generate_wireframe` directly                      |
| **CLI tool**                     | `node cli/codevision.js` works in any terminal, including VS Code's integrated terminal                                                                                     |
| **Offline / air-gapped support** | Point `codevision.tessDataPath` at a local tessdata directory to avoid downloading language models                                                                          |

---

## Commands (Command Palette)

| Command                                          | Description                                                           |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| `CodeVision: Extract Text from Image File`       | Pick an image → get extracted text                                    |
| `CodeVision: Generate Wireframe from Image File` | Pick an image → get SVG/ASCII/HTML wireframe                          |
| `CodeVision: Analyze Image (Text + Wireframe)`   | Both in one step, opens combined HTML report in side panel            |
| `CodeVision: Analyze Active Image File`          | Act on the image file currently open in the editor                    |
| `CodeVision: Extract Text from Clipboard Image`  | Read image from OS clipboard → OCR it directly (no save needed)       |
| `CodeVision: Capture Screenshot & Analyze`       | Trigger OS screenshot picker → choose OCR / Wireframe / Full Analysis |

Right-click an image file in the **Explorer** panel for context-menu shortcuts.

---

## Keyboard Shortcuts

| Shortcut           | Platform        | Action                       |
| ------------------ | --------------- | ---------------------------- |
| `Ctrl+Shift+Cmd+4` | macOS           | Capture Screenshot & Analyze |
| `Ctrl+Shift+Alt+4` | Windows / Linux | Capture Screenshot & Analyze |

---

## Configuration

Open **Settings → Extensions → CodeVision** or edit `settings.json`:

```json
{
  "codevision.tesseractLanguage": "eng",
  "codevision.tessDataPath": "",
  "codevision.wireframeFormat": "svg",
  "codevision.openResultInEditor": true
}
```

| Setting              | Default | Description                                                                                                                 |
| -------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| `tesseractLanguage`  | `"eng"` | Language(s) for OCR. Use `+` to combine, e.g. `"eng+ara"`                                                                   |
| `tessDataPath`       | `""`    | Local tessdata directory (offline mode). Download trained models from [tessdata](https://github.com/tesseract-ocr/tessdata) |
| `wireframeFormat`    | `"svg"` | `svg` \| `ascii` \| `html`                                                                                                  |
| `openResultInEditor` | `true`  | Auto-open results in a new editor tab                                                                                       |

---

## CLI Usage

```bash
# From the extension root (after npm install):
node cli/codevision.js <command> [options] <imagePath>

# Commands
node cli/codevision.js ocr        screenshot.png
node cli/codevision.js wireframe  screenshot.png --format svg
node cli/codevision.js analyze    screenshot.png --output-dir ./output

# Options
--lang <code>       OCR language(s), e.g. eng, ara, eng+ara  [default: eng]
--format <fmt>      wireframe format: svg | ascii | html       [default: svg]
--output <path>     Write result to file instead of stdout
--output-dir <dir>  (analyze) Directory for all output files
--tessdata <dir>    Local tessdata directory (offline)
--json              Output metadata as JSON
--verbose           Show Tesseract progress
```

### CLI Examples

```bash
# Basic text extraction
node cli/codevision.js ocr ui-screenshot.png

# Arabic + English text extraction, save to file
node cli/codevision.js ocr scan.png --lang eng+ara --output result.txt

# SVG wireframe
node cli/codevision.js wireframe dashboard.png --format svg --output dashboard.svg

# ASCII wireframe (pipe-friendly, works with any model)
node cli/codevision.js wireframe dashboard.png --format ascii

# Full analysis — saves .txt, .svg, .txt (ASCII), and .html
node cli/codevision.js analyze dashboard.png --output-dir ./cv-output

# JSON output (for scripts / agents to parse)
node cli/codevision.js analyze dashboard.png --json --output-dir ./cv-output
```

---

## AI Agent Tools

When used with **GitHub Copilot** or any VS Code Language Model Tool-compatible agent, CodeVision registers two tools that agents can call automatically:

### `codevision_extract_text`

```
Extract text from an image file using OCR.
Input:  { imagePath: string, lang?: string, tessDataPath?: string }
Output: { text, confidence, imageWidth, imageHeight }
```

### `codevision_generate_wireframe`

```
OCR + spatial layout analysis → structured wireframe.
Input:  { imagePath: string, lang?: string, format?: "svg"|"ascii"|"html" }
Output: { extractedText, confidence, blocksDetected, blocks[], wireframe }
```

**Example Copilot prompt:**

> "Analyze **/path/to/screenshot.png** and generate a React component that matches the layout."

Copilot will call `codevision_generate_wireframe`, receive the block structure, and use it to generate the component code — no manual copy-paste needed.

---

## Screenshot → Token Cost Analysis


| Input type               | Typical token cost                                                                                        | Model requirement                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Screenshot (image)       | ~1,500–2,000 image tokens (GPT-4V high detail) · ~1,600 tokens (Claude 3.5 Sonnet via dimensions formula) | **Vision-capable model required** |
| Wireframe SVG + OCR text | **500–3,000 text tokens** depending on content density                                                    | **Any LLM** (no vision needed)    |

**Verdict: wireframe + OCR is superior for coding agents because:**

1. **Works with all models** — no vision capability required; text-based agents (o3, o1, Claude Haiku, local models) can consume it directly.
2. **Compact and structured** — explicit block labels (`[HEADER]`, `[NAV]`, `[PARAGRAPH]`) tell the agent exactly what each section is without interpretation.
3. **More actionable for code generation** — the agent can reference "the nav block at the top" rather than guessing from pixel data.
4. **ASCII wireframe is even smaller** — typically 2–8 KB (~600–2,500 tokens), suitable as part of a larger system prompt.
5. **No hallucination risk** — the OCR text is exact; vision models can misread or hallucinate text from images.

**Recommendation:** use `codevision.wireframeFormat = "ascii"` when feeding context to text-only models for minimum token cost, and `"html"` when you want a rich overview in the Copilot panel.

---

## Development

```bash
cd codevision
npm install

# Compile TypeScript
npm run compile

# Watch mode
npm run watch

# Package VSIX
npm run package
```

### Requirements

- Node.js 18+
- VS Code 1.90+ (for Language Model Tools support)
- `tesseract.js` and `image-size` are installed automatically via `npm install`
- macOS clipboard/screenshot commands use the built-in `screencapture` and `osascript` (no extra installs)
- Linux clipboard extraction requires `xclip` (`sudo apt install xclip`)

### Offline / Air-gapped Installation

1. Download trained data files from https://github.com/tesseract-ocr/tessdata
2. Save to a local directory, e.g. `/opt/tessdata/`
3. Set `"codevision.tessDataPath": "/opt/tessdata"` in VS Code settings
4. Or pass `--tessdata /opt/tessdata` to the CLI

---

## Project Structure

```
codevision/
├── src/
│   ├── extension.ts          # VS Code activation + LM tool registration
│   ├── types.ts              # Shared TypeScript types
│   ├── ocrEngine.ts          # Tesseract.js wrapper (cached worker)
│   ├── wireframeGenerator.ts # TSV → LayoutBlocks → SVG/ASCII/HTML
│   ├── commands.ts           # Command Palette implementations
│   └── outputPanel.ts        # Webview + editor output helpers
├── cli/
│   └── codevision.js         # Standalone CLI (no VS Code dependency)
├── package.json
├── tsconfig.json
└── webpack.config.js
```

---

## Project Status

Track development progress and session notes in the [`status/`](./status/) folder.

| File | Description |
| ---- | ----------- |
| [project_status_01.md](./status/project_status_01.md) | Initial project status — architecture decisions, current state, known issues |

---

## Acknowledgements

- [Tesseract.js](https://github.com/naptha/tesseract.js) — pure-JavaScript OCR
- [image-size](https://github.com/image-size/image-size) — lightweight image dimension detection (replaces jimp)
- Inspired by [vscode-tesseract-act](https://github.com/SAKryukov/vscode-tesseract-act) and [imagesorcery-mcp](https://github.com/sunriseapps/imagesorcery-mcp)
