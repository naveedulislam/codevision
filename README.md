# CodePlanner

A VS Code / Cursor extension (and standalone CLI) for **OCR text extraction** and **agent request building** — giving AI agents the precise file references and codebase context they need to act accurately.

---

## Features

| Feature                   | Description                                                                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **OCR text extraction**   | Extract text from PNG, JPEG, BMP, TIFF, GIF, WEBP images using [Tesseract.js](https://github.com/naptha/tesseract.js) — no native binaries required                                  |
| **Multi-language OCR**    | Supports 100+ languages: `eng`, `ara`, `chi_sim`, `fra`, `deu`, `eng+ara`, etc.                                                                                                      |
| **Agent Request Builder** | Create structured markdown context files with named sections (Task, Files & References, Workspace Context, Errors & Diagnostics, Instructions, Constraints & Notes, Expected Output) |
| **Drop-to-insert**        | Drag files or folders from the Explorer into any open document — the relative path is inserted at the cursor automatically                                                           |
| **Workspace context**     | One command inserts your project folder tree and `git status` into the active document                                                                                               |
| **Error context**         | One command inserts all current VS Code diagnostics (errors and warnings) into the active document                                                                                   |
| **Screenshot capture**    | Command Palette trigger — macOS: `screencapture -i`, Windows: automated `Win+Shift+S` + clipboard polling, Linux: gnome-screenshot / scrot fallback → OCR result in editor            |
| **Clipboard extraction**  | Extract text directly from an image copied to clipboard (no save needed)                                                                                                             |
| **AI agent LM tool**      | Registered as a VS Code Language Model Tool — Copilot and other agents can call `codeplanner_extract_text` directly                                                                  |
| **CLI tool**              | `node cli/codeplanner.js ocr` works in any terminal, including the integrated terminal                                                                                               |
| **Offline / air-gapped**  | Point `codeplanner.tessDataPath` at a local tessdata directory to avoid downloading language models                                                                                  |
| **M365 Copilot Upload**   | Stage files in the Explorer sidebar, then send them all to M365 Copilot Chat in a single drag from a pre-selected Finder window                                                      |

---

## Agent Request Builder

The Agent Request Builder helps you give AI agents accurate, complete context before asking them to code. Instead of pasting file paths by hand or describing your project structure from memory, CodePlanner assembles everything for you.

### Drop-to-insert

Drag one or more files **or folders** from the VS Code **Explorer** panel and drop them into the text body of any open document. The relative path is inserted at the drop position:

```
src/commands.ts
NutriComposer/web-app/src/App.tsx
```

> Drop must land in the **text area** of the document, not the tab bar.

### New Agent Request

**Command Palette → `CodePlanner: New Agent Request`**

Opens a new untitled Markdown document with a structured template:

```markdown
# Agent Request

**Workspace:** my-project  
**Date:** 2025-07-10  
**Platform:** darwin / Node v20.11.0

---

## Task

<!-- Describe what you want the agent to do -->

---

## Files & References

<!-- Drag files from the Explorer and drop here → a relative-path link is auto-inserted. -->

---

## Workspace Context

<!-- Use "CodePlanner: Insert Workspace Context" to add project structure & git status. -->

---

## Errors & Diagnostics

<!-- Use "CodePlanner: Insert Errors & Diagnostics" to embed current VS Code problems. -->

---

## Instructions

<!-- Step-by-step instructions or acceptance criteria the agent should follow. -->

---

## Constraints & Notes

<!-- Coding style, patterns to follow, anything the agent should know. -->

---

## Expected Output

<!-- Describe the deliverable: a diff, a working feature, a document, tests, etc. -->
```

Cursor lands in the **Task** section so you can start typing immediately.

---

## Commands (Command Palette)

### OCR

| Command                                          | Description                                            |
| ------------------------------------------------ | ------------------------------------------------------ |
| `CodePlanner: Extract Text from Image File`      | Pick an image → extracted text in editor               |
| `CodePlanner: Extract Text from Clipboard Image` | Read image from OS clipboard → OCR it (no save needed) |
| `CodePlanner: Capture Screenshot & Extract Text` | OS screenshot picker → OCR result in editor            |

Right-click an image in the **Explorer** panel for the context-menu shortcut.

### Agent Request Builder

| Command                                    | Description                                                     |
| ------------------------------------------ | --------------------------------------------------------------- |
| `CodePlanner: New Agent Request`           | Create a new structured agent request template                  |
| `CodePlanner: Insert Workspace Context`    | Inserts project folder tree + `git branch` + `git status`       |
| `CodePlanner: Insert Errors & Diagnostics` | Inserts all VS Code errors and warnings from the Problems panel |

### M365 Copilot Upload Files

The **Upload Files** panel in the Explorer sidebar lets you stage any number of files and send them all to M365 Copilot Chat at once.

**Workflow:**

1. Drag files from the Explorer into the **Upload Files** panel — or right-click any file and choose **Send to Upload Files**
2. Click the **send icon** (↗) in the panel title bar
3. A Finder window opens with all files pre-selected, and M365 Copilot opens beside it
4. **One drag** from Finder to the browser attaches everything — no per-file dragging
5. Click the **trash icon** to clear the list

| Command                               | Description                                                     |
| ------------------------------------- | --------------------------------------------------------------- |
| `CodePlanner: Send to Upload Files`   | Stage the right-clicked / active file in the Upload Files panel |
| `CodePlanner: Open M365 Copilot Chat` | Open M365 Copilot in the built-in Simple Browser                |
| `CodePlanner: Copy All to Clipboard`  | Stage → open Finder (all selected) + open M365 Copilot browser  |
| `CodePlanner: Clear Staged Files`     | Remove all files from the Upload Files panel                    |

---

## Keyboard Shortcuts

| Shortcut            | Platform        | Action                 |
| ------------------- | --------------- | ---------------------- |
| `Ctrl+Shift+Cmd+U`  | macOS           | Send to Upload Files   |
| `Ctrl+Shift+Alt+U`  | Windows / Linux | Send to Upload Files   |

---

## Configuration

Open **Settings → Extensions → CodePlanner** or edit `settings.json`:

```json
{
  "codeplanner.tesseractLanguage": "eng",
  "codeplanner.tessDataPath": "",
  "codeplanner.openResultInEditor": true
}
```

| Setting              | Default | Description                                                                                                  |
| -------------------- | ------- | ------------------------------------------------------------------------------------------------------------ |
| `tesseractLanguage`  | `"eng"` | Language(s) for OCR. Use `+` to combine, e.g. `"eng+ara"`                                                    |
| `tessDataPath`       | `""`    | Local tessdata directory (offline mode). Download from [tessdata](https://github.com/tesseract-ocr/tessdata) |
| `openResultInEditor` | `true`  | Auto-open OCR results in a new editor tab                                                                    |

---

## CLI Usage

```bash
# From the extension root (after npm install):
node cli/codeplanner.js ocr [options] <imagePath>

# Options
--lang <code>    OCR language(s), e.g. eng, ara, eng+ara  [default: eng]
--output <path>  Write result to file instead of stdout
--tessdata <dir> Local tessdata directory (offline)
--json           Output result as JSON with metadata
--verbose        Show Tesseract progress
```

### CLI Examples

```bash
# Basic text extraction
node cli/codeplanner.js ocr screenshot.png

# Arabic + English, save to file
node cli/codeplanner.js ocr scan.png --lang eng+ara --output result.txt

# JSON output (for scripts / agents to parse)
node cli/codeplanner.js ocr screenshot.png --json
```

---

## AI Agent LM Tool

When used with **GitHub Copilot** or any VS Code Language Model Tool-compatible agent, CodePlanner registers a tool that agents can call automatically:

### `codeplanner_extract_text`

```
Extract text from an image file using OCR.
Input:  { imagePath: string, lang?: string, tessDataPath?: string }
Output: { text, confidence, imageWidth, imageHeight }
```

**Example Copilot prompt:**

> "Read the text from **/path/to/screenshot.png** and create a summary."

Copilot will call `codeplanner_extract_text`, receive the plain text, and work from that.

---

## Development

```bash
cd codeplanner
npm install

# Compile TypeScript
npm run compile

# Watch mode
npm run watch

# Run all tests (78 tests — unit + integration)
npm test

# Package VSIX
npm run package
```

### Requirements

- Node.js 18+
- VS Code 1.90+ (for Language Model Tools and DocumentDropEditProvider support)
- `tesseract.js` and `image-size` are installed automatically via `npm install`
- macOS clipboard/screenshot commands use the built-in `screencapture` and `osascript`
- Linux clipboard extraction requires `xclip` (`sudo apt install xclip`) or `wl-clipboard` for Wayland

### Offline / Air-gapped Installation

1. Download trained data files from https://github.com/tesseract-ocr/tessdata
2. Save to a local directory, e.g. `/opt/tessdata/`
3. Set `"codeplanner.tessDataPath": "/opt/tessdata"` in VS Code settings
4. Or pass `--tessdata /opt/tessdata` to the CLI

---

## Project Structure

```
codeplanner/
├── src/
│   ├── extension.ts           # VS Code activation + LM tool registration
│   ├── types.ts               # Shared TypeScript types
│   ├── ocrEngine.ts           # Tesseract.js wrapper (cached worker)
│   ├── agentRequestBuilder.ts # Drop-to-insert + agent request commands
│   ├── commands.ts            # OCR command implementations
│   ├── copilotBridge.ts       # M365 Copilot Upload Files panel + Finder staging
│   └── outputPanel.ts         # Editor output helpers
├── cli/
│   └── codeplanner.js          # Standalone OCR CLI (no VS Code dependency)
├── test/
│   ├── __mocks__/vscode.ts      # Comprehensive VS Code API mock
│   ├── unit/                    # Unit tests for each module
│   └── integration/             # Integration tests across modules
├── icon.png
├── package.json
├── jest.config.js
├── tsconfig.json
├── tsconfig.test.json
└── webpack.config.js
```

---

## Project Status

Track development progress and session notes in the [`status/`](./status/) folder.

| File                                                  | Description                                                                              |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [project_status_01.md](./status/project_status_01.md) | Session 01 — initial build: OCR engine, wireframe generator, CLI                         |
| [project_status_02.md](./status/project_status_02.md) | Session 02 — replaced wireframe with Agent Request Builder; drag-and-drop path insertion |
| [project_status_03.md](./status/project_status_03.md) | Session 03 — renamed codevision → codeplanner; M365 Copilot Upload Bridge                |
| [project_status_04.md](./status/project_status_04.md) | Session 04 — Upload Files UX fixes; Agent Request template update                        |
| [project_status_05.md](./status/project_status_05.md) | Session 05 — Windows screenshot fix; unit & integration test suite                       |

---

## Acknowledgements

- [Tesseract.js](https://github.com/naptha/tesseract.js) — pure-JavaScript OCR
- [image-size](https://github.com/image-size/image-size) — lightweight image dimension detection
