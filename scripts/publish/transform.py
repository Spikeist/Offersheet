"""
The publication transform: what the public copy of a file version looks like (CLAUDE.md section 0.4; used by
rewrite.py on every version in the history, and by verify.py and the tests).

The public GitHub repository holds a filtered copy of this repository's history: FantasyCalc's value lists and the
values tied to named players can't be published (their terms, and Parker's word to them that our copies stay private).
This module is pure (text in, text out, no I/O but load_rules / load_dictionary), deterministic, and idempotent: a
masked text comes out of it unchanged, so a rule can never bite twice.

Rules (scripts/publish/rules.json, private: the public copy drops it), applied in this order to a UTF-8 text file:
  columnRules      markdown tables whose header row has a cell matching "header" (and another matching "require", when
                   given): every integer in that column's body cells becomes the mask
  replacements     re.sub(find, replace, text, flags=re.MULTILINE) on the paths "path" matches, in order
  dictionaryMasks  on the paths "path" matches: a number that equals one of a named player's FantasyCalc values (the
                   frozen dictionary, scripts/publish/fc-dictionary.json, private too) and stands on the same line
                   within "window" characters of his name becomes the mask, unless the allowlist says that pair isn't a
                   value there (a count, a timing, an id that merely coincides)
plus index pruning: in fixtures/sanitized/shared/index.json the entries of the dropped FantasyCalc fixtures go, the file
otherwise byte for byte (prune_index).
"""
import json
import re

MASK = "[value]"

_PIPE_SPLIT = re.compile(r"(?<!\\)\|")
_CELL_NUM = re.compile(r"(?<![\w.\[])(\d{1,3}(?:,\d{3})+|\d+)(?![\w\]]|\.\d)")
NUM_RE = re.compile(r"(?<![\w.,])(\d{1,3}(?:,\d{3})+|\d+)(?![\w]|\.\d|,\d)")


def load_rules(path):
    with open(path, encoding="utf-8") as f:
        rules = json.load(f)
    for key in ("dropPaths", "dropPathPatterns", "blobRules", "columnRules", "replacements", "dictionaryMasks",
                "allowlist", "bannedStrings", "bannedPatterns"):
        rules.setdefault(key, [])
    return rules


def load_dictionary(path):
    """{name: set(values)} from a JSON object of name -> [values]."""
    with open(path, encoding="utf-8") as f:
        return {n: set(int(v) for v in vals) for n, vals in json.load(f).items()}


def _is_sep(line):
    return bool(re.match(r"^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$", line))


def mask_columns(text, header_re, require_re=None, mask=MASK):
    """Markdown tables whose header row has a cell matching header_re (and, when given, a cell matching require_re):
    every integer in that column's body cells becomes `mask`. Everything else stays byte for byte."""
    hr = re.compile(header_re)
    rr = re.compile(require_re) if require_re else None
    lines = text.split("\n")
    i = 0
    while i < len(lines) - 1:
        if lines[i].lstrip().startswith("|") and _is_sep(lines[i + 1]):
            cells = _PIPE_SPLIT.split(lines[i])
            idx = [k for k, c in enumerate(cells) if hr.search(c.strip())]
            ok = bool(idx) and (rr is None or any(rr.search(c.strip()) for c in cells))
            j = i + 2
            while j < len(lines) and lines[j].lstrip().startswith("|"):
                if ok:
                    row = _PIPE_SPLIT.split(lines[j])
                    for k in idx:
                        if k < len(row):
                            row[k] = _CELL_NUM.sub(mask, row[k])
                    lines[j] = "|".join(row)
                j += 1
            i = j
        else:
            i += 1
    return "\n".join(lines)


class Dictionary:
    """Names with their FantasyCalc values, and the regex that finds the names (longest first)."""

    def __init__(self, names):
        self.names = {n: set(v) for n, v in names.items() if n and v}
        alts = sorted(self.names, key=len, reverse=True)
        self.regex = re.compile("|".join(re.escape(n) for n in alts)) if alts else None


def allowed(allowlist, path, name, value):
    for a in allowlist:
        if re.search(a["path"], path) and a.get("name") in (None, name) and int(a["number"]) == value:
            return True
    return False


def find_values(text, dictionary, path="", allowlist=(), window=160, min_value=100, line_bounded=False):
    """Spans (start, end, name, value) of numbers >= min_value within `window` characters of a dictionary name (on the
    same line when line_bounded) that equal one of that name's values and that the allowlist doesn't excuse."""
    if dictionary.regex is None:
        return []
    out, seen = [], set()
    for m in dictionary.regex.finditer(text):
        name = m.group(0)
        values = dictionary.names[name]
        lo, hi = max(0, m.start() - window), min(len(text), m.end() + window)
        if line_bounded:
            ls = text.rfind("\n", 0, m.start()) + 1
            le = text.find("\n", m.end())
            lo, hi = max(lo, ls), min(hi, len(text) if le < 0 else le)
        for k in NUM_RE.finditer(text, lo, hi):
            v = int(k.group(1).replace(",", ""))
            if v >= min_value and v in values and k.start() not in seen and not allowed(allowlist, path, name, v):
                seen.add(k.start())
                out.append((k.start(1), k.end(1), name, v))
    return sorted(out)


def dictionary_mask(text, dictionary, path="", allowlist=(), window=160, min_value=100, mask=MASK):
    spans = find_values(text, dictionary, path, allowlist, window, min_value, line_bounded=True)
    if not spans:
        return text
    parts, pos = [], 0
    for s, e, _, _ in spans:
        if s < pos:
            continue
        parts.append(text[pos:s])
        parts.append(mask)
        pos = e
    parts.append(text[pos:])
    return "".join(parts)


def apply_rules(rules, path, text, dictionary=None):
    for r in rules.get("columnRules", []):
        if re.search(r["path"], path):
            text = mask_columns(text, r["header"], r.get("require"), r.get("mask", MASK))
    for r in rules.get("replacements", []):
        if re.search(r["path"], path):
            text = re.sub(r["find"], r["replace"], text, flags=re.MULTILINE)
    if dictionary is not None:
        for r in rules.get("dictionaryMasks", []):
            if re.search(r["path"], path):
                text = dictionary_mask(text, dictionary, path, rules.get("allowlist", []), r.get("window", 160),
                                       r.get("minValue", 100), r.get("mask", MASK))
    return text


def _json_indent(text):
    m = re.search(r"\n( +)\"", text)
    return len(m.group(1)) if m else 2


def prune_index(text, label_prefix):
    """The index without the entries whose label starts with label_prefix, in the file's own JSON formatting (key order,
    indentation, no ASCII escaping, the original trailing newline). Returns (new_text, removed_file_names)."""
    data = json.loads(text)
    removed = [k for k, v in data.items() if isinstance(v, dict) and str(v.get("label", "")).startswith(label_prefix)]
    if not removed:
        return text, []
    for k in removed:
        del data[k]
    out = json.dumps(data, indent=_json_indent(text), ensure_ascii=False)
    if text.endswith("\n"):
        out += "\n"
    return out, removed


def roundtrips(text):
    """Whether prune_index's formatting reproduces this index byte for byte (checked before trusting it)."""
    out = json.dumps(json.loads(text), indent=_json_indent(text), ensure_ascii=False)
    return out + ("\n" if text.endswith("\n") else "") == text
