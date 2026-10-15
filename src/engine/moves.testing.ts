/**
 * The check that a trade card's list of my roster moves (TradeEvaluation.myMoves; Checkpoint 7e, planner reply to Checkpoint 7d,
 * item 2.2; review of wave B) accounts for my roster after the trade against the trade's own "before" (src/engine/
 * evaluate.moves.test.ts, search.moves.test.ts). Test-only: nothing in the app imports it.
 */
import { tradeSides, type ExactTrade, type TradeInternals } from "./evaluate";
import type { Displacement } from "./returners";
import type { AssumedRelease, NearTieRelease, RosterMove } from "./tradeModel";

/**
 * What an exact trade's move list gets wrong against its rosters (empty: nothing): every player my roster after the trade
 * holds and its "before" doesn't (and the other way round), the trade's own players aside, named once as such by the move
 * that makes it (a player the trade brings in that my pickups drop again counts as a loss to name); a pickup of the "before"
 * a legality line or pickupDrop names as one is in both; the assumed line names only pickups in both and drops gone from
 * both; and at each IR player's return, where the "before" and the roster after the trade release different players, the
 * line says whom (a release with the "before"'s, or a kept player when it releases nobody), and no line where they agree.
 * No safety-net move ("drop", "keep", "add": the cause is named for every difference). Checkpoint 7f (planner reply to
 * Checkpoint 7e, answer 4; the lead's R3): where they agree, exactly that release is named as made with or without the trade
 * (RosterMoves.assumedLater), and a release says why the near-tie rule decided it exactly when it did after the trade
 * (returners.Displacement.keptInstead; lockable when the player released is mine as imported).
 */
export function movesMismatch(I: TradeInternals, x: ExactTrade): string[] {
  const me = I.me;
  const moves = x.evaluation.myMoves;
  if (!me) return [];
  if (!moves) return ["no moves"];
  const p = x.evaluation.proposal;
  const give = p.give.flatMap((a) => (a.kind === "player" ? [a.id] : []));
  const get = p.get.flatMap((a) => (a.kind === "player" ? [a.id] : []));
  const sides = tradeSides(I, me, x.partner, give, get, "Team");
  if ("illegal" in sides) return [sides.illegal];
  const after = new Set(sides.mine.roster);
  const beforeSide = x.before ?? me.base;
  const before = new Set(beforeSide.roster);
  const problems: string[] = [];
  const gained = new Set([...after].filter((id) => !before.has(id) && !get.includes(id)));
  const lost = new Set([...before].filter((id) => !after.has(id) && !give.includes(id)));
  const droppedIn = new Set(get.filter((id) => !sides.mineLegal.toIR.includes(id) && !after.has(id)));
  const gain = (id: string | null) => {
    if (id !== null && !gained.delete(id)) problems.push(`named as a gain: ${id}`);
  };
  const loss = (id: string | null) => {
    if (id !== null && !lost.delete(id) && !droppedIn.delete(id)) problems.push(`named as a loss: ${id}`);
  };
  const inBoth = (id: string) => {
    if (!after.has(id) || !before.has(id)) problems.push(`named as a pickup made either way: ${id}`);
  };
  for (const m of moves.moves) {
    if (m.kind === "positionLimit") loss(m.drop);
    else if (m.kind === "makeRoom") m.drop.forEach(loss);
    else if (m.kind === "rosterMinimum" || m.kind === "openSpot") {
      const id = m.kind === "openSpot" ? m.spot.playerId : m.add;
      if (m.pickup) {
        inBoth(id);
        gain(m.pickup.keep);
      } else gain(id);
    } else if (m.kind === "waiver") {
      gain(m.add);
      loss(m.drop);
      if (m.insteadOf !== undefined) loss(m.insteadOf);
    } else if (m.kind === "pickupDrop") {
      inBoth(m.add);
      loss(m.drop);
      gain(m.instead);
    } else if (m.kind === "skip") {
      loss(m.add);
      gain(m.keep);
    } else if (m.kind === "drop" || m.kind === "keep" || m.kind === "add") problems.push(`safety net: ${m.kind} ${m.player}`);
  }
  for (const id of gained) problems.push(`gain not named: ${id}`);
  for (const id of lost) problems.push(`loss not named: ${id}`);
  for (const id of droppedIn) problems.push(`drop of a player received not named: ${id}`);
  for (const a of moves.assumed) {
    if (a.add !== null) inBoth(a.add);
    if (a.drop !== null && (after.has(a.drop) || before.has(a.drop))) problems.push(`assumed drop not gone from both: ${a.drop}`);
  }
  // Later weeks: per returner (one release each), after the trade against the "before".
  const first = (list: readonly Displacement[]) => {
    const out = new Map<string, Displacement>();
    for (const d of list) if (!out.has(d.returner)) out.set(d.returner, d);
    return out;
  };
  const relAfter = first(x.mine.displaced);
  const relBefore = first(beforeSide.displaced);
  const weeks = I.league.lp.weeks.weeks;
  // Why the near-tie rule decided a release after the trade: exactly when it did, the player it kept, whether he's mine.
  const reasonOf = (d: Displacement, said: NearTieRelease | undefined, what: string) => {
    if (d.keptInstead === undefined) {
      if (said) problems.push(`${what}: a near-tie reason the rule didn't decide`);
    } else if (said?.keptInstead !== d.keptInstead || said.lockable !== (me.roster.includes(d.id) || me.ir.includes(d.id))) problems.push(`${what}: the near-tie reason not named as decided`);
  };
  const lines = new Map<string, RosterMove>();
  for (const m of moves.moves) if (m.kind === "release" || m.kind === "keepAtReturn") lines.set(m.returner, m);
  const alike = new Map<string, AssumedRelease>();
  for (const l of moves.assumedLater ?? []) {
    if (alike.has(l.returner)) problems.push(`a return named twice as made either way: ${l.returner}`);
    alike.set(l.returner, l);
  }
  for (const r of new Set([...relAfter.keys(), ...relBefore.keys()])) {
    const a = relAfter.get(r);
    const b = relBefore.get(r);
    const line = lines.get(r);
    const same = alike.get(r);
    lines.delete(r);
    alike.delete(r);
    if (a && b && a.id === b.id && a.from === b.from) {
      if (line) problems.push(`a line for an unchanged return: ${r}`);
      if (!same || same.player !== a.id || same.week !== weeks[a.from]) problems.push(`the release made either way at ${r}'s return not named`);
      else reasonOf(a, same.nearTie, `the release made either way at ${r}'s return`);
    } else {
      if (same) problems.push(`a release named as made either way at a changed return: ${r}`);
      if (a) {
        if (line?.kind !== "release" || line.player !== a.id) problems.push(`release at ${r}'s return not named`);
        else {
          if (b && b.id !== a.id && line.instead !== b.id) problems.push(`the before's release at ${r}'s return not named`);
          reasonOf(a, line.nearTie, `the release at ${r}'s return`);
        }
      } else if (b) {
        const stays = b.id === r ? !give.includes(r) : after.has(b.id) && !x.mine.displaced.some((d) => d.id === b.id && d.from <= b.from);
        if (stays !== (line?.kind === "keepAtReturn" && line.player === b.id)) problems.push(`kept at ${r}'s return: ${stays ? "not named" : "named"}`);
      }
    }
  }
  for (const r of lines.keys()) problems.push(`a line for a return without a release: ${r}`);
  for (const r of alike.keys()) problems.push(`a release made either way at a return without one: ${r}`);
  return problems;
}
