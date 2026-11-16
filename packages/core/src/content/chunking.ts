/** Rough size estimate for mixed Ukrainian text, English and code; good enough to size chunks (F2-R4). */
const CHARS_PER_TOKEN = 3;

export const estimateTokens = (text: string) => Math.ceil(text.length / CHARS_PER_TOKEN);

export interface ChunkOptions {
  /** A chunk is closed once adding the next line would push it past this. */
  maxTokens?: number;
  /** About this many tokens from the end of a chunk are repeated at the start of the next. */
  overlapTokens?: number;
}

export interface Chunk {
  text: string;
  tokenCount: number;
}

/** Splits a line that is longer than `maxChars` on spaces (or hard, if it has none). */
function splitLongLine(line: string, maxChars: number): string[] {
  const parts: string[] = [];
  let rest = line;
  while (rest.length > maxChars) {
    const cut = rest.lastIndexOf(' ', maxChars);
    const at = cut > maxChars / 2 ? cut + 1 : maxChars;
    parts.push(rest.slice(0, at));
    rest = rest.slice(at);
  }
  parts.push(rest);
  return parts;
}

/**
 * Splits text into chunks of roughly 300-500 tokens with overlap. Works line by line so markdown
 * structure and code blocks keep their line breaks. Deterministic: the same text gives the same chunks.
 */
export function chunkText(text: string, opts: ChunkOptions = {}): Chunk[] {
  const maxTokens = opts.maxTokens ?? 400;
  const overlapTokens = opts.overlapTokens ?? 60;
  if (overlapTokens >= maxTokens) throw new Error('overlapTokens must be smaller than maxTokens');
  const maxChars = maxTokens * CHARS_PER_TOKEN;

  const lines = text
    .trim()
    .split('\n')
    .flatMap((line) => splitLongLine(line, maxChars));
  if (lines.length === 1 && lines[0] === '') return [];

  const chunks: Chunk[] = [];
  let current: string[] = [];
  let currentChars = 0;
  // Lines added since the last chunk was closed; if there are none, closing again would only repeat the overlap.
  let fresh = 0;

  const close = () => {
    const body = current.join('\n');
    chunks.push({ text: body, tokenCount: estimateTokens(body) });
    // Carry the tail over, but never so much that the next line cannot fit.
    const carried: string[] = [];
    let carriedChars = 0;
    for (let i = current.length - 1; i > 0; i--) {
      const len = current[i]!.length + 1;
      if ((carriedChars + len) / CHARS_PER_TOKEN > overlapTokens) break;
      carried.unshift(current[i]!);
      carriedChars += len;
    }
    // One long paragraph is a single line: repeat just its last words rather than nothing.
    const last = current[current.length - 1]!;
    if (carried.length === 0 && current.length > 0 && overlapTokens > 0) {
      const tail = last.slice(-overlapTokens * CHARS_PER_TOKEN);
      const space = tail.indexOf(' ');
      const words = space === -1 || tail.length === last.length ? tail : tail.slice(space + 1);
      carried.push(words);
      carriedChars = words.length + 1;
    }
    current = carried;
    currentChars = carriedChars;
    fresh = 0;
  };

  for (const line of lines) {
    if (fresh > 0 && currentChars + line.length + 1 > maxChars) close();
    // The overlap plus a long line may not fit together; the line wins and the overlap is dropped.
    if (currentChars + line.length + 1 > maxChars) {
      current = [];
      currentChars = 0;
    }
    current.push(line);
    currentChars += line.length + 1;
    fresh++;
  }
  if (fresh > 0) {
    const body = current.join('\n');
    chunks.push({ text: body, tokenCount: estimateTokens(body) });
  }
  return chunks.filter((c) => c.text.trim() !== '');
}
