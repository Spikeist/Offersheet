/**
 * JSON parsing for Sleeper bodies that keeps 16+ digit integers as strings (Sleeper sends some
 * 19-digit IDs as bare JSON numbers, e.g. /draft/{id}/traded_picks draft_id, which plain JSON.parse
 * rounds to the nearest double).
 *
 * Why not http.ts `bigIntsAsStrings`: its quoteBigInts() scans digit runs, so the fractional digits
 * of a long float (a scoring rate such as 1/33 = 0.030303030303030304) are quoted as if they were an
 * integer, which makes the whole body invalid JSON. This version consumes each number token whole
 * (sign, integer part, fraction, exponent) and quotes only integers.
 */

const isDigit = (c: number) => c >= 48 && c <= 57;

export function quoteBigIntegers(text: string, minDigits = 16): string {
  let out = "";
  let last = 0;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c === 34) {
      // A string: skip to its closing quote (backslash escapes skip the next character).
      i++;
      while (i < n) {
        const d = text.charCodeAt(i);
        if (d === 92) {
          i += 2;
          continue;
        }
        i++;
        if (d === 34) break;
      }
      continue;
    }
    if (c === 45 || isDigit(c)) {
      const start = i;
      if (c === 45) i++;
      const intStart = i;
      while (i < n && isDigit(text.charCodeAt(i))) i++;
      const intDigits = i - intStart;
      let integer = true;
      if (text[i] === ".") {
        integer = false;
        i++;
        while (i < n && isDigit(text.charCodeAt(i))) i++;
      }
      if (text[i] === "e" || text[i] === "E") {
        integer = false;
        i++;
        if (text[i] === "+" || text[i] === "-") i++;
        while (i < n && isDigit(text.charCodeAt(i))) i++;
      }
      if (integer && intDigits >= minDigits) {
        out += `${text.slice(last, start)}"${text.slice(start, i)}"`;
        last = i;
      }
      if (i === start) i++; // a lone "-" (not valid JSON anyway): move on
      continue;
    }
    i++;
  }
  return last === 0 ? text : out + text.slice(last);
}

/** Parse a JSON object/array body keeping 16+ digit integers as strings; undefined when it isn't JSON. */
export function parseJsonKeepingBigInts(text: string): unknown {
  const t = text.trimStart();
  if (!(t.startsWith("{") || t.startsWith("["))) return undefined;
  try {
    return JSON.parse(quoteBigIntegers(text));
  } catch {
    return undefined;
  }
}
