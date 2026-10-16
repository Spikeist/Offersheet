/**
 * Players' names in short (CLAUDE.md §14): shortName, "J. Jefferson", for the League page's chips and Waiver upgrades (moved
 * here from leagueView.ts, which still exports it, at Checkpoint 7f), and surname, "Jefferson", for a release's reason on a
 * trade card and the League page ("From week 7 on, he and Marvin Harrison Jr. add about the same to your starting lineup, and
 * Harrison Jr. has more trade value."; tradeView.ts releaseReason). A light module, so the Trade Finder needn't load the
 * League page's view model.
 * Pure: no I/O.
 */
import type { Pos } from "@/engine/model";

const SUFFIX = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i;
/** Words that belong to the last name ("St. Brown", "Van Noy", "De La Cruz"). */
const PARTICLE = /^(st\.?|van|von|vander|der|den|de|da|di|du|del|della|la|le)$/i;

/**
 * "Justin Jefferson" → "J. Jefferson": first initial and last name, suffixes and middle names
 * dropped ("Travis Etienne Jr." → "T. Etienne"), name particles kept ("Amon-Ra St. Brown" →
 * "A. St. Brown"). Team defenses stay as they are.
 */
export function shortName(name: string, pos?: Pos): string {
  const trimmed = name.trim();
  if (pos === "DEF") return trimmed;
  const parts = trimmed.split(/\s+/);
  while (parts.length > 2 && SUFFIX.test(parts[parts.length - 1] ?? "")) parts.pop();
  if (parts.length < 2) return trimmed;
  let start = parts.length - 1;
  while (start > 1 && PARTICLE.test(parts[start - 1] ?? "")) start--;
  return `${(parts[0] ?? "").charAt(0)}. ${parts.slice(start).join(" ")}`;
}

/**
 * "Alec Pierce" → "Pierce" (Checkpoint 7f; the planner's own "Harrison Jr." in his example): the last name with its particles
 * ("Amon-Ra St. Brown" → "St. Brown", "Kyle Van Noy" → "Van Noy") and its suffix kept, as a name is said in a sentence
 * ("Marvin Harrison Jr." → "Harrison Jr.", "Kenneth Walker III" → "Walker III"); middle names dropped. Team defenses and
 * one-word names stay as they are.
 */
export function surname(name: string, pos?: Pos): string {
  const trimmed = name.trim();
  if (pos === "DEF") return trimmed;
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return trimmed;
  let end = parts.length;
  while (end > 2 && SUFFIX.test(parts[end - 1] ?? "")) end--;
  let start = end - 1;
  while (start > 1 && PARTICLE.test(parts[start - 1] ?? "")) start--;
  return parts.slice(start).join(" ");
}
