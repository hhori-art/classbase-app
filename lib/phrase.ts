import { loadDefaultJapaneseParser } from 'budoux';

/**
 * 日本語の文を、改行してよい文節の切れ目で区切る（BudouX）。
 * スマホの狭い幅で「ログイ／ン」「確認でき／ます」のように単語の途中で改行されるのを防ぐために使う。
 * 結果は短い文で何度も使われるので、小さなキャッシュを持つ。
 */
let parser: ReturnType<typeof loadDefaultJapaneseParser> | null = null;
const cache = new Map<string, string[]>();
const JAPANESE = /[぀-ヿ㐀-鿿ｦ-ﾟ]/;

export function phraseChunks(text: string): string[] {
  if (!text || !JAPANESE.test(text)) return [text];
  const cached = cache.get(text);
  if (cached) return cached;
  parser ||= loadDefaultJapaneseParser();
  const chunks = parser.parse(text);
  if (cache.size > 500) cache.clear();
  cache.set(text, chunks);
  return chunks;
}
