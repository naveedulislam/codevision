/**
 * Unit tests for types.ts
 *
 * Validates the TypeScript interfaces compile correctly and can be used as expected.
 */

import type { OcrResult, OcrOptions } from '../../src/types';

describe('types', () => {
  describe('OcrResult', () => {
    it('should be assignable with all required fields', () => {
      const result: OcrResult = {
        text: 'Hello World',
        tsv: 'level\tpage_num...',
        confidence: 95.5,
        imageWidth: 800,
        imageHeight: 600,
      };

      expect(result.text).toBe('Hello World');
      expect(result.confidence).toBe(95.5);
      expect(result.imageWidth).toBe(800);
      expect(result.imageHeight).toBe(600);
      expect(result.tsv).toBeDefined();
    });
  });

  describe('OcrOptions', () => {
    it('should allow all optional fields', () => {
      const opts: OcrOptions = {
        language: 'eng+ara',
        tessDataPath: '/opt/tessdata',
        verbose: true,
      };

      expect(opts.language).toBe('eng+ara');
      expect(opts.tessDataPath).toBe('/opt/tessdata');
      expect(opts.verbose).toBe(true);
    });

    it('should allow empty object', () => {
      const opts: OcrOptions = {};

      expect(opts.language).toBeUndefined();
      expect(opts.tessDataPath).toBeUndefined();
      expect(opts.verbose).toBeUndefined();
    });
  });
});
