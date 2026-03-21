# CodePlanner — Project Status 03

**Date:** 2026-03-21  
**Status:** Rename codevision → codeplanner; M365 Copilot Upload Bridge — complete

---

## Session Summary (2026-03-21)

This session had two goals: (1) rename the project and publisher from `codevision` / `naveedulislam` to `codeplanner` / `Naveed` throughout the entire codebase, and (2) build a new **M365 Copilot Upload Bridge** feature that lets users stage any number of files from the VS Code Explorer and send them all to M365 Copilot Chat in a single drag-and-drop. A series of bugs discovered during incremental testing were also fixed.

---

## 1. Changes by File

### `package.json` — Major update

- `"publisher"` changed from `"naveedulislam"` to `"Naveed"`
- Added `"icon": "icon.png"` — was missing, which is why the extension icon was not showing in the VS Code Extensions view
- Repository URL updated from `codevision` to `codeplanner`
- Configuration section title changed from `CodeVision` to `CodePlanner`; all setting keys changed from `codevision.*` to `codeplanner.*`
- **New sidebar view** registered: `codeplanner.copilotFiles` ("Upload Files") appears in the Explorer panel
- **New commands** registered:
  - `codeplanner.sendToM365Copilot` — "Send to Upload Files" (Explorer context menu + keybinding `Ctrl+Shift+Cmd+U`)
  - `codeplanner.clearCopilotFiles` — trash icon, clears all staged files
  - `codeplanner.copilotRecopyFile` — re-copy a single staged file (item click)
  - `codeplanner.openM365Copilot` — globe icon, opens M365 Copilot in Simple Browser
  - `codeplanner.copilotCopyAllFiles` — copy icon, sends all staged files to Finder + opens browser

---

### `src/copilotBridge.ts` — NEW (~480 lines)

New file implementing the entire M365 Copilot Upload Bridge.

#### `openStagingFolderInFinder(filePaths, prevDirs)`

macOS helper that:

1. Closes any Finder windows left open from a previous staging operation (prevents window accumulation)
2. Deletes prior staging folders
3. Creates a fresh `codeplanner-upload-<timestamp>` temp directory
4. Hard-links (or copies as fallback) every file into it, deduplicating names where needed
5. Opens the folder in Finder via AppleScript and **pre-selects all items** — user can immediately drag them all at once, no ⌘A needed

#### `copyImageDataToClipboard(imagePath)`

macOS helper — converts any image to PNG via `sips` (built-in) and writes raw PNG pixel data to the clipboard via AppleScript `«class PNGf»`. Browsers receive this as a proper File object on ⌘V.

#### `copyFilesToClipboard(filePaths)`

Windows/Linux path — places a native file-drop list on the clipboard via PowerShell (`StringCollection`) or `xclip` (`text/uri-list`).

#### `DropHintItem` (new tree item class)

Placeholder shown when no files are staged. Displays "Drop files here from Explorer" with an arrow-down icon. **Critical fix**: VS Code only renders a drag-and-drop hit area when the tree has at least one item — without this, drops on an empty panel were silently ignored.

#### `CopilotFilesProvider`

Implements `TreeDataProvider<TreeEntry>` and `TreeDragAndDropController<TreeEntry>`:

- `dropMimeTypes`: accepts `text/uri-list` and `application/vnd.code.tree.workbench.explorer.fileView`
- `handleDrop()`: extracts paths from the DataTransfer, adds them to the staged list, shows a count notification — **does not open Finder** (fixed: each drop was opening a separate Finder window)
- `getChildren()`: returns `DropHintItem` when empty; `CopilotFileItem[]` otherwise
- `copyAllAndNotify()`: the main action — opens staging folder in Finder (closing any previous windows), opens M365 Copilot in Simple Browser beside it, shows notification
- `dispose()` / `clearFiles()`: clean up all staging temp folders
- `_extractPaths()`: three-strategy path extraction from DataTransfer (VS Code internal JSON → `text/uri-list` → `DataTransferFile`)

---

### `src/extension.ts` — Updated

- Imports `CopilotFilesProvider` and `cmdSendToM365Copilot` from `copilotBridge`
- Creates `CopilotFilesProvider` and registers it as both `treeDataProvider` and `dragAndDropController` on the `codeplanner.copilotFiles` tree view
- Registers all five new Upload Bridge commands
- LM tool ID changed from `codevision_extract_text` → `codeplanner_extract_text`
- Config key read changed from `codevision` → `codeplanner`

---

### `cli/codevision.js` → `cli/codeplanner.js` — Renamed + updated

File renamed. All internal `codevision` / `CodeVision` references replaced with `codeplanner` / `CodePlanner`.

---

### `src/outputPanel.ts` — Minor rename

- Comment header updated: `CodeVision` → `CodePlanner`
- Webview panel type ID: `'codevisionResult'` → `'codeplannerResult'`

---

### `src/ocrEngine.ts` — Minor rename

- Log prefix `[CodeVision]` → `[CodePlanner]`

---

### `src/types.ts`, `src/commands.ts` — Minor rename

- Comment headers updated to reference `CodePlanner`

---

### `README.md` — Updated

- All `CodeVision` / `codevision` references replaced with `CodePlanner` / `codeplanner`
- Added M365 Copilot Upload Files feature to features table
- Added Upload Files commands section
- Updated project structure tree to include `copilotBridge.ts`
- Project Status table updated (session 03 entry added)

---

## 2. Bug Fixes (three incremental fixes)

### Bug 1 — Empty "Upload Files" panel silently ignores drops

**Symptom:** Drag-and-drop only worked after manually right-clicking a file first ("Send to Upload Files"). On a fresh session the panel was empty and drops did nothing.

**Root cause:** VS Code only renders a drag-and-drop hit area when the tree view has at least one item rendered. An empty `getChildren()` → `[]` means no drop target surface.

**Fix:** `getChildren()` now always returns at least a `DropHintItem` placeholder, ensuring the drop zone is always active. The hint disappears once the first file is staged.

---

### Bug 2 — Each file dropped to the panel opened a new Finder window

**Symptom:** Dragging 3 files to the Upload Files panel one at a time opened 3 Finder windows (one per drop).

**Root cause:** `handleDrop()` called `_copyAllAndNotify()` at the end of every drop, which ran the full staging-folder + Finder + browser workflow.

**Fix:** `handleDrop()` now only stages the file(s) and shows a brief count notification. The Finder + browser flow only runs when the user explicitly clicks the send/copy icon.

---

### Bug 3 — Each click of "Copy All to Clipboard" stacked a new Finder window

**Symptom:** Staging 3 files → clicking send → adding a 4th → clicking send again opened a second Finder window alongside the first (showing 3 files), instead of replacing it.

**Root cause:** Each call to `openStagingFolderInFinder` created a new temp folder and opened a new Finder window, with no cleanup of the previous one.

**Fix:** `openStagingFolderInFinder` now accepts a `prevDirs` parameter. Before creating the new staging folder it: (1) sends AppleScript to close any Finder windows pointing to previous staging dirs, (2) deletes those dirs. Result: only one staging window is ever open at a time.

---

## 3. Commands — Before vs After

| Before (Session 02)                             | After (Session 03)                                         |
| ----------------------------------------------- | ---------------------------------------------------------- |
| Extract Text from Image File _(unchanged)_      | Extract Text from Image File _(unchanged)_                 |
| Extract Text from Clipboard Image _(unchanged)_ | Extract Text from Clipboard Image _(unchanged)_            |
| Capture Screenshot & Extract Text _(unchanged)_ | Capture Screenshot & Extract Text _(unchanged)_            |
| New Agent Request _(unchanged)_                 | New Agent Request _(unchanged)_                            |
| Insert Workspace Context _(unchanged)_          | Insert Workspace Context _(unchanged)_                     |
| Insert Errors & Diagnostics _(unchanged)_       | Insert Errors & Diagnostics _(unchanged)_                  |
| _(none)_                                        | **Send to Upload Files** _(added)_                         |
| _(none)_                                        | **Open M365 Copilot Chat** _(added)_                       |
| _(none)_                                        | **Copy All to Clipboard / Send** _(added)_                 |
| _(none)_                                        | **Clear Staged Files** _(added)_                           |
| _(none)_                                        | **Re-copy to Clipboard** _(item click in panel)_ _(added)_ |

---

## 4. How the Upload Flow Works (macOS)

1. Drag files from Explorer to the **Upload Files** panel — OR — right-click files and choose **"Send to Upload Files"**
2. Files appear in the panel (the "Drop files here" hint disappears)
3. Click the **send icon** (copy icon in the panel title bar)
4. A temp staging folder is created, all files are hard-linked into it
5. Finder opens showing **that single folder** with **all files pre-selected**
6. M365 Copilot Chat opens in the VS Code Simple Browser beside it
7. **One drag** from the Finder window to the browser uploads all files at once
8. Click the trash icon to clear the list when done

---

## 5. Current State

| Area                        | Status      | Notes                                                             |
| --------------------------- | ----------- | ----------------------------------------------------------------- |
| OCR engine (`ocrEngine.ts`) | Complete    | Unchanged from session 01                                         |
| Agent Request Builder       | Complete    | Unchanged from session 02                                         |
| Drop-to-insert              | Complete    | Unchanged from session 02                                         |
| Upload Files panel          | Complete    | macOS: Finder staging; Windows/Linux: clipboard file-drop         |
| Extension icon              | Fixed       | `"icon": "icon.png"` added to `package.json`                      |
| Publisher display name      | Updated     | `naveedulislam` → `Naveed`                                        |
| Project rename              | Complete    | All `codevision` refs replaced with `codeplanner` across codebase |
| LM Tool registration        | Complete    | `codeplanner_extract_text`                                        |
| VSIX packaging              | Complete    | `codeplanner-0.2.0.vsix` (12.82 MB, 270 files)                    |
| Marketplace publish         | Pending     | Not yet submitted                                                 |
| Tests                       | Not started | No unit or integration tests yet                                  |

---

## 6. Known Issues / TODOs

- [ ] Test drag-and-drop on Windows (path separator handling, clipboard file-drop)
- [ ] Test Upload Files panel on Windows / Linux
- [ ] Verify drop works in Cursor IDE
- [ ] Consider a "Remove file" context menu action on individual Upload Files items
- [ ] Add unit tests for `agentRequestBuilder` and `copilotBridge` functions
- [ ] Publish VSIX to VS Code Marketplace (publisher account `Naveed` required)
- [ ] Update GitHub repo remote to `https://github.com/naveedulislam/codeplanner.git`
