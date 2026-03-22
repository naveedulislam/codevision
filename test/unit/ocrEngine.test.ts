/**
 * Unit tests for ocrEngine.ts
 *
 * Tests the OCR engine wrapper around Tesseract.js, including
 * the recognizeImage function and TSV dimension extraction.
 */

jest.mock('vscode');

// Mock tesseract.js
const mockRecognize = jest.fn();
const mockTerminate = jest.fn();
const mockCreateWorker = jest.fn();

jest.mock('tesseract.js', () => ({
  createWorker: mockCreateWorker,
}));

// Mock image-size
const mockImageSize = jest.fn();
jest.mock('image-size', () => ({
  imageSize: mockImageSize,
}));

import { recognizeImage, disposeWorker } from '../../src/ocrEngine';

describe('ocrEngine', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock worker
    const mockWorker = {
      recognize: mockRecognize,
      terminate: mockTerminate.mockResolvedValue(undefined),
    };
    mockCreateWorker.mockResolvedValue(mockWorker);
  });

  afterEach(async () => {
    // Clean up the cached worker between tests
    await disposeWorker();
  });

  describe('recognizeImage', () => {
    it('should return OCR result with text, confidence, and dimensions', async () => {
      mockImageSize.mockReturnValue({ width: 800, height: 600 });
      mockRecognize.mockResolvedValue({
        data: {
          text: 'Hello World',
          tsv: '',
          confidence: 95.5,
        },
      });

      const result = await recognizeImage('/path/to/image.png');

      expect(result.text).toBe('Hello World');
      expect(result.confidence).toBe(95.5);
      expect(result.imageWidth).toBe(800);
      expect(result.imageHeight).toBe(600);
    });

    it('should trim the returned text', async () => {
      mockImageSize.mockReturnValue({ width: 100, height: 100 });
      mockRecognize.mockResolvedValue({
        data: {
          text: '  whitespace text  \n\n',
          tsv: '',
          confidence: 80,
        },
      });

      const result = await recognizeImage('/path/to/image.png');

      expect(result.text).toBe('whitespace text');
    });

    it('should use default language "eng" when none specified', async () => {
      mockImageSize.mockReturnValue({ width: 100, height: 100 });
      mockRecognize.mockResolvedValue({
        data: { text: 'test', tsv: '', confidence: 90 },
      });

      await recognizeImage('/path/to/image.png');

      expect(mockCreateWorker).toHaveBeenCalledWith(
        'eng',
        1,
        expect.any(Object),
      );
    });

    it('should use specified language', async () => {
      mockImageSize.mockReturnValue({ width: 100, height: 100 });
      mockRecognize.mockResolvedValue({
        data: { text: 'مرحبا', tsv: '', confidence: 85 },
      });

      await recognizeImage('/path/to/image.png', { language: 'ara' });

      expect(mockCreateWorker).toHaveBeenCalledWith(
        'ara',
        1,
        expect.any(Object),
      );
    });

    it('should reuse cached worker for same language', async () => {
      mockImageSize.mockReturnValue({ width: 100, height: 100 });
      mockRecognize.mockResolvedValue({
        data: { text: 'test', tsv: '', confidence: 90 },
      });

      await recognizeImage('/path/to/a.png', { language: 'eng' });
      await recognizeImage('/path/to/b.png', { language: 'eng' });

      // Worker should only be created once
      expect(mockCreateWorker).toHaveBeenCalledTimes(1);
    });

    it('should recreate worker when language changes', async () => {
      mockImageSize.mockReturnValue({ width: 100, height: 100 });
      mockRecognize.mockResolvedValue({
        data: { text: 'test', tsv: '', confidence: 90 },
      });

      await recognizeImage('/path/to/a.png', { language: 'eng' });
      await recognizeImage('/path/to/b.png', { language: 'fra' });

      expect(mockCreateWorker).toHaveBeenCalledTimes(2);
      expect(mockTerminate).toHaveBeenCalledTimes(1); // old worker terminated
    });

    it('should fall back to TSV dimensions when imageSize fails', async () => {
      mockImageSize.mockImplementation(() => {
        throw new Error('unsupported format');
      });

      const tsvData = [
        'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
        '5\t1\t1\t1\t1\t1\t10\t20\t100\t30\t95\tHello',
        '5\t1\t1\t1\t1\t2\t120\t20\t80\t30\t92\tWorld',
      ].join('\n');

      mockRecognize.mockResolvedValue({
        data: { text: 'Hello World', tsv: tsvData, confidence: 93 },
      });

      const result = await recognizeImage('/path/to/image.png');

      expect(result.text).toBe('Hello World');
      // maxRight = max(10+100, 120+80) = 200
      expect(result.imageWidth).toBe(200);
      // maxBottom = max(20+30) = 50
      expect(result.imageHeight).toBe(50);
    });

    it('should use default 800x600 when both imageSize and TSV fail', async () => {
      mockImageSize.mockImplementation(() => {
        throw new Error('unsupported format');
      });

      mockRecognize.mockResolvedValue({
        data: { text: '', tsv: '', confidence: 0 },
      });

      const result = await recognizeImage('/path/to/image.png');

      expect(result.imageWidth).toBe(800);
      expect(result.imageHeight).toBe(600);
    });

    it('should handle null/undefined text gracefully', async () => {
      mockImageSize.mockReturnValue({ width: 100, height: 100 });
      mockRecognize.mockResolvedValue({
        data: { text: null, tsv: null, confidence: 0 },
      });

      const result = await recognizeImage('/path/to/image.png');

      expect(result.text).toBe('');
      expect(result.tsv).toBe('');
    });

    it('should pass tessDataPath to worker when provided', async () => {
      mockImageSize.mockReturnValue({ width: 100, height: 100 });
      mockRecognize.mockResolvedValue({
        data: { text: 'test', tsv: '', confidence: 90 },
      });

      // Mock fs.existsSync to return true for the tessdata path
      const fsSpy = jest.spyOn(require('fs'), 'existsSync').mockReturnValue(true);

      await recognizeImage('/path/to/image.png', {
        tessDataPath: '/opt/tessdata',
      });

      expect(mockCreateWorker).toHaveBeenCalledWith(
        'eng',
        1,
        expect.objectContaining({ langPath: '/opt/tessdata' }),
      );

      fsSpy.mockRestore();
    });
  });

  describe('disposeWorker', () => {
    it('should terminate the cached worker', async () => {
      mockImageSize.mockReturnValue({ width: 100, height: 100 });
      mockRecognize.mockResolvedValue({
        data: { text: 'test', tsv: '', confidence: 90 },
      });

      // Create a worker
      await recognizeImage('/path/to/image.png');

      // Now dispose it
      await disposeWorker();

      expect(mockTerminate).toHaveBeenCalled();
    });

    it('should be safe to call when no worker exists', async () => {
      // Should not throw
      await expect(disposeWorker()).resolves.toBeUndefined();
    });
  });
});
