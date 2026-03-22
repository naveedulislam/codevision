/**
 * Unit tests for extension.ts
 *
 * Tests extension activation/deactivation and command registration.
 */

jest.mock('vscode');

// Mock ocrEngine
jest.mock('../../src/ocrEngine', () => ({
  recognizeImage: jest.fn(),
  disposeWorker: jest.fn().mockResolvedValue(undefined),
}));

// Mock commands module
jest.mock('../../src/commands', () => ({
  cmdExtractText: jest.fn(),
  cmdExtractTextFromClipboard: jest.fn(),
  cmdCaptureScreenshot: jest.fn(),
}));

// Mock agentRequestBuilder
jest.mock('../../src/agentRequestBuilder', () => ({
  FileDropEditProvider: jest.fn().mockImplementation(() => ({})),
  cmdNewAgentRequest: jest.fn(),
  cmdInsertWorkspaceContext: jest.fn(),
  cmdInsertErrors: jest.fn(),
}));

// Mock copilotBridge
jest.mock('../../src/copilotBridge', () => ({
  CopilotFilesProvider: jest.fn().mockImplementation(() => ({
    copyAndNotify: jest.fn(),
    copyAllAndNotify: jest.fn(),
    clearFiles: jest.fn(),
  })),
  cmdSendToM365Copilot: jest.fn(),
}));

import * as vscode from 'vscode';
import { activate, deactivate } from '../../src/extension';
import { disposeWorker } from '../../src/ocrEngine';

describe('extension', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('activate', () => {
    it('should register commands', () => {
      const context = {
        subscriptions: { push: jest.fn() },
      } as unknown as vscode.ExtensionContext;

      activate(context);

      // Should push many disposables (commands + providers)
      expect(context.subscriptions.push).toHaveBeenCalled();
      const pushCalls = (context.subscriptions.push as jest.Mock).mock.calls;
      expect(pushCalls.length).toBeGreaterThan(0);
    });

    it('should register core commands', () => {
      const context = {
        subscriptions: { push: jest.fn() },
      } as unknown as vscode.ExtensionContext;

      activate(context);

      const registeredCommands = (vscode.commands.registerCommand as jest.Mock).mock.calls
        .map((call: unknown[]) => call[0]);

      expect(registeredCommands).toContain('codeplanner.extractText');
      expect(registeredCommands).toContain('codeplanner.extractTextFromClipboard');
      expect(registeredCommands).toContain('codeplanner.extractTextFromUri');
      expect(registeredCommands).toContain('codeplanner.captureScreenshot');
      expect(registeredCommands).toContain('codeplanner.newAgentRequest');
      expect(registeredCommands).toContain('codeplanner.insertWorkspaceContext');
      expect(registeredCommands).toContain('codeplanner.insertErrors');
    });

    it('should register copilot bridge commands', () => {
      const context = {
        subscriptions: { push: jest.fn() },
      } as unknown as vscode.ExtensionContext;

      activate(context);

      const registeredCommands = (vscode.commands.registerCommand as jest.Mock).mock.calls
        .map((call: unknown[]) => call[0]);

      expect(registeredCommands).toContain('codeplanner.sendToM365Copilot');
      expect(registeredCommands).toContain('codeplanner.copilotRecopyFile');
      expect(registeredCommands).toContain('codeplanner.copilotCopyAllFiles');
      expect(registeredCommands).toContain('codeplanner.clearCopilotFiles');
      expect(registeredCommands).toContain('codeplanner.openM365Copilot');
    });

    it('should register the document drop edit provider', () => {
      const context = {
        subscriptions: { push: jest.fn() },
      } as unknown as vscode.ExtensionContext;

      activate(context);

      expect(vscode.languages.registerDocumentDropEditProvider).toHaveBeenCalled();
    });

    it('should create the copilot files tree view', () => {
      const context = {
        subscriptions: { push: jest.fn() },
      } as unknown as vscode.ExtensionContext;

      activate(context);

      expect(vscode.window.createTreeView).toHaveBeenCalledWith(
        'codeplanner.copilotFiles',
        expect.objectContaining({
          canSelectMany: true,
          showCollapseAll: false,
        }),
      );
    });

    it('should register LM tools when API is available', () => {
      const context = {
        subscriptions: { push: jest.fn() },
      } as unknown as vscode.ExtensionContext;

      activate(context);

      expect(vscode.lm.registerTool).toHaveBeenCalledWith(
        'codeplanner_extract_text',
        expect.objectContaining({
          description: expect.stringContaining('Extract text from an image'),
          inputSchema: expect.any(Object),
          invoke: expect.any(Function),
        }),
      );
    });
  });

  describe('deactivate', () => {
    it('should call disposeWorker', () => {
      deactivate();

      expect(disposeWorker).toHaveBeenCalled();
    });
  });
});
