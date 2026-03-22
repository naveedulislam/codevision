# CodePlanner — Project Status 05

**Date:** 2026-03-21  
**Status:** Windows screenshot fix + Test suite — complete

---

## Session Summary (2026-03-21)

This session integrated two independent efforts: (1) a **Windows screenshot capture fix** committed from a Windows PC, and (2) a full **unit and integration test suite** built on the Mac Studio. Both sets of changes were merged and verified together.

---

## 1. Changes by File

### `src/commands.ts` — Windows screenshot capture fix (from Windows PC)

#### Fix — Capture Screenshot & Extract Text did not work on Windows

**Symptom:** On Windows, the "Capture Screenshot & Extract Text" command launched the Snipping Tool (`ms-screensketch:`) and then immediately showed a "Pick File" dialog. The user had to manually save the screenshot, then navigate to and pick the file — an awkward multi-step flow that broke immersion.

**Root cause:** The Windows path used `cp.exec('start ms-screensketch:')` to launch the Snipping Tool asynchronously, then displayed an information-message dialog asking the user to click "Pick File" once they'd saved their screenshot. This required manual file saving and picking — unlike macOS where `screencapture -i` blocks until the user finishes selecting a region.

**Fix:** Replaced the manual Snipping Tool + Pick File flow with an automated `captureWindowsScreenshot()` helper that:

1. Sends `Win+Shift+S` via `user32.dll` `keybd_event` to open the native Snip & Sketch overlay
2. Polls the clipboard every 500ms for up to 60 seconds, waiting for the user to select an area
3. Once the image appears on the clipboard, saves it as a PNG to a temp file
4. Returns control to the OCR pipeline, which processes the screenshot automatically

The helper runs in a PowerShell process with `-STA` (Single Thread Apartment), required for clipboard access on Windows. It supports cancellation via the VS Code progress notification's cancel button.

---

### `package.json` — Keybinding removal (from Windows PC)

Removed the `Ctrl+Shift+Alt+4` / `Ctrl+Shift+Cmd+4` keyboard shortcut for screenshot capture. The command is still available via the Command Palette.

---

### `package.json` — Test scripts added

Added three npm scripts for running Jest tests:

- `npm test` — run all tests
- `npm run test:unit` — unit tests only
- `npm run test:integration` — integration tests only

---

### `package-lock.json` — Updated

- Fixed project name/version metadata (`codevision` → `codeplanner`, `0.1.0` → `0.2.0`)
- Added Jest, ts-jest, and @types/jest dev dependencies

---

### New files — Test infrastructure

#### `jest.config.js`

Jest configuration using `ts-jest` preset with a module name mapper for the `vscode` mock.

#### `tsconfig.test.json`

Separate TypeScript configuration for test compilation — includes both `src/` and `test/` directories, adds `jest` and `node` types.

#### `test/__mocks__/vscode.ts` (~300 lines)

Comprehensive mock of the VS Code API. Stubs all APIs used by the extension: `Uri`, `Position`, `Range`, `Selection`, `DocumentDropEdit`, `TreeItem`, `ThemeIcon`, `EventEmitter`, `DataTransfer`, `DataTransferItem`, `DiagnosticSeverity`, `ProgressLocation`, `ViewColumn`, `workspace`, `window`, `commands`, `languages`, and `lm`.

---

### New files — Unit tests (6 suites, 69 tests)

#### `test/unit/agentRequestBuilder.test.ts` (15 tests)

- `FileDropEditProvider` — drop handling, relative path insertion, missing DataTransfer, non-absolute paths, no workspace fallback
- `cmdNewAgentRequest` — template sections, workspace name, date, platform info, cursor positioning, fallback workspace name
- `cmdInsertWorkspaceContext` — no-editor guard, no-workspace warning, project tree + git info insertion
- `cmdInsertErrors` — no-editor guard, empty diagnostics, formatted errors and warnings

#### `test/unit/ocrEngine.test.ts` (12 tests)

- `recognizeImage` — result fields, text trimming, default language, custom language, worker caching, worker recreation on language change, TSV dimension fallback, default 800×600 fallback, null/undefined text handling, tessDataPath passthrough
- `disposeWorker` — termination, safe no-op when no worker exists

#### `test/unit/copilotBridge.test.ts` (23 tests)

- `CopilotFilesProvider` — empty tree (DropHintItem), staged files, duplicate prevention, prepend ordering, getTreeItem passthrough, clearFiles, icon/contextValue, copyAllAndNotify empty state, onDidChangeTreeData events, handleDrop (uri-list, empty drop, multi-file, comments, explorer JSON), dropMimeTypes, dispose
- `cmdSendToM365Copilot` — single URI, multi-select URIs, active editor fallback, no-file error, non-file scheme rejection

#### `test/unit/outputPanel.test.ts` (9 tests)

- `showTextInEditor` — document creation, default language, custom language
- `showHtmlInWebview` — webview panel creation, CSP headers
- `withProgress` — task execution, return value passthrough
- `saveResult` — path construction, suffix/extension handling

#### `test/unit/extension.test.ts` (7 tests)

- `activate` — command registration count, core commands, copilot bridge commands, document drop edit provider, tree view creation, LM tool registration
- `deactivate` — disposeWorker call

#### `test/unit/types.test.ts` (3 tests)

- `OcrResult` — field assignment
- `OcrOptions` — optional fields, empty object

---

### New files — Integration tests (1 suite, 9 tests)

#### `test/integration/integration.test.ts` (9 tests)

- **OCR pipeline** — full `recognizeImage` result, multi-language options, TSV dimension fallback
- **Agent Request workflow** — template creation → workspace context insertion → error diagnostics insertion (sequential)
- **Upload Files staging flow** — context menu staging + drag-drop + multi-select + clear
- **Drop-to-insert path resolution** — nested workspace paths, no backslashes
- **Worker lifecycle** — sequential operations with language switches (worker termination and recreation)

---

## 2. Current State

| Area                        | Status      | Notes                                                                           |
| --------------------------- | ----------- | ------------------------------------------------------------------------------- |
| OCR engine (`ocrEngine.ts`) | Complete    | Unchanged from session 01                                                       |
| Agent Request Builder       | Complete    | Seven template sections (session 04)                                            |
| Drop-to-insert              | Complete    | Unchanged from session 02                                                       |
| Upload Files panel          | Complete    | UX fixes from session 04                                                        |
| Screenshot capture (macOS)  | Complete    | `screencapture -i` — unchanged                                                 |
| Screenshot capture (Windows)| Fixed       | Automated Win+Shift+S → clipboard polling → OCR pipeline                        |
| Screenshot capture (Linux)  | Complete    | gnome-screenshot / scrot fallback — unchanged                                   |
| LM Tool registration        | Complete    | `codeplanner_extract_text`                                                      |
| Test suite                  | Complete    | 78 tests (69 unit + 9 integration), Jest + ts-jest, all passing                 |
| VSIX packaging              | Complete    | `codeplanner-0.2.0.vsix`                                                        |
| Marketplace publish         | Pending     | Not yet submitted                                                               |

---

## 3. Known Issues / TODOs

- [ ] Test Upload Files panel on Windows / Linux
- [ ] Verify drop works in Cursor IDE
- [ ] Consider a "Remove file" context menu action on individual Upload Files items
- [ ] Publish VSIX to VS Code Marketplace
- [ ] Add code coverage reporting (`--coverage` flag)
- [ ] Test the new Windows screenshot flow end-to-end on Windows hardware
