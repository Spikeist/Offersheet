/**
 * Every canonical key the MFL scoring map can emit for a position class must be one Sleeper actually
 * fills for that class (Phase 1 review ENG-5: the map read pr_td / kr_td / ff / fum_rec, which Sleeper
 * never puts on a player row, so return TDs and a player's forced fumbles and recoveries were dropped
 * silently). Offline: the evidence is committed Sleeper /stats and normalized /projections rows
 * (sleeperKeyEvidence.ts). Keys with no committed row are rare events, listed with what the cached
 * public /stats (weeks 1–3, 6,848 player rows and 96 team defenses; aggregate counts) showed.
 */
import { describe, expect, it } from "vitest";
import { scoringStatKeys } from "@/engine/scoring";
import { MFL_EVENTS, mflRulesToScoring, type MflEventMap } from "./scoringMap";
import { sleeperKeyEvidence, type EvidenceClass } from "./sleeperKeyEvidence";

const CLASSES: EvidenceClass[] = ["off", "idp", "def"];

/** Keys with no committed Sleeper row of the class, and why that's acceptable. */
const NO_COMMITTED_EVIDENCE: Readonly<Record<EvidenceClass, Readonly<Record<string, string>>>> = {
  off: {
    fg_blkd: "4 kicker rows in the cached weeks 1–3",
    fgm_0_19: "rare (0 rows in weeks 1–3); a Sleeper scoring key",
    fgmiss_0_19: "rare (0 rows in weeks 1–3); a Sleeper scoring key",
    fgmiss_20_29: "1 kicker row in the cached weeks 1–3",
    fgmiss_60p: "2 kicker rows in the cached weeks 1–3",
    fum_rec_td: "rare (0 rows in weeks 1–3); a Sleeper scoring key",
    idp_fum_rec: "an offensive player's defensive recovery: 0 rows in weeks 1–3 (idp_ff and st_fum_rec do appear on offensive rows)",
    xp_blkd: "3 kicker rows in the cached weeks 1–3",
  },
  idp: {
    idp_blk_kick: "7 defender rows in the cached weeks 1–3",
    idp_fum_ret_yd: "8 defender rows in the cached weeks 1–3",
  },
  def: {
    def_st_fum_rec: "7 team rows in the cached weeks 1–3 (5 of them with fum_rec 0: Sleeper keeps them apart)",
  },
};

type Row = readonly [event: string, range: string, points: string];
/** Rules that make the compiler emit every key an MFL event can map to (rates, TD lengths, FG distances). */
function probes(event: string, ev: MflEventMap): Row[][] {
  if (ev.kind === "total") return [[[event, "0-99", "*1"]]];
  switch (ev.family) {
    case "pass_td":
    case "rush_td":
    case "rec_td":
      return [[[event, "1-39", "4"], [event, "40-49", "5"], [event, "50-110", "6"]]];
    case "fgm":
    case "fgmiss":
      return [
        [[event, "0-110", "3"]],
        [[event, "17-19", "1"], [event, "20-29", "2"], [event, "30-39", "3"], [event, "40-49", "4"], [event, "50-59", "5"], [event, "60-110", "6"]],
        [[event, "17-49", "3"], [event, "50-110", "5"]],
        [[event, "0-110", "*0.1"]],
      ];
    default:
      return [[[event, "1-110", "6"]]];
  }
}

/** A position of each class: offense and kickers (PK), individual defenders (LB), team defense (Def). */
const REPRESENTATIVE: Readonly<Record<EvidenceClass, string>> = { off: "PK", idp: "LB", def: "Def" };

/** Every key the real compiler emits per class, with the MFL events behind it. */
function emittedKeys(): Record<EvidenceClass, Map<string, Set<string>>> {
  const out: Record<EvidenceClass, Map<string, Set<string>>> = { off: new Map(), idp: new Map(), def: new Map() };
  for (const [event, ev] of Object.entries(MFL_EVENTS)) {
    for (const cls of CLASSES) {
      for (const rows of probes(event, ev)) {
        const rule = rows.map(([e, range, points]) => ({ event: e, range, points }));
        const { scoring } = mflRulesToScoring({ rules: { positionRules: [{ positions: REPRESENTATIVE[cls], rule }] } });
        for (const k of scoringStatKeys(scoring)) out[cls].set(k, (out[cls].get(k) ?? new Set()).add(event));
      }
    }
  }
  return out;
}

describe("MFL scoring map: every key it emits is one Sleeper fills for that class", () => {
  const evidence = sleeperKeyEvidence();
  const emitted = emittedKeys();

  it.each(CLASSES)("%s: each key appears on a committed Sleeper row of the class, or is a listed rare event", (cls) => {
    const keys = [...emitted[cls].keys()];
    expect(keys.length).toBeGreaterThan(10);
    const missing = keys.filter((k) => !evidence.rows[cls].has(k)).sort();
    expect(missing).toEqual(Object.keys(NO_COMMITTED_EVIDENCE[cls]).sort());
  });

  it("would have caught the keys the map used to read (pr_td, kr_td, ff, fum_rec never appear on a player row)", () => {
    for (const k of ["pr_td", "kr_td", "ff", "fum_rec"]) {
      expect(evidence.rows.off.has(k), k).toBe(false);
      expect(emitted.off.has(k), k).toBe(false);
    }
    expect([...(emitted.off.get("st_td") ?? [])].sort()).toEqual(["#KT", "#UT", "KO", "PR"]);
    expect(evidence.rows.off.get("st_td")).toBeGreaterThan(0);
  });

  it("reads a committed evidence base of both stats and projections", () => {
    expect(evidence.sources.filter((s) => s.includes("sleeper/stats/")).length).toBeGreaterThanOrEqual(3);
    expect(evidence.sources.filter((s) => s.includes("sleeper/projections/")).length).toBeGreaterThanOrEqual(3);
  });
});
