/**
 * Unit tests for outputPanel.ts
 *
 * Tests editor output helpers: showTextInEditor, saveResult,
 * withProgress, and HTML sanitization.
 */

jest.mock('vscode');

import * as vscode from 'vscode';
import {
  showTextInEditor,
  showHtmlInWebview,
  withProgress,
  saveResult,
} from '../../src/outputPanel';

describe('outputPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('showTextInEditor', () => {
    it('should open a new text document and show it', async () => {
      const mockDoc = { uri: vscode.Uri.file('/untitled.txt') };
      (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDoc);

      await showTextInEditor('Hello World', 'plaintext');

      expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith({
        content: 'Hello World',
        language: 'plaintext',
      });
      expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
        mockDoc,
        { preview: false },
      );
    });

    it('should use default language "plaintext"', async () => {
      const mockDoc = { uri: vscode.Uri.file('/untitled.txt') };
      (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDoc);

      await showTextInEditor('content');

      expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith({
        content: 'content',
        language: 'plaintext',
      });
    });

    it('should accept custom language', async () => {
      const mockDoc = { uri: vscode.Uri.file('/untitled.md') };
      (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDoc);

      await showTextInEditor('# Heading', 'markdown');

      expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith({
        content: '# Heading',
        language: 'markdown',
      });
    });
  });

  describe('showHtmlInWebview', () => {
    it('should create a new webview panel on first call', () => {
      const mockPanel = {
        webview: { html: '' },
        reveal: jest.fn(),
        onDidDispose: jest.fn(),
        dispose: jest.fn(),
        title: '',
      };
      (vscode.window.createWebviewPanel as jest.Mock).mockReturnValue(mockPanel);

      const context = {
        subscriptions: [] as vscode.Disposable[],
      } as unknown as vscode.ExtensionContext;

      showHtmlInWebview(context, 'Test', '<html><body>hello</body></html>');

      expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
        'codeplannerResult',
        'Test',
        expect.any(Object),
        expect.objectContaining({ enableScripts: false }),
      );
      // HTML should include CSP header
      expect(mockPanel.webview.html).toContain('Content-Security-Policy');
    });
  });

  describe('withProgress', () => {
    it('should call the task function with a progress reporter', async () => {
      const task = jest.fn().mockResolvedValue('done');

      const result = await withProgress('Working...', task);

      expect(result).toBe('done');
      expect(task).toHaveBeenCalledTimes(1);
    });

    it('should pass through the task return value', async () => {
      const task = jest.fn().mockResolvedValue({ text: 'hello' });

      const result = await withProgress('Processing', task);

      expect(result).toEqual({ text: 'hello' });
    });
  });

  describe('saveResult', () => {
    it('should save file with correct path and suffix', async () => {
      await saveResult('/images/photo.png', '_ocr', '.txt', 'extracted text');

      expect(vscode.workspace.fs.writeFile).toHaveBeenCalledTimes(1);

      const call = (vscode.workspace.fs.writeFile as jest.Mock).mock.calls[0];
      const uri = call[0] as vscode.Uri;
      expect(uri.fsPath).toBe('/images/photo_ocr.txt');
    });

    it('should return the output file path', async () => {
      const result = await saveResult('/dir/scan.jpg', '_ocr', '.txt', 'text');

      expect(result).toBe('/dir/scan_ocr.txt');
    });

    it('should handle different suffixes and extensions', async () => {
      const result = await saveResult('/dir/image.bmp', '_wireframe', '.html', '<html></html>');

      expect(result).toBe('/dir/image_wireframe.html');
    });
  });
});
