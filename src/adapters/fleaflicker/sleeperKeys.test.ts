/**
 * Every canonical key the Fleaflicker scoring map can emit for a position class must be one Sleeper
 * actually fills for that class (Phase 1 review ENG-5, the check that caught the MFL map reading
 * pr_td / kr_td / ff / fum_rec). Offline: the evidence is committed Sleeper /stats and normalized
 * /projections rows (src/adapters/mfl/sleeperKeyEvidence.ts). Keys with no committed row are rare
 * events, listed with what the cached public /stats (weeks 1–3, 6,848 player rows and 96 team
 * defenses; aggregate counts) showed.
 *
 * A category's keys belong to the class the table names them for: `player` (and `punter`) keys to
 * offense, kickers and punters; `idp` keys to individual defenders; `dst` keys to team defense. An
 * IDP rule on a category without an `idp` key reads the player key (passing yards for a linebacker):
 * legitimately 0 for that class, so it isn't checked there.
 */
import { describe, expect, it } from "vitest";
import { sleeperKeyEvidence, type EvidenceClass } from "@/adapters/mfl/sleeperKeyEvidence";
import { FF_CATEGORIES, distanceKeys } from "./scoringMap";

const CLASSES: EvidenceClass[] = ["off", "idp", "def"];

/** A defensive play by an offensive player (a two-way player, a tackle after a turnover). */
const OFFENSIVE_PLAYERS_DEFENSE = "an offensive player's defensive play: 0 offensive rows in weeks 1–3 (Sleeper does record these under idp_* keys: idp_tkl, idp_tkl_solo, idp_ff and idp_blk_kick appear on offensive rows)";

/** Keys with no committed Sleeper row of the class, and why that's acceptable. */
const NO_COMMITTED_EVIDENCE: Readonly<Record<EvidenceClass, Readonly<Record<string, string>>>> = {
  off: {
    fgm_0_19: "rare (0 rows in weeks 1–3); a Sleeper scoring key",
    fgmiss_0_19: "rare (0 rows in weeks 1–3); a Sleeper scoring key",
    fgmiss_20_29: "1 kicker row in the cached weeks 1–3",
    fgmiss_60p: "2 kicker rows in the cached weeks 1–3",
    fum_rec_td: "rare (0 rows in weeks 1–3); a Sleeper scoring key",
    idp_blk_kick: "1 offensive row in the cached weeks 1–3",
    idp_def_td: OFFENSIVE_PLAYERS_DEFENSE,
    idp_fum_rec: OFFENSIVE_PLAYERS_DEFENSE,
    idp_fum_ret_yd: OFFENSIVE_PLAYERS_DEFENSE,
    idp_int: OFFENSIVE_PLAYERS_DEFENSE,
    idp_int_ret_yd: OFFENSIVE_PLAYERS_DEFENSE,
    idp_pass_def: OFFENSIVE_PLAYERS_DEFENSE,
    idp_qb_hit: OFFENSIVE_PLAYERS_DEFENSE,
    idp_sack: OFFENSIVE_PLAYERS_DEFENSE,
    idp_safe: OFFENSIVE_PLAYERS_DEFENSE,
    idp_tkl_loss: OFFENSIVE_PLAYERS_DEFENSE,
    punt_blkd: "1 punter row in the cached weeks 1–3",
    punt_tb: "23 punter rows in the cached weeks 1–3",
  },
  idp: {
    idp_blk_kick: "7 defender rows in the cached weeks 1–3",
    idp_fum_ret_yd: "8 defender rows in the cached weeks 1–3",
  },
  def: {
    def_2pt: "rare (0 rows in weeks 1–3); a Sleeper scoring key",
  },
};

/** Distance bands that line up with Sleeper's keys: TD 40+/50+/40–49 and every FG bucket (and 50+). */
const BANDS: ReadonlyArray<readonly [number | undefined, number | undefined]> = [
  [40, undefined],
  [50, undefined],
  [40, 49],
  [0, 19],
  [20, 29],
  [30, 39],
  [50, 59],
  [60, undefined],
];

/** Every key the category table can emit per class, with the category ids behind it. */
function emittedKeys(): Record<EvidenceClass, Map<string, Set<number>>> {
  const out: Record<EvidenceClass, Map<string, Set<number>>> = { off: new Map(), idp: new Map(), def: new Map() };
  const add = (cls: EvidenceClass, id: number, keys: ReadonlyArray<string | undefined>) => {
    for (const k of keys) if (k) out[cls].set(k, (out[cls].get(k) ?? new Set()).add(id));
  };
  for (const [idText, e] of Object.entries(FF_CATEGORIES)) {
    const id = Number(idText);
    add("off", id, [e.player, e.punter, ...(e.extra?.player ?? [])]);
    add("idp", id, [e.idp, ...(e.extra?.idp ?? [])]);
    add("def", id, [e.dst, ...(e.extra?.dst ?? [])]);
    if (e.events) {
      for (const [lo, hi] of BANDS) add("off", id, (distanceKeys(e.events, lo, hi) ?? []).map((b) => b.key));
      if (e.events === "fgm") add("off", id, ["fgm_yds", "fgm_yds_over_30"]); // per yard of each made FG
    }
  }
  return out;
}

describe("Fleaflicker scoring map: every key it emits is one Sleeper fills for that class", () => {
  const evidence = sleeperKeyEvidence();
  const emitted = emittedKeys();

  it.each(CLASSES)("%s: each key appears on a committed Sleeper row of the class, or is a listed rare event", (cls) => {
    const keys = [...emitted[cls].keys()];
    expect(keys.length).toBeGreaterThan(10);
    const missing = keys.filter((k) => !evidence.rows[cls].has(k)).sort();
    expect(missing).toEqual(Object.keys(NO_COMMITTED_EVIDENCE[cls]).sort());
  });

  it("reads Sleeper's player keys for return TDs, forced fumbles and recoveries (st_td, idp_ff, idp_fum_rec + st_fum_rec)", () => {
    for (const k of ["pr_td", "kr_td", "ff", "fum_rec"]) expect(emitted.off.has(k), k).toBe(false);
    expect([...(emitted.off.get("st_td") ?? [])].sort()).toEqual([63, 67]);
    expect(evidence.rows.off.get("st_td")).toBeGreaterThan(0);
    expect(evidence.rows.off.get("st_fum_rec")).toBeGreaterThan(0);
  });
});
