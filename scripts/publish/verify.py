#!/usr/bin/env python3
"""
Verifies a rewritten (public) copy before it's pushed (CLAUDE.md section 0.4). Checks every (path, blob) reachable from
any ref of the filtered repository, independently of the rules that made it:

  1. no dropped path is there: rules.dropPaths, dropPathPatterns and the FantasyCalc fixture files (recomputed from the
     MAIN repository's history, so a rewrite that missed one can't hide it);
  2. no FantasyCalc-shaped data in a .json file: an array of 3+ objects that each have a "player" object and a numeric
     "value", or any numeric "redraftValue";
  3. no FantasyCalc value of a named player near his name: the frozen dictionary plus (unless --no-live-dictionary)
     every FantasyCalc list this computer holds (the main folder's fixtures, .cache/ and data-local/), full names
     within 160 characters and distinctive surnames on the same line within 80; rules.allowlist excuses a pair;
  4. no rules.bannedStrings or bannedPatterns;
  5. every .json version the rewrite made still parses (one that didn't parse before is the original's own);
  6. with --leak-check: scripts/check-leaks.ts over every published version, run from the main folder (its .env.local,
     redaction maps and watch lists are the needles), version k of each path in batch k so paths stay as they are.
     Blobs already checked are remembered in <main>/.cache/publish/leak-verified.json under a fingerprint of the
     needles' sources (a SHA-256 over their bytes; nothing of them is printed), so a later run checks only new blobs.

    python scripts/publish/verify.py --repo <filtered bare repo> --rules <rules.json> --dictionary <fc-dictionary.json>
                                     --main <main folder> [--leak-check] [--no-live-dictionary] [--report <out.json>]

Exit 0 when every check passes, 1 with a list otherwise. Prints paths, commits, names and the numbers it found (this is
a local console); never a secret: the leak check prints only its own categories and counts.
"""
import argparse
import collections
import glob
import gzip
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import transform as T  # noqa: E402
from rewrite import fantasycalc_fixture_files, git  # noqa: E402

BINARY_EXT = re.compile(r"\.(png|ico|jpg|jpeg|gif|webp|gz|woff2?|ttf|zip|pdf)$", re.I)


# ---------------------------------------------------------------- what the filtered repository publishes
def published_blobs(repo):
    """{(path, blob)} over every commit of every ref, and the first commit each pair appears in."""
    first = {}
    for c in git(repo, "rev-list", "--all", "--reverse").decode().split():
        for line in git(repo, "ls-tree", "-r", "-z", c).split(b"\0"):
            if not line:
                continue
            meta, path = line.split(b"\t", 1)
            mode, kind, blob = meta.split()
            if kind != b"blob" or mode == b"160000":
                continue
            first.setdefault((path.decode("utf-8"), blob.decode()), c)
    return first


class Cat:
    def __init__(self, repo):
        self.p = subprocess.Popen(["git", "-C", repo, "cat-file", "--batch"], stdin=subprocess.PIPE, stdout=subprocess.PIPE)

    def read(self, sha):
        self.p.stdin.write((sha + "\n").encode())
        self.p.stdin.flush()
        header = self.p.stdout.readline().split()
        if len(header) < 3 or header[1] == b"missing":
            return None
        data = self.p.stdout.read(int(header[2]))
        self.p.stdout.read(1)
        return data

    def close(self):
        self.p.stdin.close()
        self.p.wait()


def has_object(repo, sha):
    return subprocess.run(["git", "-C", repo, "cat-file", "-e", sha], capture_output=True).returncode == 0


# ---------------------------------------------------------------- the live dictionary (every list this computer holds)
def _add_rows(rows, idname, byid):
    for r in rows:
        if not isinstance(r, dict):
            continue
        p = r.get("player") or {}
        i, n = p.get("id"), p.get("name")
        if i is None or not n:
            continue
        idname[str(i)] = n
        s = byid.setdefault(str(i), set())
        for k in ("value", "redraftValue"):
            v = r.get(k)
            if isinstance(v, (int, float)) and v == int(v):
                s.add(int(v))


def _is_list(d):
    return isinstance(d, list) and d and isinstance(d[0], dict) and "player" in d[0] and "value" in d[0]


def live_dictionary(main):
    """name -> FantasyCalc values from the main folder's fixtures, .cache/ FileCache envelopes, the local archive
    (data-local/fantasycalc-snapshots, joined to names through the lists' own ids) and the dumps' market maps."""
    idname, byid, names = {}, {}, collections.defaultdict(set)
    for f in glob.glob(os.path.join(main, "fixtures", "sanitized", "shared", "*.json")):
        try:
            d = json.load(open(f, encoding="utf-8"))
        except Exception:
            continue
        if _is_list(d):
            _add_rows(d, idname, byid)
    for f in glob.glob(os.path.join(main, ".cache", "**", "*.json"), recursive=True):
        try:
            d = json.load(open(f, encoding="utf-8"))
        except Exception:
            continue
        v = d.get("value") if isinstance(d, dict) else None
        t = v.get("text") if isinstance(v, dict) else None
        if isinstance(t, str) and t.lstrip().startswith('[{"player"'):
            try:
                _add_rows(json.loads(t), idname, byid)
            except Exception:
                pass
    for f in glob.glob(os.path.join(main, "data-local", "fantasycalc-snapshots", "**", "*.json.gz"), recursive=True):
        try:
            d = json.loads(gzip.open(f).read())
        except Exception:
            continue
        for i, r in (d.get("players") or {}).items():
            s = byid.setdefault(str(i), set())
            for k in ("value", "redraftValue"):
                v = r.get(k)
                if isinstance(v, (int, float)):
                    s.add(int(v))
    for i, n in idname.items():
        names[n] |= byid.get(i, set())
    for f in glob.glob(os.path.join(main, "data-local", "**", "inputs.json"), recursive=True):
        snap = os.path.join(os.path.dirname(f), "snapshot.json")
        if not os.path.exists(snap):
            continue
        try:
            inp = json.load(open(f, encoding="utf-8"))
            s = json.load(open(snap, encoding="utf-8"))
        except Exception:
            continue
        players = (s.get("snapshot") or s).get("players") or {}
        market = inp.get("market") or {}
        for key in ("values", "seasonValues", "dynastyValues"):
            mp = market.get(key)
            if isinstance(mp, dict):
                for pid, val in mp.items():
                    nm = (players.get(pid) or {}).get("name")
                    if nm and isinstance(val, (int, float)):
                        names[nm].add(int(val))
    return dict(names)


COMMON_SURNAMES = set("""allen williams brown johnson jones smith davis miller wilson moore taylor anderson thomas jackson
white harris martin thompson garcia martinez robinson clark rodriguez lewis walker young hall king wright lopez hill scott
green adams baker nelson carter mitchell perez roberts turner phillips campbell parker evans edwards collins stewart morris
murphy cook rogers morgan cooper peterson bailey reed kelly howard ward cox richardson wood watson brooks bennett gray james
hayes price long henry jefferson pierce warren mason chase gibbs barkley lamb hampton higgins worthy flowers washington
allgeier""".split())


def distinctive_surnames(names):
    """surname -> full name, for surnames only one dictionary player has (5+ letters, not a common word or surname)."""
    by = collections.defaultdict(set)
    for n in names:
        toks = n.replace(".", "").split()
        if not toks or n[:4].isdigit():
            continue
        suffix = toks[-1] in ("Jr", "Sr", "II", "III", "IV", "V")
        sur = (toks[-2] + " " + toks[-1] + ("." if toks[-1] in ("Jr", "Sr") else "")) if suffix and len(toks) > 1 else toks[-1]
        by[sur].add(n)
    return {s: next(iter(ns)) for s, ns in by.items()
            if len(ns) == 1 and len(s.split()[0]) >= 5 and s.split()[0].lower() not in COMMON_SURNAMES}


# ---------------------------------------------------------------- the checks
def fantasycalc_shaped(obj):
    if isinstance(obj, list):
        rows = [r for r in obj if isinstance(r, dict) and isinstance(r.get("player"), dict) and isinstance(r.get("value"), (int, float))]
        if len(rows) >= 3:
            return "an array of FantasyCalc-style rows"
        for x in obj:
            hit = fantasycalc_shaped(x)
            if hit:
                return hit
    elif isinstance(obj, dict):
        if isinstance(obj.get("redraftValue"), (int, float)):
            return "a numeric redraftValue"
        for x in obj.values():
            hit = fantasycalc_shaped(x)
            if hit:
                return hit
    return None


def needles_fingerprint(main):
    h = hashlib.sha256()
    files = [os.path.join(main, ".env.local")]
    files += sorted(glob.glob(os.path.join(main, "fixtures", "raw", "**", "redaction-map.json"), recursive=True))
    files += sorted(glob.glob(os.path.join(main, "fixtures", "raw", "**", "watchlist.json"), recursive=True))
    files += sorted(glob.glob(os.path.join(main, "data-local", "**", "watchlist.json"), recursive=True))
    for f in files:
        h.update(os.path.relpath(f, main).encode())
        try:
            with open(f, "rb") as fh:
                h.update(hashlib.sha256(fh.read()).digest())
        except OSError:
            h.update(b"missing")
    h.update(open(os.path.join(main, "scripts", "check-leaks.ts"), "rb").read())
    return h.hexdigest()


def leak_check(repo, main, pairs, cat):
    cache_dir = os.path.join(main, ".cache", "publish")
    os.makedirs(cache_dir, exist_ok=True)
    cache_file = os.path.join(cache_dir, "leak-verified.json")
    fp = needles_fingerprint(main)
    try:
        cache = json.load(open(cache_file, encoding="utf-8"))
    except Exception:
        cache = {}
    if cache.get("fingerprint") != fp:
        cache = {"fingerprint": fp, "verified": []}
    verified = set(cache["verified"])
    todo = sorted((p, b) for p, b in pairs if f"{p}\0{b}" not in verified)
    if not todo:
        return [], 0
    by_path = collections.defaultdict(list)
    for p, b in todo:
        by_path[p].append(b)
    batches = collections.defaultdict(list)
    for p, blobs in by_path.items():
        for k, b in enumerate(blobs):
            batches[k].append((p, b))
    tmp = tempfile.mkdtemp(prefix="offersheet-leaks-")
    failures = []
    npx = shutil.which("npx") or shutil.which("npx.cmd") or "npx"
    try:
        for k in sorted(batches):
            base = os.path.join(tmp, f"b{k:03d}")
            for p, b in batches[k]:
                dest = os.path.join(base, *p.split("/"))
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with open(dest, "wb") as f:
                    f.write(cat.read(b) or b"")
            lst = os.path.join(tmp, f"b{k:03d}.txt")
            with open(lst, "w", encoding="utf-8") as f:
                f.write("\n".join(p for p, _ in batches[k]) + "\n")
            r = subprocess.run([npx, "tsx", "scripts/check-leaks.ts", "--files", lst, "--base", base], cwd=main,
                               capture_output=True, text=True, encoding="utf-8", errors="replace")
            out = r.stdout + r.stderr
            m = re.search(r"(\d+) hard, (\d+) soft", out)
            hard = int(m.group(1)) if m else -1
            if hard != 0 or r.returncode != 0:
                lines = [l for l in out.splitlines() if l.strip() and ("❌" in l or "hard" in l or "couldn't" in l)]
                failures.append(f"leak check, batch {k} ({len(batches[k])} files): exit {r.returncode}: " + " | ".join(lines)[:1500])
            else:
                verified.update(f"{p}\0{b}" for p, b in batches[k])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    cache["verified"] = sorted(verified)
    with open(cache_file, "w", encoding="utf-8") as f:
        json.dump(cache, f)
    return failures, len(todo)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--rules", required=True)
    ap.add_argument("--dictionary", required=True)
    ap.add_argument("--main", required=True)
    ap.add_argument("--leak-check", action="store_true")
    ap.add_argument("--no-live-dictionary", action="store_true")
    ap.add_argument("--report")
    a = ap.parse_args(argv)
    repo, main = os.path.abspath(a.repo), os.path.abspath(a.main)
    rules = T.load_rules(a.rules)
    names = T.load_dictionary(a.dictionary)
    if not a.no_live_dictionary:
        for n, v in live_dictionary(main).items():
            names.setdefault(n, set()).update(v)
    dictionary = T.Dictionary(names)
    surnames = distinctive_surnames(names)
    sur_re = re.compile(r"(?<![\w'])(" + "|".join(re.escape(s) for s in sorted(surnames, key=len, reverse=True)) + r")(?![\w])") if surnames else None

    fc = rules.get("fantasyCalcFixtures") or {}
    dropped = set(rules["dropPaths"])
    if fc.get("indexPath") and fc.get("labelPrefix"):
        dropped |= fantasycalc_fixture_files(main, fc["indexPath"], fc["labelPrefix"])
    drop_patterns = [re.compile(p) for p in rules["dropPathPatterns"]]
    allow = rules["allowlist"]

    pairs = published_blobs(repo)
    failures = []
    cat = Cat(repo)
    counts = collections.Counter()
    for (path, blob), commit in sorted(pairs.items()):
        where = f"{path} @{commit[:10]}"
        if path in dropped or any(p.search(path) for p in drop_patterns):
            failures.append(f"dropped path present: {where}")
            continue
        if BINARY_EXT.search(path):
            counts["binary"] += 1
            continue
        data = cat.read(blob)
        if data is None or b"\0" in data[:8192]:
            counts["binary"] += 1
            continue
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            counts["binary"] += 1
            continue
        counts["text"] += 1
        if path.endswith(".json"):
            try:
                obj = json.loads(text)
                hit = fantasycalc_shaped(obj)
                if hit:
                    failures.append(f"FantasyCalc-shaped data ({hit}): {where}")
            except Exception:
                if not has_object(main, blob):
                    failures.append(f"JSON the rewrite made doesn't parse: {where}")
        for s, e, n, v in T.find_values(text, dictionary, path, allow, 160, 100, line_bounded=False):
            line = text.count("\n", 0, s) + 1
            failures.append(f"FantasyCalc value of {n} ({v}): {where} line {line}: {text[max(0, s - 80):e + 30]!r}")
        if sur_re is not None and not path.startswith("fixtures/"):
            for m in sur_re.finditer(text):
                full = surnames[m.group(1)]
                ls = text.rfind("\n", 0, m.start()) + 1
                le = text.find("\n", m.end())
                le = len(text) if le < 0 else le
                for k in T.NUM_RE.finditer(text, max(ls, m.start() - 80), min(le, m.end() + 80)):
                    v = int(k.group(1).replace(",", ""))
                    if v >= 100 and v in names[full] and not T.allowed(allow, path, full, v):
                        line = text.count("\n", 0, k.start()) + 1
                        failures.append(f"FantasyCalc value of {full} by surname ({v}): {where} line {line}: {text[max(0, k.start() - 80):k.end() + 30]!r}")
        for b in rules["bannedStrings"]:
            if b in text:
                failures.append(f"banned text {b!r}: {where}")
        for bp in rules["bannedPatterns"]:
            if re.search(bp["path"], path):
                m = re.search(bp["pattern"], text)
                if m:
                    failures.append(f"banned pattern {bp['pattern']!r} ({m.group(0)!r}): {where}")
    leak_failures, leak_checked = ([], 0)
    if a.leak_check:
        leak_failures, leak_checked = leak_check(repo, main, list(pairs), cat)
        failures += leak_failures
    cat.close()
    summary = {"pairs": len(pairs), "text": counts["text"], "binary": counts["binary"], "leakChecked": leak_checked,
               "dictionaryNames": len(names), "surnames": len(surnames), "failures": failures}
    if a.report:
        with open(a.report, "w", encoding="utf-8") as f:
            json.dump(summary, f, indent=1)
    print(f"verify: {len(pairs)} published file versions ({counts['text']} text, {counts['binary']} binary); "
          f"dictionary {len(names)} names, {len(surnames)} distinctive surnames; "
          f"leak check {'on, ' + str(leak_checked) + ' new versions checked' if a.leak_check else 'off'}")
    if failures:
        print(f"verify: {len(failures)} problem(s):")
        for f in failures[:200]:
            print("  - " + f)
        sys.exit(1)
    print("verify: every check passed")


if __name__ == "__main__":
    main()
