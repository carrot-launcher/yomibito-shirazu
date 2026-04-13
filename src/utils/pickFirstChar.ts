// 文字列の中から、衡山毛筆フォント草書で実際に描画できる最初の文字を返す。
// このフォントは cmap には多数の文字が登録されているが、Greek・Latin拡張の多く・
// 記号類は空グリフ（描画されない）のため、実際に描ける範囲だけを許可する。
//
// 許可範囲:
//   - ASCII 印字可能文字 (0x21-0x7E)  … 英字・数字・主要記号
//   - ひらがな (0x3040-0x309F)
//   - カタカナ (0x30A0-0x30FF)
//   - CJK統合漢字 (0x4E00-0x9FFF)
//   - CJK拡張A (0x3400-0x4DBF)
//   - 全角形 (0xFF00-0xFFEF)
function isRenderable(code: number): boolean {
  if (code >= 0x21 && code <= 0x7e) return true;
  if (code >= 0x3040 && code <= 0x309f) return true;
  if (code >= 0x30a0 && code <= 0x30ff) return true;
  if (code >= 0x3400 && code <= 0x4dbf) return true;
  if (code >= 0x4e00 && code <= 0x9fff) return true;
  if (code >= 0xff00 && code <= 0xffef) return true;
  return false;
}

export function pickFirstChar(s: string): string {
  if (!s) return '';
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (code === undefined) continue;
    if (isRenderable(code)) return ch;
  }
  return '';
}
