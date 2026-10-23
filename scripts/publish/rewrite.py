#!/usr/bin/env python3
"""
Rewrites a bare repository's history into the public copy (CLAUDE.md section 0.4), in place.

    python scripts/publish/rewrite.py --repo <bare repo> --rules <rules.json> --dictionary <fc-dictionary.json>
                                      [--report <out.json>]

Run it only on a throwaway bare repository (scripts/publish-public.ts makes one in a temp folder and fetches main and
the checkpoint tags into it); it never touches the repository it was fetched from. Every commit keeps its author, dates
and message (empty commits are kept); its tree loses the dropped paths and its text files go through transform.py:

  - dropPaths / dropPathPatterns, and the FantasyCalc fixture files: every file that ANY version of
    rules.fantasyCalcFixtures.indexPath maps to a label starting with labelPrefix, read from this repo's own history;
  - blobRules: a given (path, old blob) replaced with another blob's contents, or dropped;
  - index pruning of that index.json (transform.prune_index), only when its formatting round-trips byte for byte;
  - columnRules, replacements and dictionaryMasks on UTF-8 text (transform.apply_rules); binary files untouched.

Deterministic: the same input history, rules and dictionary give the same commit hashes (git-filter-repo keeps every
other byte), which is what lets a later publish fast-forward the public copy.

Uses the vendored git-filter-repo (scripts/vendor/git-filter-repo, MIT) as a library, with its file_info_callback.
"""
import argparse
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "vendor", "git-filter-repo"))

import transform as T  # noqa: E402


def git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, check=True).stdout


def fantasycalc_fixture_files(repo, index_path, prefix):
    """Every path any version of the index (in any commit of any ref) maps to a FantasyCalc label."""
    folder = index_path.rsplit("/", 1)[0]
    out, seen = set(), set()
    for line in git(repo, "log", "--all", "--format=%H", "--", index_path).decode().split():
        try:
            blob = git(repo, "rev-parse", f"{line}:{index_path}").decode().strip()
        except subprocess.CalledProcessError:
            continue
        if blob in seen:
            continue
        seen.add(blob)
        data = json.loads(git(repo, "cat-file", "-p", blob).decode("utf-8"))
        for name, meta in data.items():
            if isinstance(meta, dict) and str(meta.get("label", "")).startswith(prefix):
                out.add(f"{folder}/{name}")
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--repo", required=True)
    ap.add_argument("--rules", required=True)
    ap.add_argument("--dictionary", required=True)
    ap.add_argument("--report")
    a = ap.parse_args(argv)
    repo = os.path.abspath(a.repo)
    rules = T.load_rules(a.rules)
    dictionary = T.Dictionary(T.load_dictionary(a.dictionary))

    fc = rules.get("fantasyCalcFixtures") or {}
    index_path, prefix = fc.get("indexPath"), fc.get("labelPrefix")
    dropped = set(rules["dropPaths"])
    if index_path and prefix:
        dropped |= fantasycalc_fixture_files(repo, index_path, prefix)
    drop_patterns = [re.compile(p) for p in rules["dropPathPatterns"]]
    blob_rules = {(r["path"], r["oldBlob"]): r for r in rules["blobRules"]}

    import git_filter_repo as fr  # the vendored copy, found through sys.path above

    stats = {"droppedPaths": sorted(dropped), "dropChanges": 0, "changedBlobs": [], "unchangedText": 0, "binary": 0,
             "indexPruned": 0, "blobRuleHits": 0}
    cache = {}

    def callback(filename, mode, blob_id, value):
        path = filename.decode("utf-8")
        key = (path, blob_id)
        if key in cache:
            new = cache[key]
            if new is None:
                stats["dropChanges"] += 1
                return (None, mode, blob_id)
            return (filename, mode, new)
        if path in dropped or any(p.search(path) for p in drop_patterns):
            cache[key] = None
            stats["dropChanges"] += 1
            return (None, mode, blob_id)
        blob_hex = blob_id.decode() if isinstance(blob_id, bytes) else str(blob_id)
        rule = blob_rules.get((path, blob_hex))
        if rule is not None:
            stats["blobRuleHits"] += 1
            if rule["action"] == "drop":
                cache[key] = None
                return (None, mode, blob_id)
            contents = value.get_contents_by_identifier(rule["newBlob"].encode())
            if contents is None:
                raise SystemExit(f"blobRules: {rule['newBlob']} isn't in the repository")
            new = value.insert_file_with_contents(contents)
            cache[key] = new
            return (filename, mode, new)
        contents = value.get_contents_by_identifier(blob_id)
        new_contents = contents
        if value.is_binary(contents):
            stats["binary"] += 1
        else:
            try:
                text = contents.decode("utf-8")
            except UnicodeDecodeError:
                text = None
                stats["binary"] += 1
            if text is not None:
                out = text
                if path == index_path and prefix:
                    if not T.roundtrips(text):
                        raise SystemExit(f"{path}: its JSON formatting doesn't round-trip, so it can't be pruned safely")
                    out, removed = T.prune_index(out, prefix)
                    if removed:
                        stats["indexPruned"] += 1
                out = T.apply_rules(rules, path, out, dictionary)
                if out != text:
                    new_contents = out.encode("utf-8")
                else:
                    stats["unchangedText"] += 1
        if new_contents is contents:
            cache[key] = blob_id
            return (filename, mode, blob_id)
        new = value.insert_file_with_contents(new_contents)
        cache[key] = new
        stats["changedBlobs"].append([path, blob_hex])
        return (filename, mode, new)

    args = fr.FilteringOptions.parse_args(["--force", "--quiet", "--prune-empty", "never", "--prune-degenerate", "never"])
    cwd = os.getcwd()
    os.chdir(repo)
    try:
        fr.RepoFilter(args, file_info_callback=callback).run()
    finally:
        os.chdir(cwd)
    stats["changedBlobs"].sort()
    if a.report:
        with open(a.report, "w", encoding="utf-8") as f:
            json.dump(stats, f, indent=1)
    print(f"rewrite: {len(stats['droppedPaths'])} paths dropped ({stats['dropChanges']} file changes), "
          f"{len(stats['changedBlobs'])} text versions changed, {stats['indexPruned']} index versions pruned, "
          f"{stats['blobRuleHits']} blob rule hits, {stats['binary']} binary versions untouched")


if __name__ == "__main__":
    main()
