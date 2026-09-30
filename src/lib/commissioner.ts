/**
 * The copy-ready message a user sends their ESPN league manager (CLAUDE.md §14, "How users connect
 * ESPN leagues"). ESPN leagues are private by default; only the league manager can make one viewable.
 */

export const ESPN_PUBLIC_SETTING_PATH = "League → Settings → Basic Settings → “Make League Viewable to Public”";

export function commissionerMessage(): string {
  return [
    "Hey! Could you turn on “Make League Viewable to Public” for our ESPN fantasy league?",
    "It's under League → Settings → Basic Settings.",
    "It only lets people with the league link view our league pages. Nobody can join the league or change anything.",
    "Once it's on, anyone in the league can use Offer Sheet (a free, read-only trade-idea tool) with just the league link, even on a phone. Thanks!",
  ].join(" ");
}
