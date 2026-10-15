/**
 * check:browser's release contract (Checkpoint 7f; planner reply to Checkpoint 7e, answer 4: "keep the rule, but the card must
 * say why"; contracts.ts releaseLineProblems): every line about a release at an IR return, a card's, a Plan B box's or the League
 * page's "Returns from IR", reads as the app words it: the near-tie rule's reason in the planner's shape, never after "instead of
 * dropping someone else", and a release made with or without the trade saying so. The app's own lines pass (tradeView.ts
 * myMovesLines and releaseLine on a made-up league, with NFL names for the planner's sentence), and the reader compiles.
 */
import { describe, expect, it } from "vitest";
import { tradeSnapshot } from "@/components/trades/testFixtures";
import type { PlayerInfo } from "@/engine/model";
import { myMovesLines, releaseLine } from "@/lib/tradeView";
import { RELEASE_EITHER_WAY, RELEASE_REASON, releaseLineProblems } from "./contracts";
import { CARD_HELPERS, PAGE_HELPERS, READ_RELEASE_LINES, cleanCall } from "./inPage";
import { nameRules } from "./report";

const base = tradeSnapshot();
const snapshot = { ...base, players: { ...base.players, "107": { ...(base.players["107"] as PlayerInfo), name: "Alec Pierce" }, "105": { ...(base.players["105"] as PlayerInfo), name: "Marvin Harrison Jr." }, "108": { ...(base.players["108"] as PlayerInfo), name: "Kyle Pitts Sr." } } };
const harrison = { keptInstead: "105", lockable: true };
const PLANNER = "Week 7, when Alec Pierce returns from IR: release him. He and Marvin Harrison Jr. are nearly even for your lineup, and Harrison Jr. has more trade value. Lock Pierce to keep him instead.";

describe("check:browser's release contract (Checkpoint 7f; planner reply to Checkpoint 7e, answer 4)", () => {
  it("passes the app's own lines: every release, with the reason or without, made either way or not, and the keep lines", () => {
    const lines = myMovesLines(
      {
        moves: [
          { kind: "release", week: 7, player: "107", returner: "107", nearTie: harrison },
          { kind: "release", week: 7, player: "108", returner: "107", instead: "107", kept: true, nearTie: harrison },
          { kind: "release", week: 7, player: "107", returner: "107", instead: "108", kept: false, nearTie: { keptInstead: "105", lockable: false } },
          { kind: "release", week: 8, player: "107", returner: "107" },
          { kind: "keepAtReturn", week: 9, player: "108", returner: "107", returnerStays: true },
        ],
        assumed: [],
        assumedLater: [
          { week: 10, player: "107", returner: "107", nearTie: harrison },
          { week: 11, player: "108", returner: "107" },
        ],
      },
      snapshot,
      "Team 2",
    );
    expect(lines[0]).toBe(PLANNER);
    expect(lines).toHaveLength(7);
    expect(releaseLineProblems(lines)).toEqual([]);
    expect(releaseLineProblems([releaseLine({ week: 7, player: "108", returner: "107", nearTie: harrison }, snapshot)])).toEqual([]);
    expect(RELEASE_REASON.test(PLANNER)).toBe(true);
    expect(RELEASE_EITHER_WAY.test(lines[5] as string)).toBe(true);
  });

  it("names a reason in another shape, a reason after “instead of dropping someone else”, and a release made either way worded otherwise", () => {
    expect(releaseLineProblems(["Week 7, when Alec Pierce returns from IR: release him. He and Marvin Harrison Jr. are nearly even for your lineup, and Harrison Jr. is worth 900."])).toHaveLength(1);
    expect(releaseLineProblems(["Week 7, when Alec Pierce returns from IR: release him instead of dropping someone else. He and Marvin Harrison Jr. are nearly even for your lineup, and Harrison Jr. has more trade value."])).toEqual([
      "a release with a reason still says “instead of dropping someone else”: “Week 7, when Alec Pierce returns from IR: release him instead of dropping someone else. He and Marvin Harrison Jr. are nearly even for your lineup, and Harrison Jr. has more trade value.”",
    ]);
    expect(releaseLineProblems(["Week 7, when Alec Pierce returns from IR: with or without this trade, release him."])).toEqual(["a release made either way reads “Week 7, when Alec Pierce returns from IR: with or without this trade, release him.”"]);
  });

  it("its reader compiles with the cleaning prelude (TypeScript never checks it) and reads list items", () => {
    const clean = cleanCall(nameRules({ leagueName: "Fictional League", teams: [{ id: "3", name: "Gravel Gophers", ownerName: "Rowan Vale" }], players: [] }, [["12345", "<league id>"]]));
    expect(() => new Function(`return (async () => {\n${PAGE_HELPERS}\n${CARD_HELPERS}\n${clean}\n${READ_RELEASE_LINES}\n})`)).not.toThrow();
    expect(READ_RELEASE_LINES).toContain('querySelectorAll("main li")');
    expect(READ_RELEASE_LINES).toContain("clean(txt(li))");
  });
});
