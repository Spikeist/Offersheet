/**
 * An ESPN league's lineup slots in our terms (CLAUDE.md §2.2 "Lineup and roster"; settings.rosterSettings.
 * lineupSlotCounts): the starting slots, bench, IR, roster size, the scoring context (TQB, head coaches) and the
 * positions the lineup can start, whose free agents the import fetches. Pure and browser-safe (track BF: the browser's
 * read of a public league needs the free agents' positions; moved here from ./normalize.ts unchanged, which re-exports
 * it).
 */
import type { ImportWarning, Pos, SlotDef } from "@/engine/model";
import { SLOT, slotInfo } from "./positions";
import type { ScoringContext } from "./scoringMap";

export interface SlotSummary {
  lineup: SlotDef[];
  benchSlots: number;
  irSlots: number;
  maxRosterSize: number;
  scoringCtx: ScoringContext;
  /** Positions the lineup can start (free agents are fetched for these). */
  positions: Pos[];
}

/** FLEX (slot 23) is listed right after TE, as ESPN shows it. */
const slotOrder = (id: number) => (id === 23 ? 6.5 : id);

export function summarizeSlots(counts: Readonly<Record<string, number>>, warnings: ImportWarning[]): SlotSummary {
  const count = (id: number) => counts[String(id)] ?? 0;
  const lineup: SlotDef[] = [];
  let modeledStarters = 0;
  const idpSpecific: string[] = [];
  let idp = false;
  const ids = Object.keys(counts)
    .map(Number)
    .filter((id) => (counts[String(id)] ?? 0) > 0)
    .sort((a, b) => slotOrder(a) - slotOrder(b));
  for (const id of ids) {
    const n = count(id);
    const s = slotInfo(id);
    if (!s.starting) continue;
    const path = `settings.rosterSettings.lineupSlotCounts["${id}"]`;
    if (!s.eligible) {
      if (id === SLOT.HC) warnings.push({ code: "ESPN_HC_UNMAPPED", message: `The league starts ${n} head coach${n > 1 ? "es" : ""} (HC); head coaches aren't supported, so that slot is left out of lineups.`, platformPath: path });
      else warnings.push({ code: "ESPN_SLOT_UNKNOWN", message: `The league has ${n} lineup slot${n > 1 ? "s" : ""} of a kind we don't know (${s.label ?? `id ${id}`}); left out of lineups.`, platformPath: path });
      continue;
    }
    if (s.eligible.some((p) => p === "DL" || p === "LB" || p === "DB")) idp = true;
    if (s.label && ["DT", "DE", "CB", "S"].includes(s.label)) idpSpecific.push(s.label);
    lineup.push({ slot: s.name, count: n, eligible: s.eligible });
    modeledStarters += n;
  }
  if (idp)
    warnings.push({
      code: "ESPN_IDP_UNVERIFIED",
      message: `This league starts individual defensive players. ESPN IDP support is unverified (no ESPN IDP league was available to test)${idpSpecific.length ? `, and ESPN's ${[...new Set(idpSpecific)].join("/")} slots are modeled as DL (DT, DE) or DB (CB, S)` : ""}.`,
      platformPath: "settings.rosterSettings.lineupSlotCounts",
    });
  const tqb = count(SLOT.TQB) > 0;
  const qbKind = count(SLOT.QB) > 0 || count(SLOT.OP) > 0;
  const benchSlots = count(SLOT.BENCH);
  return {
    lineup,
    benchSlots,
    irSlots: count(SLOT.IR),
    maxRosterSize: modeledStarters + benchSlots,
    scoringCtx: { qbSource: tqb && !qbKind ? "TQB" : "QB", bothQbKinds: tqb && qbKind, startsHeadCoach: count(SLOT.HC) > 0 },
    positions: [...new Set(lineup.flatMap((s) => s.eligible))],
  };
}
