/**
 * Integration tests for CodePlanner
 *
 * Tests interactions between multiple modules, verifying that the
 * command flows work end-to-end (with mocked VS Code and Tesseract APIs).
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

jest.mock('vscode');

// ---------------------------------------------------------------------------
// Mock tesseract.js and image-size
// ---------------------------------------------------------------------------

const mockRecognize = jest.fn();
const mockTerminate = jest.fn().mockResolvedValue(undefined);
const mockCreateWorker = jest.fn().mockResolvedValue({
  recognize: mockRecognize,
  terminate: mockTerminate,
});

jest.mock('tesseract.js', () => ({
  createWorker: mockCreateWorker,
}));

const mockImageSize = jest.fn();
jest.mock('image-size', () => ({
  imageSize: mockImageSize,
}));

jest.mock('child_process', () => ({
  exec: jest.fn(),
  execFile: jest.fn(),
  spawn: jest.fn(),
}));

import * as vscode from 'vscode';
import { recognizeImage, disposeWorker } from '../../src/ocrEngine';
import {
  FileDropEditProvider,
  cmdNewAgentRequest,
  cmdInsertWorkspaceContext,
  cmdInsertErrors,
} from '../../src/agentRequestBuilder';
import {
  CopilotFilesProvider,
  cmdSendToM365Copilot,
} from '../../src/copilotBridge';

// ---------------------------------------------------------------------------
// Integration: OCR engine → outputPanel flow
// ---------------------------------------------------------------------------

describe('Integration: OCR pipeline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await disposeWorker();
  });

  it('should produce a complete OcrResult from recognizeImage', async () => {
    mockImageSize.mockReturnValue({ width: 1024, height: 768 });
    mockRecognize.mockResolvedValue({
      data: {
        text: 'Invoice #12345\nTotal: $99.00\n',
        tsv: 'level\tpage\t...',
        confidence: 92.3,
      },
    });

    const result = await recognizeImage('/images/invoice.png', {
      language: 'eng',
    });

    expect(result).toEqual({
      text: 'Invoice #12345\nTotal: $99.00',
      tsv: 'level\tpage\t...',
      confidence: 92.3,
      imageWidth: 1024,
      imageHeight: 768,
    });
  });

  it('should handle multi-language OCR options', async () => {
    mockImageSize.mockReturnValue({ width: 500, height: 300 });
    mockRecognize.mockResolvedValue({
      data: {
        text: 'Hello مرحبا',
        tsv: '',
        confidence: 78,
      },
    });

    const result = await recognizeImage('/images/bilingual.png', {
      language: 'eng+ara',
    });

    expect(result.text).toBe('Hello مرحبا');
    expect(mockCreateWorker).toHaveBeenCalledWith(
      'eng+ara',
      1,
      expect.any(Object),
    );
  });

  it('should handle OCR with dimensions from TSV fallback', async () => {
    mockImageSize.mockImplementation(() => {
      throw new Error('unknown format');
    });

    const tsvData = [
      'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
      '5\t1\t1\t1\t1\t1\t0\t0\t500\t200\t95\tTest',
      '5\t1\t1\t1\t1\t2\t200\t100\t300\t150\t90\tData',
    ].join('\n');

    mockRecognize.mockResolvedValue({
      data: {
        text: 'Test Data',
        tsv: tsvData,
        confidence: 92,
      },
    });

    const result = await recognizeImage('/images/weird-format.img');

    expect(result.imageWidth).toBe(500);
    expect(result.imageHeight).toBe(250); // max(0+200, 100+150)
  });
});

// ---------------------------------------------------------------------------
// Integration: Agent Request Builder — full workflow
// ---------------------------------------------------------------------------

describe('Integration: Agent Request workflow', () => {
  const cp = require('child_process');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create a request, insert context, and insert errors in sequence', async () => {
    // Step 1: Create a new agent request
    let templateContent = '';
    (vscode.workspace.openTextDocument as jest.Mock).mockImplementation(
      (args: { content: string; language: string }) => {
        templateContent = args.content;
        return Promise.resolve({
          uri: vscode.Uri.file('/untitled.md'),
          getText: () => templateContent,
          lineCount: templateContent.split('\n').length,
        });
      },
    );

    const mockEditor = {
      document: { uri: vscode.Uri.file('/untitled.md') },
      selection: new vscode.Selection(
        new vscode.Position(0, 0),
        new vscode.Position(0, 0),
      ),
      edit: jest.fn().mockImplementation((cb: (eb: { insert: jest.Mock }) => void) => {
        const eb = { insert: jest.fn() };
        cb(eb);
        return Promise.resolve(true);
      }),
      revealRange: jest.fn(),
    };
    (vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor);

    await cmdNewAgentRequest();

    // Verify the template was created
    expect(templateContent).toContain('# Agent Request');
    expect(templateContent).toContain('## Task');

    // Step 2: Insert workspace context
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-integ-'));
    fs.mkdirSync(path.join(tmpDir, 'src'));
    fs.writeFileSync(path.join(tmpDir, 'src', 'main.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');

    (vscode.workspace as any).workspaceFolders = [
      { uri: vscode.Uri.file(tmpDir), name: 'my-project', index: 0 },
    ];

    (cp.exec as jest.Mock).mockImplementation(
      (cmd: string, _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
        if (cmd.includes('rev-parse')) { cb(null, 'develop\n'); }
        else if (cmd.includes('status')) { cb(null, ' M src/main.ts\n?? new-file.ts\n'); }
      },
    );

    const insertedTexts: string[] = [];
    mockEditor.edit.mockImplementation((cb: (eb: { insert: jest.Mock }) => void) => {
      const eb = {
        insert: jest.fn().mockImplementation((_pos: unknown, text: string) => {
          insertedTexts.push(text);
        }),
      };
      cb(eb);
      return Promise.resolve(true);
    });
    (vscode.window as any).activeTextEditor = mockEditor;

    await cmdInsertWorkspaceContext();

    expect(insertedTexts.length).toBeGreaterThan(0);
    const wsContext = insertedTexts[insertedTexts.length - 1];
    expect(wsContext).toContain('### Project: my-project');
    expect(wsContext).toContain('Branch: `develop`');
    expect(wsContext).toContain('M src/main.ts');

    // Step 3: Insert diagnostics
    (vscode.languages.getDiagnostics as jest.Mock).mockReturnValue([
      [
        vscode.Uri.file(path.join(tmpDir, 'src', 'main.ts')),
        [
          {
            range: { start: { line: 4, character: 0 } },
            message: 'Cannot find module "./missing"',
            severity: vscode.DiagnosticSeverity.Error,
          },
        ],
      ],
    ]);

    insertedTexts.length = 0;

    await cmdInsertErrors();

    const diagsText = insertedTexts[insertedTexts.length - 1];
    expect(diagsText).toContain('1 errors');
    expect(diagsText).toContain(':5'); // line 4 + 1
    expect(diagsText).toContain('Cannot find module');

    // Cleanup temp dir
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Integration: Copilot Upload Files — stage + send flow
// ---------------------------------------------------------------------------

describe('Integration: Upload Files staging flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should stage files from Explorer context menu and via drop', async () => {
    const provider = new CopilotFilesProvider();

    // Stage a file via context menu
    const copySpy = jest.spyOn(provider, 'copyAllAndNotify').mockResolvedValue();

    await cmdSendToM365Copilot(
      provider,
      vscode.Uri.file('/project/src/app.ts'),
    );

    expect(provider.getChildren()).toHaveLength(1);
    expect(copySpy).toHaveBeenCalledTimes(1);

    copySpy.mockClear();

    // Drop another file via DataTransfer
    const dt = new vscode.DataTransfer();
    dt.set(
      'text/uri-list',
      new vscode.DataTransferItem('file:///project/src/styles.css'),
    );

    await provider.handleDrop(
      undefined,
      dt,
      new vscode.CancellationTokenSource().token as unknown as vscode.CancellationToken,
    );

    expect(provider.getChildren()).toHaveLength(2);

    // Stage a third file via multi-select
    copySpy.mockResolvedValue();
    await cmdSendToM365Copilot(
      provider,
      vscode.Uri.file('/project/src/index.ts'),
      [
        vscode.Uri.file('/project/src/index.ts'),
        vscode.Uri.file('/project/src/utils.ts'),
      ],
    );

    expect(provider.getChildren()).toHaveLength(4);
    expect(copySpy).toHaveBeenCalledTimes(1);

    // Clear all
    provider.clearFiles();
    const children = provider.getChildren();
    expect(children).toHaveLength(1); // Just the hint item
    expect(children[0].contextValue).toBe('copilotDropHint');
  });

  it('should preserve files across multiple Send operations', async () => {
    const provider = new CopilotFilesProvider();
    const copySpy = jest.spyOn(provider, 'copyAllAndNotify').mockResolvedValue();

    // Send first file
    await cmdSendToM365Copilot(
      provider,
      vscode.Uri.file('/project/file1.ts'),
    );

    // Send second file — first should still be staged
    await cmdSendToM365Copilot(
      provider,
      vscode.Uri.file('/project/file2.ts'),
    );

    const children = provider.getChildren();
    expect(children).toHaveLength(2);
    expect(copySpy).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Integration: Drop-to-insert path resolution
// ---------------------------------------------------------------------------

describe('Integration: Drop-to-insert path resolution', () => {
  it('should correctly resolve paths across nested workspace structures', async () => {
    const provider = new FileDropEditProvider();

    const doc = {
      uri: vscode.Uri.file('/workspace/docs/guide.md'),
    } as unknown as vscode.TextDocument;

    (vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue({
      uri: vscode.Uri.file('/workspace'),
      name: 'my-workspace',
      index: 0,
    });

    const dt = new vscode.DataTransfer();
    dt.set(
      'text/plain',
      new vscode.DataTransferItem('/workspace/src/components/Button.tsx'),
    );
    const pos = new vscode.Position(5, 0);
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideDocumentDropEdits(
      doc,
      pos,
      dt,
      token as unknown as vscode.CancellationToken,
    );

    expect(result).toBeDefined();
    expect(result!.insertText).toBe('src/components/Button.tsx');
  });

  it('should handle Windows-style backslash paths on non-Windows', async () => {
    const provider = new FileDropEditProvider();

    const doc = {
      uri: vscode.Uri.file('/workspace/README.md'),
    } as unknown as vscode.TextDocument;

    (vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue({
      uri: vscode.Uri.file('/workspace'),
      name: 'workspace',
      index: 0,
    });

    // On macOS/Linux, path.relative won't produce backslashes
    const dt = new vscode.DataTransfer();
    dt.set(
      'text/plain',
      new vscode.DataTransferItem('/workspace/src/utils/helpers.ts'),
    );
    const pos = new vscode.Position(0, 0);
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideDocumentDropEdits(
      doc,
      pos,
      dt,
      token as unknown as vscode.CancellationToken,
    );

    expect(result).toBeDefined();
    // Should never contain backslashes
    expect(result!.insertText).not.toContain('\\');
  });
});

// ---------------------------------------------------------------------------
// Integration: Worker lifecycle across OCR operations
// ---------------------------------------------------------------------------

describe('Integration: Worker lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateWorker.mockResolvedValue({
      recognize: mockRecognize,
      terminate: mockTerminate,
    });
  });

  afterEach(async () => {
    await disposeWorker();
  });

  it('should handle sequential OCR operations with different languages', async () => {
    mockImageSize.mockReturnValue({ width: 100, height: 100 });
    mockRecognize
      .mockResolvedValueOnce({ data: { text: 'English text', tsv: '', confidence: 95 } })
      .mockResolvedValueOnce({ data: { text: 'نص عربي', tsv: '', confidence: 87 } })
      .mockResolvedValueOnce({ data: { text: 'More English', tsv: '', confidence: 93 } });

    // First call: eng
    const r1 = await recognizeImage('/img1.png', { language: 'eng' });
    expect(r1.text).toBe('English text');

    // Second call: ara — should trigger worker recreation
    const r2 = await recognizeImage('/img2.png', { language: 'ara' });
    expect(r2.text).toBe('نص عربي');
    expect(mockTerminate).toHaveBeenCalledTimes(1);

    // Third call: back to eng — should trigger worker recreation again
    const r3 = await recognizeImage('/img3.png', { language: 'eng' });
    expect(r3.text).toBe('More English');
    expect(mockTerminate).toHaveBeenCalledTimes(2);
    expect(mockCreateWorker).toHaveBeenCalledTimes(3);
  });
});
