/**
 * Unit tests for copilotBridge.ts
 *
 * Tests the CopilotFilesProvider tree data provider, file staging,
 * clipboard helpers, and the cmdSendToM365Copilot command.
 */

jest.mock('vscode');
jest.mock('child_process', () => ({
  exec: jest.fn(),
  execFile: jest.fn(),
  spawn: jest.fn(),
}));

import * as vscode from 'vscode';
import {
  CopilotFilesProvider,
  cmdSendToM365Copilot,
} from '../../src/copilotBridge';

describe('CopilotFilesProvider', () => {
  let provider: CopilotFilesProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new CopilotFilesProvider();
  });

  describe('getChildren', () => {
    it('should return a DropHintItem when no files are staged', () => {
      const children = provider.getChildren();

      expect(children).toHaveLength(1);
      expect(children[0].label).toBe('Drop files here from Explorer');
      expect(children[0].contextValue).toBe('copilotDropHint');
    });

    it('should return CopilotFileItems when files are staged', () => {
      provider.addFile('/path/to/file1.ts');
      provider.addFile('/path/to/file2.ts');

      const children = provider.getChildren();

      expect(children).toHaveLength(2);
      // Files are prepended (unshift), so most recent is first
      expect(children[0].label).toBe('file2.ts');
      expect(children[1].label).toBe('file1.ts');
    });

    it('should not add duplicate files', () => {
      provider.addFile('/path/to/file1.ts');
      provider.addFile('/path/to/file1.ts');

      const children = provider.getChildren();

      expect(children).toHaveLength(1);
    });

    it('should prepend new files (most recent first)', () => {
      provider.addFile('/path/to/first.ts');
      provider.addFile('/path/to/second.ts');

      const children = provider.getChildren();

      expect(children[0].label).toBe('second.ts');
      expect(children[1].label).toBe('first.ts');
    });
  });

  describe('getTreeItem', () => {
    it('should return the element as-is', () => {
      provider.addFile('/path/to/file.ts');
      const children = provider.getChildren();
      const item = children[0];

      const treeItem = provider.getTreeItem(item);

      expect(treeItem).toBe(item);
    });
  });

  describe('clearFiles', () => {
    it('should remove all staged files', () => {
      provider.addFile('/path/to/file1.ts');
      provider.addFile('/path/to/file2.ts');

      provider.clearFiles();

      const children = provider.getChildren();
      expect(children).toHaveLength(1); // Only the DropHintItem
      expect(children[0].contextValue).toBe('copilotDropHint');
    });
  });

  describe('CopilotFileItem properties', () => {
    it('should have correct icon and context value', () => {
      provider.addFile('/test-workspace/src/app.ts');
      const children = provider.getChildren();
      const item = children[0];

      expect(item.contextValue).toBe('copilotFileItem');
      expect((item.iconPath as vscode.ThemeIcon).id).toBe('file');
    });

    it('should show relative path as description', () => {
      provider.addFile('/test-workspace/src/app.ts');
      const children = provider.getChildren();
      const item = children[0];

      expect(item.description).toBeDefined();
    });
  });

  describe('copyAllAndNotify', () => {
    it('should show info message when no files are staged', async () => {
      await provider.copyAllAndNotify();

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('No files staged'),
      );
    });
  });

  describe('onDidChangeTreeData', () => {
    it('should fire when a file is added', () => {
      const listener = jest.fn();
      provider.onDidChangeTreeData(listener);

      provider.addFile('/path/to/file.ts');

      expect(listener).toHaveBeenCalled();
    });

    it('should fire when files are cleared', () => {
      const listener = jest.fn();
      provider.onDidChangeTreeData(listener);

      provider.addFile('/path/to/file.ts');
      listener.mockClear();

      provider.clearFiles();

      expect(listener).toHaveBeenCalled();
    });
  });

  describe('handleDrop', () => {
    it('should add files from text/uri-list DataTransfer', async () => {
      const dt = new vscode.DataTransfer();
      dt.set(
        'text/uri-list',
        new vscode.DataTransferItem('file:///path/to/dropped.ts'),
      );
      const token = new vscode.CancellationTokenSource().token;

      await provider.handleDrop(
        undefined,
        dt,
        token as unknown as vscode.CancellationToken,
      );

      const children = provider.getChildren();
      expect(children).toHaveLength(1);
      expect(children[0].label).toBe('dropped.ts');
    });

    it('should show warning when no paths found in drop', async () => {
      const dt = new vscode.DataTransfer();
      const token = new vscode.CancellationTokenSource().token;

      await provider.handleDrop(
        undefined,
        dt,
        token as unknown as vscode.CancellationToken,
      );

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('No file paths found'),
      );
    });

    it('should handle multi-file drops', async () => {
      const dt = new vscode.DataTransfer();
      dt.set(
        'text/uri-list',
        new vscode.DataTransferItem(
          'file:///path/to/a.ts\nfile:///path/to/b.ts',
        ),
      );
      const token = new vscode.CancellationTokenSource().token;

      await provider.handleDrop(
        undefined,
        dt,
        token as unknown as vscode.CancellationToken,
      );

      const children = provider.getChildren();
      expect(children).toHaveLength(2);
    });

    it('should skip comment lines in uri-list', async () => {
      const dt = new vscode.DataTransfer();
      dt.set(
        'text/uri-list',
        new vscode.DataTransferItem(
          '# This is a comment\nfile:///path/to/file.ts',
        ),
      );
      const token = new vscode.CancellationTokenSource().token;

      await provider.handleDrop(
        undefined,
        dt,
        token as unknown as vscode.CancellationToken,
      );

      const children = provider.getChildren();
      expect(children).toHaveLength(1);
      expect(children[0].label).toBe('file.ts');
    });

    it('should handle explorer JSON DataTransfer', async () => {
      const dt = new vscode.DataTransfer();
      dt.set(
        'application/vnd.code.tree.workbench.explorer.fileView',
        new vscode.DataTransferItem(
          JSON.stringify([{ fsPath: '/path/to/explorer-file.ts' }]),
        ),
      );
      const token = new vscode.CancellationTokenSource().token;

      await provider.handleDrop(
        undefined,
        dt,
        token as unknown as vscode.CancellationToken,
      );

      const children = provider.getChildren();
      expect(children).toHaveLength(1);
      expect(children[0].label).toBe('explorer-file.ts');
    });
  });

  describe('dropMimeTypes', () => {
    it('should accept text/uri-list and explorer mime types', () => {
      expect(provider.dropMimeTypes).toContain('text/uri-list');
      expect(provider.dropMimeTypes).toContain(
        'application/vnd.code.tree.workbench.explorer.fileView',
      );
    });
  });

  describe('dispose', () => {
    it('should not throw', () => {
      expect(() => provider.dispose()).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// cmdSendToM365Copilot
// ---------------------------------------------------------------------------

describe('cmdSendToM365Copilot', () => {
  let provider: CopilotFilesProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new CopilotFilesProvider();
  });

  it('should add file from URI and call copyAllAndNotify', async () => {
    const addSpy = jest.spyOn(provider, 'addFile');
    const copySpy = jest.spyOn(provider, 'copyAllAndNotify').mockResolvedValue();

    const uri = vscode.Uri.file('/path/to/file.ts');
    await cmdSendToM365Copilot(provider, uri);

    expect(addSpy).toHaveBeenCalledWith('/path/to/file.ts');
    expect(copySpy).toHaveBeenCalled();
  });

  it('should handle multi-select URIs', async () => {
    const addSpy = jest.spyOn(provider, 'addFile');
    const copySpy = jest.spyOn(provider, 'copyAllAndNotify').mockResolvedValue();

    const uri1 = vscode.Uri.file('/path/to/a.ts');
    const uri2 = vscode.Uri.file('/path/to/b.ts');
    await cmdSendToM365Copilot(provider, uri1, [uri1, uri2]);

    expect(addSpy).toHaveBeenCalledTimes(2);
    expect(copySpy).toHaveBeenCalled();
  });

  it('should use active editor file when no URI provided', async () => {
    const addSpy = jest.spyOn(provider, 'addFile');
    const copySpy = jest.spyOn(provider, 'copyAllAndNotify').mockResolvedValue();

    (vscode.window as any).activeTextEditor = {
      document: {
        uri: vscode.Uri.file('/editor/file.ts'),
      },
    };

    await cmdSendToM365Copilot(provider);

    expect(addSpy).toHaveBeenCalledWith('/editor/file.ts');
    expect(copySpy).toHaveBeenCalled();
  });

  it('should show info message when no file available', async () => {
    (vscode.window as any).activeTextEditor = undefined;

    await cmdSendToM365Copilot(provider);

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Open a file in the editor'),
    );
  });

  it('should skip non-file scheme active editors', async () => {
    (vscode.window as any).activeTextEditor = {
      document: {
        uri: { scheme: 'untitled', fsPath: '' },
      },
    };

    await cmdSendToM365Copilot(provider);

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Open a file in the editor'),
    );
  });
});
