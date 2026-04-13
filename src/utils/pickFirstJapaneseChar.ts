// 文字列の中から最初の日本語文字（漢字・ひらがな・カタカナ）を返す。
// 衡山草書など日本語のみ収録のフォントで表示する頭文字を選ぶ用途。
// 見つからなければ空文字を返す。
export function pickFirstJapaneseChar(s: string): string {
  if (!s) return '';
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (code === undefined) continue;
    // CJK Unified Ideographs
    if (code >= 0x4e00 && code <= 0x9fff) return ch;
    // CJK Unified Ideographs Extension A
    if (code >= 0x3400 && code <= 0x4dbf) return ch;
    // ひらがな
    if (code >= 0x3040 && code <= 0x309f) return ch;
    // カタカナ
    if (code >= 0x30a0 && code <= 0x30ff) return ch;
  }
  return '';
}
