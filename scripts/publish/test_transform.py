"""Unit tests for transform.py (run by scripts/publish/publish.test.ts through `python -m unittest`). Made-up players
and numbers only: no real FantasyCalc value belongs in a test."""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import transform as T  # noqa: E402

D = T.Dictionary({"Zorblax Kickwell": {7777, 5150}, "Quennard Vasquel": {612}, "2031 1st (Early)": {4242}})


class MaskColumns(unittest.TestCase):
    TABLE = "\n".join([
        "intro 7777",
        "| Player | Pos | Value | ROS |",
        "|---|---|---|---|",
        "| Zorblax Kickwell | RB | 7,777 | 142.5 |",
        "| Quennard Vasquel | WR | 612 (off the curve) | 90.1 |",
        "| Nobody | TE |  | 12.0 |",
        "",
        "| Setting | Value |",
        "|---|---|",
        "| Teams | 12 |",
    ])

    def test_masks_only_the_value_column_of_tables_with_a_player_column(self):
        out = T.mask_columns(self.TABLE, r"^Value$", r"^Player$")
        self.assertIn("| Zorblax Kickwell | RB | [value] | 142.5 |", out)
        self.assertIn("| Quennard Vasquel | WR | [value] (off the curve) | 90.1 |", out)
        self.assertIn("| Nobody | TE |  | 12.0 |", out)
        self.assertIn("| Teams | 12 |", out)  # no Player column: untouched
        self.assertTrue(out.startswith("intro 7777"))  # prose isn't a table

    def test_idempotent(self):
        once = T.mask_columns(self.TABLE, r"^Value$", r"^Player$")
        self.assertEqual(T.mask_columns(once, r"^Value$", r"^Player$"), once)


class DictionaryMask(unittest.TestCase):
    def test_masks_a_named_players_value_on_his_line_only(self):
        text = "Zorblax Kickwell (worth 7,777) beat Quennard Vasquel.\n7777 on another line stays."
        out = T.dictionary_mask(text, D)
        self.assertEqual(out, "Zorblax Kickwell (worth [value]) beat Quennard Vasquel.\n7777 on another line stays.")

    def test_numbers_that_are_not_his_values_stay(self):
        text = "Zorblax Kickwell scored 142 points over 13 games; Quennard Vasquel 612."
        self.assertEqual(T.dictionary_mask(text, D), "Zorblax Kickwell scored 142 points over 13 games; Quennard Vasquel [value].")

    def test_allowlist_excuses_a_pair_on_its_path(self):
        allow = [{"path": r"^reports/x\.md$", "name": "Quennard Vasquel", "number": 612, "why": "a count"}]
        text = "Quennard Vasquel: 612 screens"
        self.assertEqual(T.dictionary_mask(text, D, "reports/x.md", allow), text)
        self.assertEqual(T.dictionary_mask(text, D, "reports/y.md", allow), "Quennard Vasquel: [value] screens")

    def test_picks_count_as_names(self):
        self.assertEqual(T.dictionary_mask('"2031 1st (Early): 4242"', D), '"2031 1st (Early): [value]"')

    def test_idempotent(self):
        text = "Zorblax Kickwell 5150 and 7777"
        once = T.dictionary_mask(text, D)
        self.assertEqual(once, "Zorblax Kickwell [value] and [value]")
        self.assertEqual(T.dictionary_mask(once, D), once)


class ApplyRules(unittest.TestCase):
    RULES = {
        "columnRules": [{"path": r"\.md$", "header": r"^Value$", "require": r"^Player$"}],
        "replacements": [{"path": r"^notes/", "find": r"(W = )615\b", "replace": r"\g<1>[value]"}],
        "dictionaryMasks": [{"path": r"\.md$", "window": 160}],
        "allowlist": [],
    }

    def test_paths_scope_every_kind(self):
        self.assertEqual(T.apply_rules(self.RULES, "notes/a.md", "W = 615; Zorblax Kickwell 7777", D), "W = [value]; Zorblax Kickwell [value]")
        self.assertEqual(T.apply_rules(self.RULES, "src/a.ts", "W = 615; Zorblax Kickwell 7777", D), "W = 615; Zorblax Kickwell 7777")

    def test_no_dictionary_no_dictionary_masks(self):
        self.assertEqual(T.apply_rules(self.RULES, "x.md", "Zorblax Kickwell 7777", None), "Zorblax Kickwell 7777")


class PruneIndex(unittest.TestCase):
    def index(self):
        return json.dumps({
            "aaa.json": {"label": "fantasycalc/values?x=1", "captured": "2031-09-30"},
            "bbb.json": {"label": "sleeper/state/nfl", "url": "https://example.invalid/é", "captured": "2031-09-30"},
        }, indent=2, ensure_ascii=False) + "\n"

    def test_removes_the_labels_entries_and_keeps_the_formatting(self):
        text = self.index()
        self.assertTrue(T.roundtrips(text))
        out, removed = T.prune_index(text, "fantasycalc/")
        self.assertEqual(removed, ["aaa.json"])
        self.assertEqual(out, json.dumps({"bbb.json": json.loads(text)["bbb.json"]}, indent=2, ensure_ascii=False) + "\n")

    def test_nothing_to_remove_returns_the_text_itself(self):
        out, removed = T.prune_index(self.index(), "nothing/")
        self.assertEqual((out, removed), (self.index(), []))

    def test_roundtrip_detects_other_formatting(self):
        self.assertFalse(T.roundtrips('{"a": {"label": "x"}}\n'.replace(": ", ":")))


if __name__ == "__main__":
    unittest.main()
