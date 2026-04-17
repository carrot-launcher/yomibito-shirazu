/**
 * Format tanka body text for display.
 *
 * Timeline/collection: always single line (line breaks → full-width space).
 * Detail/screenshot: apply conversion based on post flags.
 * Old posts without flags: body is already converted, shown as-is.
 */
export function formatTankaBody(
  body: string,
  context: 'timeline' | 'detail',
  flags?: { convertHalfSpace?: boolean; convertLineBreak?: boolean }
): string {
  let result = body;

  if (context === 'timeline') {
    result = result.replace(/[\n\r]+/g, '\u3000');
    if (flags?.convertHalfSpace) result = result.replace(/ /g, '\u3000');
  } else {
    // Detail/screenshot: apply based on post flags
    if (flags?.convertLineBreak) result = result.replace(/[\n\r]+/g, '\u3000');
    if (flags?.convertHalfSpace) result = result.replace(/ /g, '\u3000');
  }

  return result;
}

/** Compress consecutive newlines to max 2 (= 1 blank line between paragraphs). */
export function compressNewlines(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n');
}

/** Convert {漢字|ふりがな} syntax to <ruby> HTML tags. Input must already be HTML-escaped. */
export function rubyToHtml(escaped: string): string {
  return escaped.replace(/\{([^|{}]+)\|([^|{}]+)\}/g,
    '<ruby>$1<rp>(</rp><rt>$2</rt><rp>)</rp></ruby>');
}

/** Strip {漢字|ふりがな} syntax, keeping only the base text. */
export function stripRuby(text: string): string {
  return text.replace(/\{([^|{}]+)\|[^|{}]+\}/g, '$1');
}
