/**
 * How a trade card prints its numbers (pure, client-safe; CLAUDE.md §10's three numbers, §11's "Est."): the chance they accept
 * rounded as §11 shows it ("<5%" under 5%, planner reply to Checkpoint 4b, answer 5), the chance it goes through when the
 * league's review could veto it, and a 0–100 score. Shared by the cards' view (src/lib/tradeView.ts, which re-exports them,
 * moved here at Checkpoint 7d) and the feedback export (src/lib/feedbackStore.ts: planner reply to Checkpoint 7c, answer 1),
 * which prints a record's own numbers the way its card did. Imports only the engine's display rule and config, so the feedback
 * store needs none of the view.
 */
import { displayAcceptance } from "@/engine/acceptance";
import { config } from "@/engine/config";

/** Under the display's step (config.acceptance.displayStep, 5%): an estimate the card prints as "<5%" (planner reply to Checkpoint 4b, answer 5). */
export function underStep(p: number): boolean {
  return Number.isFinite(p) && p < config.acceptance.displayStep - 1e-9;
}

/**
 * An acceptance estimate as shown (§11: the nearest 5%), "<5%" for a model value under 5%: never rounded up to the step
 * (planner reply to Checkpoint 4b, answer 5). acceptance.displayAcceptance's number, which the minimum-chance filter and
 * the label read, is unchanged: only the words are.
 */
export function acceptText(p: number): string {
  if (underStep(p)) return `<${Math.round(config.acceptance.displayStep * 100)}%`;
  return `${Math.round(displayAcceptance(p) * 100)}%`;
}

/** The same for screen readers: "under 5%" for "<5%", else the printed percent. */
export function acceptSrText(p: number): string {
  return underStep(p) ? `under ${Math.round(config.acceptance.displayStep * 100)}%` : acceptText(p);
}

/**
 * The chance a version goes through when the league's review could veto it, next to the chance they accept (tradeView.ts's
 * header): "about 20%" when it prints differently, "under 5%" when it prints "<5%" and the chance they accept doesn't;
 * null when both print the same (the reason that the league reviews trades says the rest).
 */
export function throughText(pAccept: number, pComplete: number): string | null {
  if (!Number.isFinite(pComplete) || acceptText(pComplete) === acceptText(pAccept)) return null;
  return underStep(pComplete) ? acceptSrText(pComplete) : `about ${acceptText(pComplete)}`;
}

/** A 0–100 score (Helps you, Overall) as printed: its number; "0" for a trade that doesn't help me (B ≤ 0); "—" when B is unknown. */
export function printedScore(score: number | null, b: number | null): string {
  if (score !== null && Number.isFinite(score)) return String(score);
  if (b !== null && Number.isFinite(b) && b <= 0) return "0";
  return "—";
}
