/**
 * "Your team" (CLAUDE.md §14 items 2 and 3): which team in the imported league is the user's. The
 * Import Report and the League page both resolve it here, so the two pages always agree. Pure.
 */
import type { LeagueSnapshot } from "@/engine/model";
import type { MyTeamPick, MyTeamPickSource } from "./importStore";

/**
 * Where "my team" came from: the platform (ESPN cookies, a Sleeper username), the user's own pick,
 * the teamId of a pasted ESPN team link (a guess to confirm: ESPN uses such links for every team),
 * or nowhere yet.
 */
export type MyTeamSource = "platform" | MyTeamPickSource | "none";

export interface ResolvedMyTeam {
  myTeamId: string | null;
  source: MyTeamSource;
}

/** The stored pick, as parseMyTeamPick returns it, or the pieces of one (source defaults to "you"). */
export type MyTeamPickInput = Partial<Pick<MyTeamPick, "source">> & { teamId?: string | null };

/**
 * The user's own pick beats the platform's (a cookie SWID or Sleeper username match); the
 * platform's beats a team taken from a pasted link, which is only a guess to confirm. A pick or a
 * platform team that isn't a team in this league is ignored.
 */
export function resolveMyTeam(snapshot: Pick<LeagueSnapshot, "myTeamId" | "teams">, pick?: MyTeamPickInput | null): ResolvedMyTeam {
  const isTeam = (id: string | null | undefined): id is string => !!id && snapshot.teams.some((t) => t.id === id);
  const pickedId = pick?.teamId;
  const picked = isTeam(pickedId) ? pickedId : null;
  const pickSource: MyTeamPickSource = pick?.source ?? "you";
  const fromPlatform = isTeam(snapshot.myTeamId) ? snapshot.myTeamId : null;
  if (picked && pickSource === "you" && picked !== fromPlatform) return { myTeamId: picked, source: "you" };
  if (fromPlatform) return { myTeamId: fromPlatform, source: "platform" };
  if (picked) return { myTeamId: picked, source: pickSource };
  return { myTeamId: null, source: "none" };
}
