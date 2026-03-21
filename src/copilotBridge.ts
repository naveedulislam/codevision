/**
 * Copilot File Bridge
 *
 * Bridges the gap between VS Code's Explorer and the M365 Copilot Chat
 * browser window (Simple Browser / any external browser tab).
 *
 * How it works
 * ────────────
 *  VS Code Explorer drag-and-drop into a WebView doesn't transfer real
 *  File objects — the browser page can't receive them.  The workaround is
 *  to copy the file onto the native OS clipboard *as a file* (not as text).
 *  The user then presses ⌘V / Ctrl+V inside the M365 Copilot chat input
 *  to attach it, exactly as if they'd Cmd+C'd the file in Finder.
 *
 * Two entry-points are provided:
 *   1. Explorer context-menu  → "Send to M365 Copilot Chat"
 *      Right-click any file → immediately copies it to the clipboard.
 *
 *   2. "M365 Copilot Files" sidebar panel (TreeView)
 *      Drag one or more files from the Explorer and drop them onto the
 *      panel.  The TreeDragAndDropController receives the VS Code URIs
 *      reliably and copies the file to the clipboard.
 *      The panel also shows a history of recently staged files so the
 *      user can re-copy any of them just by clicking.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import * as os from 'os';

// ---------------------------------------------------------------------------
// OS clipboard — copy a file as a native file object (not text)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Image extensions recognised for pixel-data clipboard copy
// ---------------------------------------------------------------------------

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.tif', '.webp']);

function isImageFile(p: string): boolean {
  return IMAGE_EXTS.has(path.extname(p).toLowerCase());
}

// ---------------------------------------------------------------------------
// OS clipboard helpers
// ---------------------------------------------------------------------------

/**
 * macOS only — convert any image to PNG with `sips` (built-in) and place the
 * raw PNG pixel data on the clipboard using AppleScript.  Browsers receive
 * this as a proper File object when the user presses ⌘V.
 */
async function copyImageDataToClipboard(imagePath: string): Promise<void> {
  const tmpPng = path.join(os.tmpdir(), `codeplanner-img-${Date.now()}.png`);
  try {
    await new Promise<void>((resolve, reject) => {
      // sips is built into macOS — no external dep needed.
      cp.execFile(
        'sips', ['-s', 'format', 'png', imagePath, '--out', tmpPng],
        { timeout: 15_000 },
        (err) => { if (err) { reject(err); } else { resolve(); } },
      );
    });
    // «class PNGf» tells AppleScript to interpret the raw bytes as a PNG image
    // and write PNG pixel data to the clipboard — exactly what browsers expect.
    const script =
      `set the clipboard to (read (POSIX file ${JSON.stringify(tmpPng)}) as «class PNGf»)`;
    await new Promise<void>((resolve, reject) => {
      cp.execFile('osascript', ['-e', script], { timeout: 8_000 }, (err) => {
        if (err) { reject(err); } else { resolve(); }
      });
    });
  } finally {
    fs.unlink(tmpPng, () => { /* best-effort cleanup */ });
  }
}

/**
 * macOS only — copy all files into a temporary staging folder and open it in
 * Finder with every item pre-selected.  Because all files live in ONE folder
 * the user can drag them all to the browser upload area in a single motion.
 *
 * Returns the staging-folder path so the caller can clean it up later.
 */
async function openStagingFolderInFinder(filePaths: string[], prevDirs: string[]): Promise<string> {
  if (filePaths.length === 0) { return ''; }

  // Close any Finder windows that are showing a previous staging folder,
  // then delete those folders.  This prevents stale windows accumulating
  // every time the user clicks Send again after adding more files.
  if (prevDirs.length > 0) {
    const closeChecks = prevDirs
      .map(d => `(POSIX file ${JSON.stringify(d)} as alias)`)
      .join(', ');
    const closeScript = [
      'tell application "Finder"',
      '  try',
      `    set prevFolders to {${closeChecks}}`,
      '    repeat with prevFolder in prevFolders',
      '      close (every window whose target is prevFolder)',
      '    end repeat',
      '  end try',
      'end tell',
    ].join('\n');
    await new Promise<void>((resolve) => {
      // Best-effort: resolve even on error (folder may already be gone).
      cp.execFile('osascript', ['-e', closeScript], { timeout: 6_000 }, () => resolve());
    });
    for (const dir of prevDirs) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  // Create a fresh temp directory for this batch.
  const stagingDir = path.join(os.tmpdir(), `codeplanner-upload-${Date.now()}`);
  fs.mkdirSync(stagingDir, { recursive: true });

  // Hard-link each file into the staging dir (instant, zero extra disk space).
  // Fall back to a real copy if the link fails (cross-device, read-only fs, etc.).
  const usedNames = new Set<string>();
  for (const filePath of filePaths) {
    let basename = path.basename(filePath);
    // Deduplicate names when multiple files share the same filename.
    if (usedNames.has(basename)) {
      const ext  = path.extname(basename);
      const stem = path.basename(basename, ext);
      let i = 2;
      while (usedNames.has(`${stem}_${i}${ext}`)) { i++; }
      basename = `${stem}_${i}${ext}`;
    }
    usedNames.add(basename);
    const dest = path.join(stagingDir, basename);
    try {
      fs.linkSync(filePath, dest);
    } catch {
      fs.copyFileSync(filePath, dest);
    }
  }

  // Open the staging folder in Finder and pre-select every item so the user
  // can immediately drag them all at once — no manual ⌘A needed.
  const script = [
    'tell application "Finder"',
    '  activate',
    `  set stagingFolder to (POSIX file ${JSON.stringify(stagingDir)}) as alias`,
    '  open stagingFolder',
    '  delay 0.4',
    '  select every item of folder stagingFolder',
    'end tell',
  ].join('\n');

  await new Promise<void>((resolve, reject) => {
    cp.execFile('osascript', ['-e', script], { timeout: 12_000 }, (err) => {
      if (err) { reject(err); } else { resolve(); }
    });
  });

  return stagingDir;
}

/**
 * Windows/Linux — place files on the clipboard as a native file-drop list.
 * (Kept for cross-platform support; paste-to-browser may vary by OS/browser.)
 */
export async function copyFilesToClipboard(filePaths: string[]): Promise<void> {
  if (filePaths.length === 0) { return; }
  const platform = os.platform();
  return new Promise<void>((resolve, reject) => {
    if (platform === 'win32') {
      const adds = filePaths
        .map(p => `$col.Add("${p.replace(/"/g, '\\"')}");`)
        .join(' ');
      const ps = [
        'Add-Type -AssemblyName System.Windows.Forms;',
        '$col = New-Object System.Collections.Specialized.StringCollection;',
        adds,
        '[System.Windows.Forms.Clipboard]::SetFileDropList($col)',
      ].join(' ');
      cp.execFile('powershell', ['-NoProfile', '-Command', ps],
        { timeout: 8_000 }, (err) => {
          if (err) { reject(err); } else { resolve(); }
        });
    } else {
      // Linux — xclip: one file:// URI per line in text/uri-list.
      const uriList = filePaths.map(p => `file://${p}`).join('\n') + '\n';
      const proc = cp.spawn('xclip', ['-selection', 'clipboard', '-t', 'text/uri-list']);
      proc.stdin.write(uriList);
      proc.stdin.end();
      proc.on('close', (code) => {
        if (code === 0) { resolve(); } else { reject(new Error(`xclip exited with ${code}`)); }
      });
      proc.on('error', reject);
    }
  });
}

/** Convenience wrapper for a single file. */
export async function copyFileToClipboard(filePath: string): Promise<void> {
  return copyFilesToClipboard([filePath]);
}

// ---------------------------------------------------------------------------
// Tree items
// ---------------------------------------------------------------------------

class CopilotFileItem extends vscode.TreeItem {
  constructor(public readonly filePath: string) {
    super(path.basename(filePath), vscode.TreeItemCollapsibleState.None);
    this.description = vscode.workspace.asRelativePath(filePath, false);
    this.tooltip     = filePath;
    this.iconPath    = new vscode.ThemeIcon('file');
    this.contextValue = 'copilotFileItem';
    // Clicking the item re-copies it to the clipboard.
    this.command = {
      command:   'codeplanner.copilotRecopyFile',
      title:     'Re-copy to Clipboard',
      arguments: [this],
    };
  }
}

/**
 * Placeholder shown when no files are staged.
 * Having at least one item in the tree is what makes VS Code render the
 * drop-target hit area — without it, drag-and-drop is silently ignored.
 */
class DropHintItem extends vscode.TreeItem {
  constructor() {
    super('Drop files here from Explorer', vscode.TreeItemCollapsibleState.None);
    this.tooltip      = 'Drag files from the Explorer panel and drop them here to stage for upload';
    this.iconPath     = new vscode.ThemeIcon('arrow-down');
    this.contextValue = 'copilotDropHint';
    // No command — clicking this item does nothing.
  }
}

type TreeEntry = CopilotFileItem | DropHintItem;

// ---------------------------------------------------------------------------
// TreeDataProvider + TreeDragAndDropController
// ---------------------------------------------------------------------------

/**
 * Powers the "UPLOAD FILES" sidebar panel.
 *
 * Accepts drops from the VS Code Explorer via TreeDragAndDropController,
 * which is the only reliable way to receive Explorer-sourced file URIs
 * inside an extension (WebViews cannot receive Explorer drag data).
 */
export class CopilotFilesProvider
  implements
    vscode.TreeDataProvider<TreeEntry>,
    vscode.TreeDragAndDropController<TreeEntry>
{
  /** Staging directories created for macOS Finder uploads; cleaned up on clear/dispose. */
  private _stagingDirs: string[] = [];
  // ── TreeDragAndDropController ──────────────────────────────────────────────

  /** Mime types this controller accepts when items are dropped onto the tree. */
  readonly dropMimeTypes: string[] = [
    // VS Code Explorer populates text/uri-list with file:// URIs when
    // files are dragged out of the built-in explorer tree.
    'text/uri-list',
    // VS Code also emits this internal mime type for explorer-tree drags.
    'application/vnd.code.tree.workbench.explorer.fileView',
  ];

  /** We don't expose our items as drag sources. */
  readonly dragMimeTypes: string[] = [];

  /** Called when items from the Explorer (or another tree) are dropped here. */
  async handleDrop(
    _target: TreeEntry | undefined,
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const droppedPaths = await this._extractPaths(dataTransfer);

    if (droppedPaths.length === 0) {
      vscode.window.showWarningMessage(
        'CodePlanner: No file paths found in drop. ' +
        'Try right-clicking the file and choosing "Send to Upload Files".',
      );
      return;
    }

    for (const p of droppedPaths) {
      this._addFile(p);
    }

    // Just update the list — do NOT open Finder here.
    // Opening Finder on every drop would pop a new window for each file dragged.
    // The user triggers the Finder + M365 Copilot flow explicitly via the
    // title-bar "Send" button or "Copy All to Clipboard".
    const count = droppedPaths.length;
    const total = this._files.length;
    const added = count === 1
      ? `"${path.basename(droppedPaths[0])}"`
      : `${count} files`;
    const totalNote = total > count ? `. ${total} files staged total` : '';
    vscode.window.showInformationMessage(
      `CodePlanner: ${added} added to Upload Files${totalNote} — click the send icon to upload.`,
    );
  }

  // ── TreeDataProvider ───────────────────────────────────────────────────────

  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<TreeEntry | undefined | void>();

  readonly onDidChangeTreeData: vscode.Event<TreeEntry | undefined | void> =
    this._onDidChangeTreeData.event;

  private _files: string[] = [];

  getTreeItem(element: TreeEntry): vscode.TreeItem {
    return element;
  }

  getChildren(): TreeEntry[] {
    // Always return at least the hint item so that VS Code renders a drop
    // target even before any files have been staged.  An empty tree has no
    // hit area and drag-and-drop is silently ignored by VS Code.
    if (this._files.length === 0) {
      return [new DropHintItem()];
    }
    return this._files.map(f => new CopilotFileItem(f));
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Add a file to the staged list (called from the context-menu command). */
  addFile(filePath: string): void {
    this._addFile(filePath);
  }

  /** Remove all staged files and clean up any temp staging folders. */
  clearFiles(): void {
    this._files = [];
    this._onDidChangeTreeData.fire();
    this._cleanStagingDirs();
  }

  /** Dispose: clean up staging folders on extension deactivate. */
  dispose(): void {
    this._cleanStagingDirs();
  }

  private _cleanStagingDirs(): void {
    for (const dir of this._stagingDirs) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    this._stagingDirs = [];
  }

  /**
   * Copy ALL currently staged files to the clipboard at once, then notify.
   * This is the primary action — triggered by drops, right-click, and the
   * "Copy All to Clipboard" title-bar button.
   */
  async copyAllAndNotify(): Promise<void> {
    return this._copyAllAndNotify();
  }

  /**
   * Re-copy a single staged file to the clipboard (for item-click in tree).
   * Does NOT affect the rest of the staged list.
   */
  async copyAndNotify(filePath: string): Promise<void> {
    await this._copyAndNotify([filePath]);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _addFile(filePath: string): void {
    if (!this._files.includes(filePath)) {
      this._files.unshift(filePath);
    }
    this._onDidChangeTreeData.fire();
  }

  /** Copy ALL staged files at once. */
  private async _copyAllAndNotify(): Promise<void> {
    if (this._files.length === 0) {
      vscode.window.showInformationMessage(
        'CodePlanner: No files staged yet — drag files onto the Upload Files panel or right-click a file and choose "Send to Upload Files".',
      );
      return;
    }
    return this._copyAndNotify(this._files);
  }

  private async _copyAndNotify(filePaths: string[]): Promise<void> {
    const platform = os.platform();
    const label = filePaths.length === 1
      ? `"${path.basename(filePaths[0])}"`
      : `${filePaths.length} files`;

    if (platform === 'darwin') {
      // ── macOS ────────────────────────────────────────────────────
      // Strategy:
      //  1. Copy all files into a single temp staging folder.
      //  2. Open that folder in Finder with ALL items pre-selected.
      //  3. Open M365 Copilot in the Simple Browser side-by-side.
      //  → The user just drags from the Finder window to the browser — ONE drag,
      //    regardless of how many files are staged or where they came from.
      //
      //  Bonus for image-only batches: also copy the first image as PNG pixel
      //  data so the user can ⌘V it as an alternative.

      const images    = filePaths.filter(isImageFile);
      const nonImages = filePaths.filter(p => !isImageFile(p));

      let clipboardMsg = '';
      if (images.length > 0) {
        try {
          await copyImageDataToClipboard(images[0]);
          clipboardMsg = images.length === 1 && nonImages.length === 0
            ? ' Also on clipboard — press ⌘V to paste directly.'
            : ' First image also on clipboard (⌘V).';
        } catch {
          // Non-fatal; Finder reveal still proceeds.
        }
      }

      // Open staging folder (all files together, all pre-selected).
      // Pass in any existing staging dirs so their Finder windows are closed
      // first — prevents a new window opening on top of the old one.
      const prevDirs = [...this._stagingDirs];
      this._stagingDirs = [];
      let stagingDir: string;
      try {
        stagingDir = await openStagingFolderInFinder(filePaths, prevDirs);
        if (stagingDir) { this._stagingDirs.push(stagingDir); }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`CodePlanner: Could not open staging folder — ${msg}`);
        return;
      }

      // Open M365 Copilot in Simple Browser beside the current editor so the
      // user can drag straight from Finder to the browser in one motion.
      await vscode.commands.executeCommand(
        'simpleBrowser.show', 'https://m365.cloud.microsoft/chat/',
      );

      const countNote = filePaths.length === 1
        ? `"${path.basename(filePaths[0])}" is`
        : `All ${filePaths.length} files are`;

      vscode.window.showInformationMessage(
        `${countNote} selected in Finder — drag them to the M365 Copilot browser window.${clipboardMsg}`,
      );

    } else {
      // ── Windows / Linux ─────────────────────────────────────────
      const pasteKey = platform === 'win32' ? 'Ctrl+V' : 'Ctrl+V';
      try {
        await copyFilesToClipboard(filePaths);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`CodePlanner: Could not copy to clipboard — ${msg}`);
        return;
      }
      const action = await vscode.window.showInformationMessage(
        `${label} copied to clipboard — press ${pasteKey} to attach.`,
        'Open in Browser',
      );
      if (action === 'Open in Browser') {
        await vscode.commands.executeCommand(
          'simpleBrowser.show', 'https://m365.cloud.microsoft/chat/',
        );
      }
    }
  }

  /**
   * Extract file-system paths from a VS Code DataTransfer object,
   * trying every known mime type in sequence so drops work regardless
   * of which VS Code version / tree the drag originated from.
   */
  private async _extractPaths(dataTransfer: vscode.DataTransfer): Promise<string[]> {
    const paths: string[] = [];

    // ── Strategy 1: VS Code Explorer internal mime type ─────────────────────
    // VS Code encodes explorer items as a JSON array of URI-shaped objects.
    const explorerItem = dataTransfer.get(
      'application/vnd.code.tree.workbench.explorer.fileView',
    );
    if (explorerItem) {
      try {
        const json = await explorerItem.asString();
        // Each entry may have fsPath / path / external fields.
        const entries: Array<Record<string, string>> = JSON.parse(json);
        for (const entry of entries) {
          const p = entry.fsPath || entry.path;
          if (p) { paths.push(p); }
        }
      } catch {
        // Ignore JSON parse errors; fall through to next strategy.
      }
    }

    if (paths.length > 0) { return paths; }

    // ── Strategy 2: text/uri-list (standard W3C, also used by VS Code) ───────
    const uriListItem = dataTransfer.get('text/uri-list');
    if (uriListItem) {
      const text = await uriListItem.asString();
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) { continue; }
        try {
          const uri = vscode.Uri.parse(trimmed);
          if (uri.scheme === 'file') { paths.push(uri.fsPath); }
        } catch {
          // Skip malformed lines.
        }
      }
    }

    if (paths.length > 0) { return paths; }

    // ── Strategy 3: iterate DataTransfer for DataTransferFile entries ─────────
    dataTransfer.forEach((item) => {
      const file = item.asFile?.();
      if (file?.uri?.fsPath) {
        paths.push(file.uri.fsPath);
      }
    });

    return paths;
  }
}

// ---------------------------------------------------------------------------
// Command: Send to M365 Copilot (Explorer context-menu handler)
// ---------------------------------------------------------------------------

/**
 * Right-click a file in Explorer → "Send to Upload Files",
 * or keyboard shortcut while any file is open in the editor.
 *
 * VS Code passes the right-clicked URI as `uri` and all selected URIs as
 * `selectedUris` when the user has multi-selected files in the Explorer.
 * Keyboard shortcuts provide no arguments — the active editor's file is
 * used in that case (VS Code has no public API to read Explorer selection
 * when triggered via keybinding).
 */
export async function cmdSendToM365Copilot(
  provider: CopilotFilesProvider,
  uri?:          vscode.Uri,
  selectedUris?: vscode.Uri[],
): Promise<void> {
  let uris: vscode.Uri[] = [];

  if (selectedUris && selectedUris.length > 0) {
    uris = selectedUris;
  } else if (uri) {
    uris = [uri];
  } else {
    // Keyboard shortcut / palette invocation — use the currently open file.
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    if (activeUri && activeUri.scheme === 'file') {
      uris = [activeUri];
    } else {
      vscode.window.showInformationMessage(
        'CodePlanner: Open a file in the editor first, or right-click a file in ' +
        'the Explorer and choose "Send to Upload Files".',
      );
      return;
    }
  }

  if (uris.length === 0) { return; }

  for (const u of uris) {
    provider.addFile(u.fsPath);
  }

  // Copy ALL staged files (including any previously staged ones) in one go.
  await provider.copyAllAndNotify();
}
