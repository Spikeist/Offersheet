import { describe, expect, it } from "vitest";
import { apiUrl, enumOr, fd, sportradarId } from "./api";
import { parseEasternTime, parsePlayoffLine, parseRulesPage } from "./html-rules";
import { parseDirectory, saltedOrder } from "./league-pick";

// Synthetic markup in the shape of Fleaflicker's public rules page (label line, value line(s); no
// datetime attributes on the calendar times). No real league.
const RULES_PAGE = `<html><body><h1>Invented League</h1>
<table>
<tr><td>Transaction Rules</td></tr>
<tr><td>Trade Review Period</td><td>24 Hours, no vetoes</td></tr>
<tr><td>Enforce Roster Minimums</td><td>Yes</td></tr>
<tr><td>Prevent Cuts After Game Start</td><td>Yes</td></tr>
<tr><td>Lifetime</td><td>12 Keepers Est. 2019</td></tr>
<tr><td>Membership</td><td>Public</td></tr>
<tr><td>Type</td><td>H2H Points</td></tr>
<tr><td>How Are Claims Resolved</td><td>Blind Bidding</td></tr>
<tr><td>Totals</td><td>25: 16 Starters , 9 Bench , + 3 IR</td></tr>
</table>
<h4>Tiebreakers</h4>
<dl><dt>Individual Game Tiebreakers</dt><dd><div>Highest individual starter score</div><div>Higher bench points total</div></dd>
<dt>Break Regular Season Ties</dt><dd>No</dd>
<dt>Power &amp; Playoff Rank Tiebreakers</dt><dd><div>Best head-to-head record</div><div>Most average points/game</div></dd>
<dt>Rank division winners higher</dt><dd>Yes</dd>
<dt>Retroactively apply official stat changes (recommended)</dt><dd>Yes</dd></dl>
<h4>Calendar</h4>
<dl><dt>Current Season Opened</dt><dd>Tue 2/10/26 6:00 AM</dd>
<dt>Trading Deadline</dt><dd>Tue 11/24/26 6:00 AM EST</dd>
<dt>Playoffs</dt><dd>6 <span>Teams</span>; Weeks: 15-17 <time>Tue 12/15-Mon 1/4</time> , 2 byes (re-seed each round)</dd></dl>
</body></html>`;

describe("parseRulesPage", () => {
  it("reads settings the JSON API lacks", () => {
    const r = parseRulesPage(RULES_PAGE);
    expect(r).toMatchObject({
      tradeReviewPeriod: "24 Hours, no vetoes",
      lifetime: "12 Keepers Est. 2019",
      keepers: 12,
      membership: "Public",
      type: "H2H Points",
      claimsResolved: "Blind Bidding",
      tradingDeadline: "Tue 11/24/26 6:00 AM EST",
      seasonOpened: "Tue 2/10/26 6:00 AM",
      rosterTotals: "25: 16 Starters , 9 Bench , + 3 IR",
      playoffs: { teams: 6, firstWeek: 15, lastWeek: 17, byes: 2, reseed: true },
      gameTiebreakers: ["Highest individual starter score", "Higher bench points total"],
      gameTiesBroken: false,
      rankTiebreakers: ["Best head-to-head record", "Most average points/game"],
      divisionWinnersRankedHigher: true,
      enforceRosterMinimums: true,
    });
    expect(r.playoffText).toBe("6 Teams; Weeks: 15-17, 2 byes (re-seed each round)");
  });

  it("leaves settings a page doesn't show undefined", () => {
    const r = parseRulesPage("<table><tr><td>Type</td><td>H2H Points</td></tr></table>");
    expect(r.gameTiebreakers).toBeUndefined();
    expect(r.divisionWinnersRankedHigher).toBeUndefined();
    expect(r.tradingDeadline).toBeUndefined();
  });
});

describe("parseEasternTime (page times are US Eastern, independent of the machine's zone)", () => {
  it("reads standard and daylight time, PM and 12 AM, and an explicit zone", () => {
    expect(new Date(parseEasternTime("Tue 2/10/26 6:00 AM") as number).toISOString()).toBe("2026-02-10T11:00:00.000Z");
    expect(new Date(parseEasternTime("Wed 7/1/26 12:30 PM") as number).toISOString()).toBe("2026-07-01T16:30:00.000Z");
    expect(new Date(parseEasternTime("Sun 9/13/26 10:15 PM") as number).toISOString()).toBe("2026-09-14T02:15:00.000Z");
    expect(new Date(parseEasternTime("Mon 1/4/27 12:05 AM") as number).toISOString()).toBe("2027-01-04T05:05:00.000Z");
    expect(new Date(parseEasternTime("Tue 11/24/26 6:00 AM EST") as number).toISOString()).toBe("2026-11-24T11:00:00.000Z");
    expect(parseEasternTime("not a date")).toBeNull();
  });
});

describe("candidate order", () => {
  it("is a salted permutation: stable for one salt, different across salts", () => {
    const ids = ["101", "202", "303", "404", "505", "606"];
    const a = saltedOrder(ids, "salt-one");
    expect([...a].sort()).toEqual([...ids].sort());
    expect(saltedOrder([...ids].reverse(), "salt-one")).toEqual(a);
    const others = ["salt-two", "salt-three", "salt-four"].map((s) => saltedOrder(ids, s).join(","));
    expect(others.some((o) => o !== a.join(","))).toBe(true);
  });
});

describe("parseRulesPage playoff lines", () => {

  it("parses playoff line variants", () => {
    expect(parsePlayoffLine("5 Teams; Weeks: 14-16 Tue 12/8-Mon 12/28 , 3 byes (no re-seeding)")).toEqual({ teams: 5, firstWeek: 14, lastWeek: 16, byes: 3, reseed: false });
    expect(parsePlayoffLine("4 Teams; Weeks: 16-17")).toEqual({ teams: 4, firstWeek: 16, lastWeek: 17, byes: 0, reseed: null });
    expect(parsePlayoffLine("no playoffs")).toBeNull();
  });
});

describe("parseDirectory", () => {
  it("keeps public, full leagues of 10–12 teams", () => {
    const row = (id: number, members: string, membership: string) => `<tr><td><a href="/nfl/leagues/${id}">x</a></td><td>No</td><td>8 Keepers Est. 2020</td><td>${members}</td><td>${membership}</td><td>Drafted</td></tr>`;
    const html = `<table>${row(111, "12 / 12", "Public")}${row(222, "8 / 12", "Public")}${row(333, "10 / 10", "Private")}${row(444, "14 / 14", "Public")}${row(555, "10 / 10", "Public")}</table>`;
    expect(parseDirectory(html)).toEqual(["111", "555"]);
  });
});

describe("api helpers", () => {
  it("builds URLs with sport first, repeated array params and readable placeholders", () => {
    expect(apiUrl("FetchPlayerListing", { league_id: "{leagueId}", "filter.player_id": [1, 2], external_id_type: "SPORTRADAR" })).toBe(
      "https://www.fleaflicker.com/api/FetchPlayerListing?sport=NFL&league_id={leagueId}&filter.player_id=1&filter.player_id=2&external_id_type=SPORTRADAR",
    );
  });

  it("reads proto3 defaults", () => {
    expect(fd(undefined)).toBe(0);
    expect(fd({ formatted: "0" })).toBe(0);
    expect(fd({ value: 12.5, formatted: "12.5" })).toBe(12.5);
    expect(enumOr(undefined, "RosterPositionGroup")).toBe("BENCH");
    expect(enumOr(undefined, "TransactionType")).toBe("TRANSACTION_ADD");
    expect(sportradarId({ id: 1, externalIds: [{ id: "ABCDEF01-0000-0000-0000-000000000000" }] })).toBe("abcdef01-0000-0000-0000-000000000000");
  });
});
