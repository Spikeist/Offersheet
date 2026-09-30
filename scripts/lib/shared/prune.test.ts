import { describe, expect, it } from "vitest";
import { sha256 } from "../cache";
import { expectedLabels, fixtureLabels } from "./labels";
import { planPrune } from "./prune";
import { planWeeks } from "./weeks";

describe("fixture labels and pruning", () => {
  const plan = planWeeks({ season: 2026, week: 4, seasonType: "regular" }, 18, "test");

  it("lists every fixture a run with this plan writes", () => {
    const labels = expectedLabels(plan, ["isDynasty=false&numQbs=1&numTeams=12&ppr=1"]);
    expect(labels.has(fixtureLabels.fcValues("isDynasty=false&numQbs=1&numTeams=12&ppr=1"))).toBe(true);
    expect(labels.has(fixtureLabels.sleeperProjWeek(2026, 4))).toBe(true);
    expect(labels.has(fixtureLabels.sleeperProjWeek(2026, 18))).toBe(true);
    expect(labels.has(fixtureLabels.sleeperStatsWeek(2026, 3))).toBe(true);
    expect(labels.has(fixtureLabels.sleeperStatsWeek(2026, 4))).toBe(false);
    expect(labels.has(fixtureLabels.espnPool(4))).toBe(true);
    // A later week plan no longer expects this week's current-week fixtures.
    const later = expectedLabels(planWeeks({ season: 2026, week: 9, seasonType: "regular" }, 18, "test"), []);
    expect(later.has(fixtureLabels.sleeperProjWeek(2026, 4))).toBe(false);
    expect(later.has(fixtureLabels.sleeperStatsWeek(2026, 8))).toBe(true);
  });

  it("drops unexpected or misnamed entries, orphan files and entries without a file", () => {
    const keep = "fantasycalc/values?isDynasty=false&numQbs=1&numTeams=12&ppr=1";
    const dropped = "fantasycalc/values?isDynasty=false&numQbs=1&numTeams=16&ppr=1";
    const index = {
      [`${sha256(keep)}.json`]: { label: keep },
      [`${sha256(dropped)}.json`]: { label: dropped },
      "0000.json": { label: keep },
      [`${sha256("gone")}.json`]: { label: "gone" },
    };
    const files = [`${sha256(keep)}.json`, `${sha256(dropped)}.json`, "0000.json", "stray.json", "index.json"];
    expect(planPrune(index, files, new Set([keep, "gone"]))).toEqual({
      dropEntries: ["0000.json", `${sha256(dropped)}.json`].sort(),
      orphanFiles: ["stray.json"],
      missingFiles: [`${sha256("gone")}.json`],
    });
  });
});
