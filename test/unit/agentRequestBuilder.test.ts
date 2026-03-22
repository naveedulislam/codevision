/**
 * Unit tests for agentRequestBuilder.ts
 *
 * Tests the FileDropEditProvider, agent request template building,
 * workspace context insertion, and error diagnostics insertion.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Must import the mock before the module under test
jest.mock('vscode');

// Mock child_process.exec for git commands
jest.mock('child_process', () => ({
  exec: jest.fn(),
  execFile: jest.fn(),
  spawn: jest.fn(),
}));

import * as vscode from 'vscode';
import {
  FileDropEditProvider,
  cmdNewAgentRequest,
  cmdInsertWorkspaceContext,
  cmdInsertErrors,
} from '../../src/agentRequestBuilder';

// ---------------------------------------------------------------------------
// FileDropEditProvider
// ---------------------------------------------------------------------------

describe('FileDropEditProvider', () => {
  let provider: FileDropEditProvider;

  beforeEach(() => {
    provider = new FileDropEditProvider();
    jest.clearAllMocks();
  });

  it('should return undefined if no text/plain in DataTransfer', async () => {
    const doc = {
      uri: vscode.Uri.file('/test-workspace/README.md'),
    } as unknown as vscode.TextDocument;
    const pos = new vscode.Position(0, 0);
    const dt = new vscode.DataTransfer();
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideDocumentDropEdits(
      doc, pos, dt, token as unknown as vscode.CancellationToken,
    );

    expect(result).toBeUndefined();
  });

  it('should return undefined for non-absolute paths', async () => {
    const doc = {
      uri: vscode.Uri.file('/test-workspace/README.md'),
    } as unknown as vscode.TextDocument;
    const pos = new vscode.Position(0, 0);
    const dt = new vscode.DataTransfer();
    dt.set('text/plain', new vscode.DataTransferItem('relative/path.ts'));
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideDocumentDropEdits(
      doc, pos, dt, token as unknown as vscode.CancellationToken,
    );

    expect(result).toBeUndefined();
  });

  it('should insert relative path when file is in workspace', async () => {
    const doc = {
      uri: vscode.Uri.file('/test-workspace/README.md'),
    } as unknown as vscode.TextDocument;
    const pos = new vscode.Position(2, 0);
    const dt = new vscode.DataTransfer();
    dt.set('text/plain', new vscode.DataTransferItem('/test-workspace/src/extension.ts'));
    const token = new vscode.CancellationTokenSource().token;

    // Mock getWorkspaceFolder to return the workspace
    (vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue({
      uri: vscode.Uri.file('/test-workspace'),
      name: 'test-workspace',
      index: 0,
    });

    const result = await provider.provideDocumentDropEdits(
      doc, pos, dt, token as unknown as vscode.CancellationToken,
    );

    expect(result).toBeDefined();
    expect(result!.insertText).toBe('src/extension.ts');
  });

  it('should use absolute path when no workspace folder is found', async () => {
    const doc = {
      uri: vscode.Uri.file('/other/README.md'),
    } as unknown as vscode.TextDocument;
    const pos = new vscode.Position(0, 0);
    const dt = new vscode.DataTransfer();
    dt.set('text/plain', new vscode.DataTransferItem('/some/absolute/file.ts'));
    const token = new vscode.CancellationTokenSource().token;

    (vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue(undefined);
    // Also clear workspaceFolders
    const origFolders = vscode.workspace.workspaceFolders;
    (vscode.workspace as any).workspaceFolders = undefined;

    const result = await provider.provideDocumentDropEdits(
      doc, pos, dt, token as unknown as vscode.CancellationToken,
    );

    expect(result).toBeDefined();
    expect(result!.insertText).toBe('/some/absolute/file.ts');

    // Restore
    (vscode.workspace as any).workspaceFolders = origFolders;
  });
});

// ---------------------------------------------------------------------------
// cmdNewAgentRequest
// ---------------------------------------------------------------------------

describe('cmdNewAgentRequest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create a new markdown document with the agent request template', async () => {
    let capturedContent = '';
    (vscode.workspace.openTextDocument as jest.Mock).mockImplementation(
      (args: { content: string; language: string }) => {
        capturedContent = args.content;
        return Promise.resolve({
          uri: vscode.Uri.file('/untitled.md'),
          getText: () => capturedContent,
          lineCount: capturedContent.split('\n').length,
        });
      },
    );

    await cmdNewAgentRequest();

    expect(vscode.workspace.openTextDocument).toHaveBeenCalledTimes(1);
    expect(vscode.window.showTextDocument).toHaveBeenCalledTimes(1);

    // Verify template content
    expect(capturedContent).toContain('# Agent Request');
    expect(capturedContent).toContain('## Task');
    expect(capturedContent).toContain('## Files & References');
    expect(capturedContent).toContain('## Workspace Context');
    expect(capturedContent).toContain('## Errors & Diagnostics');
    expect(capturedContent).toContain('## Instructions');
    expect(capturedContent).toContain('## Constraints & Notes');
    expect(capturedContent).toContain('## Expected Output');
  });

  it('should include workspace name and current date in template', async () => {
    let capturedContent = '';
    (vscode.workspace.openTextDocument as jest.Mock).mockImplementation(
      (args: { content: string; language: string }) => {
        capturedContent = args.content;
        return Promise.resolve({
          uri: vscode.Uri.file('/untitled.md'),
          getText: () => capturedContent,
          lineCount: capturedContent.split('\n').length,
        });
      },
    );

    await cmdNewAgentRequest();

    expect(capturedContent).toContain('**Workspace:** test-workspace');
    const today = new Date().toISOString().slice(0, 10);
    expect(capturedContent).toContain(`**Date:** ${today}`);
  });

  it('should include platform info in template', async () => {
    let capturedContent = '';
    (vscode.workspace.openTextDocument as jest.Mock).mockImplementation(
      (args: { content: string; language: string }) => {
        capturedContent = args.content;
        return Promise.resolve({
          uri: vscode.Uri.file('/untitled.md'),
          getText: () => capturedContent,
          lineCount: capturedContent.split('\n').length,
        });
      },
    );

    await cmdNewAgentRequest();

    expect(capturedContent).toContain(`**Platform:** ${os.platform()}`);
    expect(capturedContent).toContain(`Node ${process.version}`);
  });

  it('should set cursor to the Task section', async () => {
    let capturedContent = '';
    const mockEditor = {
      selection: new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0)),
      revealRange: jest.fn(),
    };

    (vscode.workspace.openTextDocument as jest.Mock).mockImplementation(
      (args: { content: string; language: string }) => {
        capturedContent = args.content;
        return Promise.resolve({
          uri: vscode.Uri.file('/untitled.md'),
          getText: () => capturedContent,
          lineCount: capturedContent.split('\n').length,
        });
      },
    );
    (vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor);

    await cmdNewAgentRequest();

    // The cursor should be placed 2 lines after "## Task"
    const lines = capturedContent.split('\n');
    const taskIdx = lines.findIndex((l: string) => l === '## Task');
    expect(taskIdx).toBeGreaterThanOrEqual(0);
    expect(mockEditor.revealRange).toHaveBeenCalled();
  });

  it('should use "workspace" as fallback when no workspace folder', async () => {
    const origFolders = vscode.workspace.workspaceFolders;
    (vscode.workspace as any).workspaceFolders = undefined;

    let capturedContent = '';
    (vscode.workspace.openTextDocument as jest.Mock).mockImplementation(
      (args: { content: string; language: string }) => {
        capturedContent = args.content;
        return Promise.resolve({
          uri: vscode.Uri.file('/untitled.md'),
          getText: () => capturedContent,
          lineCount: capturedContent.split('\n').length,
        });
      },
    );

    await cmdNewAgentRequest();

    expect(capturedContent).toContain('**Workspace:** workspace');

    (vscode.workspace as any).workspaceFolders = origFolders;
  });
});

// ---------------------------------------------------------------------------
// cmdInsertWorkspaceContext
// ---------------------------------------------------------------------------

describe('cmdInsertWorkspaceContext', () => {
  const cp = require('child_process');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should do nothing when there is no active editor', async () => {
    const origEditor = vscode.window.activeTextEditor;
    (vscode.window as any).activeTextEditor = undefined;

    await cmdInsertWorkspaceContext();

    expect(cp.exec).not.toHaveBeenCalled();

    (vscode.window as any).activeTextEditor = origEditor;
  });

  it('should show warning when no workspace folder is open', async () => {
    const origFolders = vscode.workspace.workspaceFolders;
    (vscode.workspace as any).workspaceFolders = undefined;

    await cmdInsertWorkspaceContext();

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'CodePlanner: No workspace folder open.',
    );

    (vscode.workspace as any).workspaceFolders = origFolders;
  });

  it('should insert project tree and git info', async () => {
    // Set up a temporary directory structure for buildFileTree
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
    fs.mkdirSync(path.join(tmpDir, 'src'));
    fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '');

    (vscode.workspace as any).workspaceFolders = [
      { uri: vscode.Uri.file(tmpDir), name: 'test-proj', index: 0 },
    ];

    // Mock git commands
    (cp.exec as jest.Mock).mockImplementation(
      (cmd: string, _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
        if (cmd.includes('rev-parse')) {
          cb(null, 'main\n');
        } else if (cmd.includes('status')) {
          cb(null, ' M src/index.ts\n');
        }
      },
    );

    const insertedText: string[] = [];
    const mockEditor = {
      selection: { active: new vscode.Position(5, 0) },
      edit: jest.fn().mockImplementation((cb: (eb: { insert: jest.Mock }) => void) => {
        const eb = { insert: jest.fn().mockImplementation((_pos: unknown, text: string) => {
          insertedText.push(text);
        }) };
        cb(eb);
        return Promise.resolve(true);
      }),
    };
    (vscode.window as any).activeTextEditor = mockEditor;

    await cmdInsertWorkspaceContext();

    expect(insertedText.length).toBe(1);
    const text = insertedText[0];
    expect(text).toContain('### Project: test-proj');
    expect(text).toContain('src/');
    expect(text).toContain('README.md');
    expect(text).toContain('### Git');
    expect(text).toContain('Branch: `main`');
    expect(text).toContain('M src/index.ts');

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// cmdInsertErrors
// ---------------------------------------------------------------------------

describe('cmdInsertErrors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should do nothing when there is no active editor', async () => {
    const origEditor = vscode.window.activeTextEditor;
    (vscode.window as any).activeTextEditor = undefined;

    await cmdInsertErrors();

    expect(vscode.languages.getDiagnostics).not.toHaveBeenCalled();

    (vscode.window as any).activeTextEditor = origEditor;
  });

  it('should insert "no errors" message when diagnostics are empty', async () => {
    (vscode.languages.getDiagnostics as jest.Mock).mockReturnValue([]);

    const insertedText: string[] = [];
    const mockEditor = {
      selection: { active: new vscode.Position(0, 0) },
      edit: jest.fn().mockImplementation((cb: (eb: { insert: jest.Mock }) => void) => {
        const eb = { insert: jest.fn().mockImplementation((_pos: unknown, text: string) => {
          insertedText.push(text);
        }) };
        cb(eb);
        return Promise.resolve(true);
      }),
    };
    (vscode.window as any).activeTextEditor = mockEditor;

    await cmdInsertErrors();

    expect(insertedText.length).toBe(1);
    expect(insertedText[0]).toContain('No errors or warnings');
  });

  it('should format errors and warnings correctly', async () => {
    (vscode.languages.getDiagnostics as jest.Mock).mockReturnValue([
      [
        vscode.Uri.file('/test-workspace/src/app.ts'),
        [
          {
            range: { start: { line: 9, character: 0 } },
            message: 'Type error: string is not assignable to number',
            severity: vscode.DiagnosticSeverity.Error,
          },
          {
            range: { start: { line: 20, character: 5 } },
            message: 'Unused variable x',
            severity: vscode.DiagnosticSeverity.Warning,
          },
        ],
      ],
    ]);

    const insertedText: string[] = [];
    const mockEditor = {
      selection: { active: new vscode.Position(0, 0) },
      edit: jest.fn().mockImplementation((cb: (eb: { insert: jest.Mock }) => void) => {
        const eb = { insert: jest.fn().mockImplementation((_pos: unknown, text: string) => {
          insertedText.push(text);
        }) };
        cb(eb);
        return Promise.resolve(true);
      }),
    };
    (vscode.window as any).activeTextEditor = mockEditor;

    await cmdInsertErrors();

    const text = insertedText[0];
    expect(text).toContain('1 errors, 1 warnings');
    expect(text).toContain('ERRORS:');
    expect(text).toContain('WARNINGS:');
    expect(text).toContain(':10');  // line 9 + 1
    expect(text).toContain(':21');  // line 20 + 1
    expect(text).toContain('Type error');
    expect(text).toContain('Unused variable x');
  });
});
