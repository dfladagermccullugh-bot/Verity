/** Plain spoken whole numbers ("twelve", "twenty five", "one hundred and twenty") to digits. No guessing. */

const UNITS: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** Returns the number, or null when the text is anything other than one plain whole number 0–999. */
export function parseSpokenNumber(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ");
  if (/^\d{1,3}$/.test(t)) return Number(t);
  const words = t.split(" ").filter((w) => w !== "and");
  if (words.length === 0 || words.length > 4) return null;
  let i = 0;
  let total = 0;
  if (words[1] === "hundred" && (words[0] === "a" || (UNITS[words[0]!] !== undefined && UNITS[words[0]!]! >= 1 && UNITS[words[0]!]! <= 9))) {
    total = (words[0] === "a" ? 1 : UNITS[words[0]!]!) * 100;
    i = 2;
    if (i === words.length) return total;
  }
  const rest = words.slice(i);
  if (rest.length === 1) {
    const w = rest[0]!;
    if (UNITS[w] !== undefined) return total + UNITS[w]!;
    if (TENS[w] !== undefined) return total + TENS[w]!;
    return null;
  }
  if (rest.length === 2 && TENS[rest[0]!] !== undefined && UNITS[rest[1]!] !== undefined && UNITS[rest[1]!]! >= 1 && UNITS[rest[1]!]! <= 9) {
    return total + TENS[rest[0]!]! + UNITS[rest[1]!]!;
  }
  return null;
}
