/**
 * Tiny parser for the Python literals in cwendt94/espn-api's constant.py (dicts, sets, lists,
 * tuples, ints, floats, strings, True/False/None, # comments). We parse the published file rather
 * than hand-copying tables, so IDs are never hand-guessed (CLAUDE.md §2.2 "ID tables").
 *
 * Dict keys keep their Python type: POSITION_MAP has both 0: "QB" and "QB": 0, which a plain JS
 * object would conflate.
 */

export type PyValue = number | string | boolean | null | PyDict | PySet | PyValue[];
export interface PyDict {
  kind: "dict";
  entries: Array<[PyValue, PyValue]>;
}
export interface PySet {
  kind: "set";
  values: PyValue[];
}

type Token = { t: "punct"; v: string } | { t: "num"; v: number } | { t: "str"; v: string } | { t: "name"; v: string };

export class PyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PyParseError";
  }
}

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i] as string;
    if (c === "#") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if ("{}[](),:".includes(c)) {
      out.push({ t: "punct", v: c });
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      let s = "";
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\" && i + 1 < src.length) {
          const n = src[i + 1] as string;
          s += n === "n" ? "\n" : n === "t" ? "\t" : n;
          i += 2;
        } else {
          s += src[i];
          i++;
        }
      }
      if (i >= src.length) throw new PyParseError("unterminated string");
      i++;
      out.push({ t: "str", v: s });
      continue;
    }
    const num = /^-?\d+(\.\d+)?/.exec(src.slice(i, i + 32));
    if (num) {
      out.push({ t: "num", v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i, i + 128));
    if (name) {
      out.push({ t: "name", v: name[0] });
      i += name[0].length;
      continue;
    }
    throw new PyParseError(`unexpected character ${JSON.stringify(c)} at offset ${i}`);
  }
  return out;
}

/** Parse one Python literal expression. */
export function parsePyLiteral(src: string): PyValue {
  const toks = tokenize(src);
  let pos = 0;
  const peek = () => toks[pos];
  const next = () => {
    const t = toks[pos++];
    if (!t) throw new PyParseError("unexpected end of input");
    return t;
  };
  const isPunct = (t: Token | undefined, v: string) => t?.t === "punct" && t.v === v;
  const expect = (v: string) => {
    const t = next();
    if (!isPunct(t, v)) throw new PyParseError(`expected ${v}`);
  };

  const value = (): PyValue => {
    const t = next();
    if (t.t === "num" || t.t === "str") {
      // Adjacent string literals concatenate in Python.
      if (t.t === "str") {
        let s = t.v;
        while (peek()?.t === "str") s += (next() as { v: string }).v;
        return s;
      }
      return t.v;
    }
    if (t.t === "name") {
      if (t.v === "True") return true;
      if (t.v === "False") return false;
      if (t.v === "None") return null;
      throw new PyParseError(`unsupported name ${t.v}`);
    }
    if (t.v === "[" || t.v === "(") {
      const close = t.v === "[" ? "]" : ")";
      const items: PyValue[] = [];
      while (!isPunct(peek(), close)) {
        items.push(value());
        if (isPunct(peek(), ",")) next();
        else break;
      }
      expect(close);
      return items;
    }
    if (t.v === "{") {
      if (isPunct(peek(), "}")) {
        next();
        return { kind: "dict", entries: [] };
      }
      const first = value();
      if (isPunct(peek(), ":")) {
        next();
        const entries: Array<[PyValue, PyValue]> = [[first, value()]];
        while (isPunct(peek(), ",")) {
          next();
          if (isPunct(peek(), "}")) break;
          const k = value();
          expect(":");
          entries.push([k, value()]);
        }
        expect("}");
        return { kind: "dict", entries };
      }
      const values: PyValue[] = [first];
      while (isPunct(peek(), ",")) {
        next();
        if (isPunct(peek(), "}")) break;
        values.push(value());
      }
      expect("}");
      return { kind: "set", values };
    }
    throw new PyParseError(`unexpected token ${t.v}`);
  };

  const v = value();
  if (pos !== toks.length) throw new PyParseError("trailing tokens after literal");
  return v;
}

/**
 * Find top-level `NAME = <literal>` assignments (NAME in UPPER_CASE, at column 0) and parse each.
 * Assignments whose value isn't a plain literal are reported in `errors`, not thrown.
 */
export function parsePyAssignments(src: string): { values: Record<string, PyValue>; errors: Record<string, string> } {
  const values: Record<string, PyValue> = {};
  const errors: Record<string, string> = {};
  const re = /^([A-Z][A-Z0-9_]*)\s*=\s*/gm;
  const starts: Array<{ name: string; start: number; valueStart: number }> = [];
  for (let m = re.exec(src); m; m = re.exec(src)) starts.push({ name: m[1] as string, start: m.index, valueStart: m.index + m[0].length });
  starts.forEach((s, i) => {
    const end = i + 1 < starts.length ? (starts[i + 1] as { start: number }).start : src.length;
    try {
      values[s.name] = parsePyLiteral(src.slice(s.valueStart, end));
    } catch (err) {
      errors[s.name] = err instanceof Error ? err.message : String(err);
    }
  });
  return { values, errors };
}

export function isDict(v: PyValue | undefined): v is PyDict {
  return !!v && typeof v === "object" && !Array.isArray(v) && v.kind === "dict";
}

export function isSet(v: PyValue | undefined): v is PySet {
  return !!v && typeof v === "object" && !Array.isArray(v) && v.kind === "set";
}
