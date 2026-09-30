import { describe, expect, it } from "vitest";
import { errorMessage } from "./errors";
import { SLEEPER_LEAGUE_ID_HINT, normalizeSleeperUsername, parseSleeperLeagueInput, sleeperLeagueLinkId, sleeperServerError } from "./sleeperInput";

// Fictional IDs and usernames.
describe("parseSleeperLeagueInput", () => {
  it("accepts a league ID or a sleeper.com league link", () => {
    expect(parseSleeperLeagueInput(" 123456789012345678 ")).toEqual({ ok: true, leagueId: "123456789012345678" });
    expect(parseSleeperLeagueInput("https://sleeper.com/leagues/123456789012345678/team")).toEqual({ ok: true, leagueId: "123456789012345678" });
    expect(parseSleeperLeagueInput("sleeper.app/league/123456789012345678")).toEqual({ ok: true, leagueId: "123456789012345678" });
  });

  it("ignores punctuation pasted around an ID or link", () => {
    expect(parseSleeperLeagueInput("123456789012345678.")).toEqual({ ok: true, leagueId: "123456789012345678" });
    expect(parseSleeperLeagueInput("(https://sleeper.com/leagues/123456789012345678)")).toEqual({ ok: true, leagueId: "123456789012345678" });
    expect(parseSleeperLeagueInput("Join us: https://sleeper.com/leagues/123456789012345678!")).toEqual({ ok: true, leagueId: "123456789012345678" });
  });

  it("explains anything else", () => {
    expect(parseSleeperLeagueInput("")).toMatchObject({ ok: false });
    expect(parseSleeperLeagueInput("1234")).toMatchObject({ ok: false });
    expect(parseSleeperLeagueInput("https://fantasy.espn.com/football/league?leagueId=123456")).toMatchObject({ ok: false });
  });
});

describe("sleeperLeagueLinkId", () => {
  it("spots a league link typed where a username goes", () => {
    expect(sleeperLeagueLinkId("https://sleeper.com/leagues/123456789012345678/team")).toBe("123456789012345678");
    expect(sleeperLeagueLinkId(" sleeper.com/leagues/123456789012345678 ")).toBe("123456789012345678");
  });

  it("leaves usernames and bare numbers alone (Sleeper also takes numeric user IDs)", () => {
    expect(sleeperLeagueLinkId("zorblax_q")).toBeUndefined();
    expect(sleeperLeagueLinkId("123456789012345678")).toBeUndefined();
    expect(sleeperLeagueLinkId("https://sleeper.com/settings")).toBeUndefined();
  });
});

describe("sleeperServerError", () => {
  it("points a username that isn't found at the League ID option, and at the username field", () => {
    const notFound = { code: "USER_NOT_FOUND", message: errorMessage("USER_NOT_FOUND", { platform: "sleeper" }) };
    const inUsernameMode = sleeperServerError(notFound, "username");
    expect(inUsernameMode.field).toBe("username");
    expect(inUsernameMode.message).toMatch(/^We couldn't find that Sleeper username\./);
    expect(inUsernameMode.message.endsWith(SLEEPER_LEAGUE_ID_HINT)).toBe(true);
    // Already on League ID: the (optional) username can just be left out.
    expect(sleeperServerError(notFound, "league")).toEqual({ message: expect.stringMatching(/leave it blank/), field: "username" });
  });

  it("ties a missing league to the league field, and passes other errors through", () => {
    expect(sleeperServerError({ code: "LEAGUE_NOT_FOUND", message: "League not found for that season." }, "league")).toEqual({ message: "League not found for that season.", field: "league" });
    expect(sleeperServerError({ code: "SOURCE_DOWN", message: "Sleeper isn't responding right now." }, "username")).toEqual({ message: "Sleeper isn't responding right now." });
  });
});

describe("normalizeSleeperUsername", () => {
  it("trims and drops a leading @", () => {
    expect(normalizeSleeperUsername("  @zorblax_q ")).toBe("zorblax_q");
    expect(normalizeSleeperUsername("Zorblax.Q-99")).toBe("Zorblax.Q-99");
  });

  it("rejects spaces, slashes and empty input", () => {
    expect(normalizeSleeperUsername("two words")).toBeUndefined();
    expect(normalizeSleeperUsername("a/b")).toBeUndefined();
    expect(normalizeSleeperUsername("   ")).toBeUndefined();
    expect(normalizeSleeperUsername("x".repeat(51))).toBeUndefined();
  });
});
