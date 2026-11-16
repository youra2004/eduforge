import { describe, expect, it } from 'vitest';
import { chunkText, estimateTokens } from './chunking';

const paragraph = (n: number) => `Рядок ${n}: ` + 'слово '.repeat(30).trim();
const doc = Array.from({ length: 60 }, (_, i) => paragraph(i)).join('\n');

describe('chunkText', () => {
  it('returns nothing for blank text', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('  \n \n')).toEqual([]);
  });

  it('keeps short text in one chunk', () => {
    expect(chunkText('Привіт, світе.')).toEqual([{ text: 'Привіт, світе.', tokenCount: 5 }]);
  });

  it('splits long text into chunks that respect the size limit', () => {
    const chunks = chunkText(doc, { maxTokens: 300, overlapTokens: 50 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) {
      expect(c.tokenCount).toBeLessThanOrEqual(300);
      expect(c.tokenCount).toBe(estimateTokens(c.text));
    }
  });

  it('repeats the tail of a chunk at the start of the next one', () => {
    const chunks = chunkText(doc, { maxTokens: 300, overlapTokens: 50 });
    for (let i = 1; i < chunks.length; i++) {
      const lastLineBefore = chunks[i - 1]!.text.split('\n').at(-1)!;
      const firstLine = chunks[i]!.text.split('\n')[0]!;
      expect(lastLineBefore.endsWith(firstLine)).toBe(true);
      expect(estimateTokens(firstLine)).toBeLessThanOrEqual(50);
    }
  });

  it('does not lose any line', () => {
    const chunks = chunkText(doc, { maxTokens: 300, overlapTokens: 50 });
    const all = chunks.map((c) => c.text).join('\n');
    for (let i = 0; i < 60; i++) expect(all).toContain(paragraph(i));
  });

  it('splits a single huge line and keeps code line breaks', () => {
    const chunks = chunkText('x '.repeat(2000), { maxTokens: 100, overlapTokens: 10 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.tokenCount).toBeLessThanOrEqual(100);
    const code = '```python\nprint("hi")\n```';
    expect(chunkText(code)[0]!.text).toBe(code);
  });

  it('is deterministic', () => {
    expect(chunkText(doc)).toEqual(chunkText(doc));
  });

  it('rejects an overlap that is not smaller than the chunk', () => {
    expect(() => chunkText('a', { maxTokens: 10, overlapTokens: 10 })).toThrow();
  });
});
