import { describe, expect, it } from "vitest";
import { parseEspnLeagueInput } from "./espnLink";
import { defaultSeason, isPlausibleSeason, newestSeason, seasonFromLink, seasonRangeMessage } from "./season";

// Fictional league IDs only.
describe("parseEspnLeagueInput", () => {
  it("reads a league link with a season", () => {
    expect(parseEspnLeagueInput("https://fantasy.espn.com/football/league?leagueId=4242424&seasonId=2026")).toEqual({ ok: true, leagueId: "4242424", season: 2026 });
  });

  it("reads a team link, keeping the team ID as a hint for 'my team'", () => {
    expect(parseEspnLeagueInput("https://fantasy.espn.com/football/team?leagueId=4242424&teamId=7&seasonId=2025")).toEqual({ ok: true, leagueId: "4242424", season: 2025, teamId: "7" });
  });

  it("reads other league pages without a season", () => {
    expect(parseEspnLeagueInput("https://fantasy.espn.com/football/league/standings?leagueId=31337")).toEqual({ ok: true, leagueId: "31337" });
    expect(parseEspnLeagueInput("https://fantasy.espn.com/football/league/scoreboard?leagueId=31337&matchupPeriodId=4")).toEqual({ ok: true, leagueId: "31337" });
    expect(parseEspnLeagueInput("https://fantasy.espn.com/football/league/settings?leagueId=31337&view=settings")).toEqual({ ok: true, leagueId: "31337" });
  });

  it("accepts links without a scheme, over http, with odd casing and surrounding spaces", () => {
    expect(parseEspnLeagueInput("  fantasy.espn.com/football/league?leagueId=555  ")).toEqual({ ok: true, leagueId: "555" });
    expect(parseEspnLeagueInput("http://fantasy.espn.com/football/league?LEAGUEID=555&SeasonId=2026")).toEqual({ ok: true, leagueId: "555", season: 2026 });
    expect(parseEspnLeagueInput("https://www.espn.com/fantasy/football/league?leagueId=555")).toEqual({ ok: true, leagueId: "555" });
  });

  it("finds the query after a hash in single-page links", () => {
    expect(parseEspnLeagueInput("https://fantasy.espn.com/football/#/league?leagueId=8080")).toEqual({ ok: true, leagueId: "8080" });
  });

  it("reads an API URL", () => {
    expect(parseEspnLeagueInput("https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/909090?view=mTeam")).toEqual({
      ok: true,
      leagueId: "909090",
      season: 2026,
    });
  });

  it("accepts bare IDs, with the punctuation people paste around them", () => {
    expect(parseEspnLeagueInput("123456")).toEqual({ ok: true, leagueId: "123456" });
    expect(parseEspnLeagueInput("League ID: 123456")).toEqual({ ok: true, leagueId: "123456" });
    expect(parseEspnLeagueInput("League ID: 123456.")).toEqual({ ok: true, leagueId: "123456" });
    expect(parseEspnLeagueInput("123456.")).toEqual({ ok: true, leagueId: "123456" });
    expect(parseEspnLeagueInput("(123456)")).toEqual({ ok: true, leagueId: "123456" });
    expect(parseEspnLeagueInput("“123456”")).toEqual({ ok: true, leagueId: "123456" });
    expect(parseEspnLeagueInput("leagueId=31337")).toEqual({ ok: true, leagueId: "31337" });
  });

  it("finds the link in pasted text (share sheets, chat messages)", () => {
    expect(parseEspnLeagueInput("Join my league https://fantasy.espn.com/football/league?leagueId=123456")).toEqual({ ok: true, leagueId: "123456" });
    expect(parseEspnLeagueInput("https://fantasy.espn.com/football/league?leagueId=123456 (my league)")).toEqual({ ok: true, leagueId: "123456" });
    expect(parseEspnLeagueInput("Come join! https://fantasy.espn.com/football/team?leagueId=4242&teamId=7&seasonId=2026, it's fun")).toEqual({
      ok: true,
      leagueId: "4242",
      season: 2026,
      teamId: "7",
    });
    expect(parseEspnLeagueInput("check fantasy.espn.com/football/league?leagueId=555.")).toEqual({ ok: true, leagueId: "555" });
    expect(parseEspnLeagueInput("See fantasy.espn.com, our league id is 31337!")).toEqual({ ok: true, leagueId: "31337" });
    expect(parseEspnLeagueInput("(https://fantasy.espn.com/football/league?leagueId=8080)")).toEqual({ ok: true, leagueId: "8080" });
  });

  it("doesn't take another site's or sport's ID from pasted text", () => {
    expect(parseEspnLeagueInput("my other league https://sleeper.com/leagues/123456789012345678 lol")).toMatchObject({ ok: false, reason: "other-platform" });
    expect(parseEspnLeagueInput("hoops https://fantasy.espn.com/basketball/league?leagueId=777 this year")).toMatchObject({ ok: false, reason: "other-sport" });
    expect(parseEspnLeagueInput("https://example.org/league?leagueId=12")).toMatchObject({ ok: false, reason: "not-espn" });
    expect(parseEspnLeagueInput("see https://fantasy.espn.com/football/players/projections today")).toMatchObject({ ok: false, reason: "no-league-id" });
  });

  it("explains empty input, missing IDs and other sites without echoing the input", () => {
    const empty = parseEspnLeagueInput("   ");
    expect(empty).toMatchObject({ ok: false, reason: "empty" });

    const noId = parseEspnLeagueInput("https://fantasy.espn.com/football/players/projections");
    expect(noId).toMatchObject({ ok: false, reason: "no-league-id" });

    const sleeper = parseEspnLeagueInput("https://sleeper.com/leagues/1234567890123/team");
    expect(sleeper).toMatchObject({ ok: false, reason: "other-platform" });
    if (!sleeper.ok) expect(sleeper.message).toContain("Sleeper");

    const yahoo = parseEspnLeagueInput("https://football.fantasysports.yahoo.com/f1/12345");
    expect(yahoo).toMatchObject({ ok: false, reason: "other-platform" });

    const random = parseEspnLeagueInput("https://example.org/league?leagueId=12");
    expect(random).toMatchObject({ ok: false, reason: "not-espn" });
    if (!random.ok) expect(random.message).not.toContain("example.org");

    expect(parseEspnLeagueInput("not a link at all")).toMatchObject({ ok: false, reason: "no-league-id" });
  });

  it("rejects other ESPN sports", () => {
    expect(parseEspnLeagueInput("https://fantasy.espn.com/basketball/league?leagueId=777")).toMatchObject({ ok: false, reason: "other-sport" });
    expect(parseEspnLeagueInput("https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/2026/segments/0/leagues/777")).toMatchObject({ ok: false, reason: "other-sport" });
  });

  it("ignores a malformed season or team", () => {
    expect(parseEspnLeagueInput("https://fantasy.espn.com/football/team?leagueId=42&teamId=abc&seasonId=26")).toEqual({ ok: true, leagueId: "42" });
  });

  it("rejects IDs that are too long to be ESPN league IDs", () => {
    expect(parseEspnLeagueInput("https://fantasy.espn.com/football/league?leagueId=1234567890123")).toMatchObject({ ok: false, reason: "no-league-id" });
  });
});

describe("season helpers", () => {
  it("defaults to the season in progress", () => {
    expect(defaultSeason(new Date("2026-09-29T12:00:00Z"))).toBe(2026);
    expect(defaultSeason(new Date("2027-01-15T12:00:00Z"))).toBe(2026);
    expect(defaultSeason(new Date("2027-03-01T12:00:00Z"))).toBe(2027);
  });

  it("accepts seasons from 2018 to the calendar year (next season only once it can exist, after New Year)", () => {
    const now = new Date("2026-09-29T12:00:00Z");
    expect(newestSeason(now)).toBe(2026);
    expect(isPlausibleSeason(2026, now)).toBe(true);
    expect(isPlausibleSeason(2018, now)).toBe(true);
    expect(isPlausibleSeason(2027, now)).toBe(false);
    expect(isPlausibleSeason(2017, now)).toBe(false);
    expect(isPlausibleSeason(2026.5, now)).toBe(false);
    const offseason = new Date("2027-01-20T12:00:00Z");
    expect(defaultSeason(offseason)).toBe(2026);
    expect(isPlausibleSeason(2027, offseason)).toBe(true);
    expect(isPlausibleSeason(2028, offseason)).toBe(false);
  });

  it("names exactly the range it accepts", () => {
    expect(seasonRangeMessage(new Date("2026-09-29T12:00:00Z"))).toBe("Pick a season from 2018 to 2026.");
    expect(seasonRangeMessage(new Date("2027-01-20T12:00:00Z"))).toBe("Pick a season from 2018 to 2027.");
  });

  it("uses a link's season only when it can be imported, and otherwise says why", () => {
    const now = new Date("2026-09-29T12:00:00Z");
    expect(seasonFromLink(undefined, now)).toEqual({});
    expect(seasonFromLink(2025, now)).toEqual({ season: 2025 });
    expect(seasonFromLink(2015, now)).toEqual({ note: "Your link is for the 2015 season, but Offer Sheet covers 2018 to 2026. Pick a season below." });
    expect(seasonFromLink(2027, now).season).toBeUndefined();
  });
});
