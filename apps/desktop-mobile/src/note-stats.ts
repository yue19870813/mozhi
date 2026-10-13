/** Count CJK characters individually and other words as units. */
export function noteStats(content: string) {
  const cjk = content.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
  const words = content
    .replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, " ")
    .match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  return {
    count: cjk + words,
    minutes: cjk + words ? Math.max(1, Math.ceil(cjk / 400 + words / 220)) : 0,
  };
}
