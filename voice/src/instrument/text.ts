/** Turn survey-editor HTML into the plain text that will be spoken. */

const ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  rsquo: "\u2019",
  lsquo: "\u2018",
  rdquo: "\u201d",
  ldquo: "\u201c",
  ndash: "\u2013",
  mdash: "\u2014",
  hellip: "\u2026",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** True when the markup carries content speech cannot convey. */
export function hasUnspeakableMarkup(html: string): boolean {
  return /<\s*(img|video|audio|iframe|table|script|object|embed|svg)\b/i.test(html);
}

export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\s*(script|style)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
    .replace(/<\s*br\s*\/?\s*>/gi, " ")
    .replace(/<\s*\/?\s*(div|p|li|ul|ol|h[1-6]|tr)\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(withBreaks)
    .replace(/[\u00a0\s]+/g, " ")
    .trim();
}

/** Piped-text placeholders, e.g. `${q://QID1/ChoiceGroup/SelectedChoices}` or `${e://Field/name}`. */
export function findPipes(text: string): string[] {
  return text.match(/\$\{[^}]*\}/g) ?? [];
}
