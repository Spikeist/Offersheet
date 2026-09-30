import { describe, expect, it } from "vitest";
import type { FfDraftPick } from "./api";
import { dedupePicks, matchTradedPicks } from "./picks";

const team = (id: number) => ({ id });
const pick = (season: number, round: number, ownedBy: number, extra: Partial<FfDraftPick> = {}): FfDraftPick => ({ season, slot: { round }, ownedBy: team(ownedBy), ...extra });

describe("dedupePicks", () => {
  it("counts a traded pick once: the original owner's copy has lost=true", () => {
    const lists = [
      { teamId: 1, picks: [pick(2027, 1, 1), pick(2027, 2, 2, { originalOwner: team(1), traded: true, lost: true })] },
      { teamId: 2, picks: [pick(2027, 1, 2), pick(2027, 2, 2), pick(2027, 2, 2, { originalOwner: team(1), traded: true })] },
    ];
    const d = dedupePicks(lists);
    expect(d.entries).toBe(5);
    expect(d.distinct).toHaveLength(4);
    expect(d.lostCopies).toBe(1);
    expect(d.onlyLost).toBe(0);
    expect(d.conflicts).toBe(0);
    const traded = d.distinct.filter((p) => p.traded);
    expect(traded).toEqual([{ season: 2027, round: 2, originalTeam: 1, owner: 2, traded: true, copies: 2, lostCopies: 1 }]);
  });

  it("flags a pick seen only as a lost copy (forfeited) and owners that disagree", () => {
    const d = dedupePicks([
      { teamId: 3, picks: [pick(2028, 3, 3, { lost: true })] },
      { teamId: 4, picks: [pick(2028, 1, 5, { originalOwner: team(4) })] },
      { teamId: 6, picks: [pick(2028, 1, 6, { originalOwner: team(4) })] },
    ]);
    expect(d.onlyLost).toBe(1);
    expect(d.conflicts).toBe(1);
  });
});

describe("matchTradedPicks", () => {
  it("finds each traded pick in a completed trade's picksObtained for its new owner", () => {
    const d = dedupePicks([
      { teamId: 1, picks: [pick(2027, 2, 2, { originalOwner: team(1), traded: true, lost: true })] },
      { teamId: 2, picks: [pick(2027, 2, 2, { originalOwner: team(1), traded: true })] },
    ]);
    const trades = [{ teams: [{ team: team(2), picksObtained: [pick(2027, 2, 2, { originalOwner: team(1) })] }, { team: team(1), picksObtained: [] }] }];
    expect(matchTradedPicks(d.distinct, trades)).toEqual({ traded: 1, matched: 1 });
    expect(matchTradedPicks(d.distinct, [])).toEqual({ traded: 1, matched: 0 });
  });
});
