import { describe, expect, it } from "vitest";
import type { LeagueSnapshot } from "@/engine/model";
import { resolveMyTeam } from "./myTeam";

// CLAUDE.md §14 items 2–3: one rule for "Your team" on the Import Report and the League page.
const league = (myTeamId: string | null) => ({ myTeamId, teams: [{ id: "1" }, { id: "2" }, { id: "3" }] }) as unknown as Pick<LeagueSnapshot, "myTeamId" | "teams">;

describe("resolveMyTeam (§14: the user's pick beats the platform's, which beats a link guess)", () => {
  it("uses the platform's team when nothing was picked", () => {
    expect(resolveMyTeam(league("1"))).toEqual({ myTeamId: "1", source: "platform" });
    expect(resolveMyTeam(league("1"), null)).toEqual({ myTeamId: "1", source: "platform" });
  });

  it("lets the user's own pick win, and calls the platform's team 'platform' when they agree", () => {
    expect(resolveMyTeam(league("1"), { teamId: "2", source: "you" })).toEqual({ myTeamId: "2", source: "you" });
    expect(resolveMyTeam(league("1"), { teamId: "2" })).toEqual({ myTeamId: "2", source: "you" });
    expect(resolveMyTeam(league("1"), { teamId: "1", source: "you" })).toEqual({ myTeamId: "1", source: "platform" });
  });

  it("lets the platform's team beat a team taken from a pasted link", () => {
    expect(resolveMyTeam(league("1"), { teamId: "3", source: "link" })).toEqual({ myTeamId: "1", source: "platform" });
    expect(resolveMyTeam(league(null), { teamId: "3", source: "link" })).toEqual({ myTeamId: "3", source: "link" });
  });

  it("ignores a pick or a platform team that isn't a team in this league", () => {
    expect(resolveMyTeam(league("1"), { teamId: "99" })).toEqual({ myTeamId: "1", source: "platform" });
    expect(resolveMyTeam(league("99"), { teamId: "98" })).toEqual({ myTeamId: null, source: "none" });
    expect(resolveMyTeam(league(null), { teamId: "" })).toEqual({ myTeamId: null, source: "none" });
    expect(resolveMyTeam(league(null))).toEqual({ myTeamId: null, source: "none" });
  });
});
