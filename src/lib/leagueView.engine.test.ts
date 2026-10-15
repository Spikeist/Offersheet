/**
 * The League page's standings, odds and remaining schedule on a REAL engine build (CLAUDE.md §8, §14 item
 * 3, §17 Checkpoint 3): where the Phase 3 pieces meet. The adapters' snapshot (Parker's committed
 * sanitized ESPN fixture; the Sleeper test league), the engine's LeagueModel.odds and TeamModel.score
 * (season.ts, league.ts) and the page's view model and markup (leagueView.ts, LeagueView). leagueView.test.ts
 * pins every word on a hand-built model; these check that what the engine actually fills reads sensibly on
 * the page: ranks 1..N in the platform's own order, printed odds within half a point of the engine's and
 * adding up (Σ playoff % ≈ playoff teams × 100, Σ title % ≈ 100), projected final records over the whole
 * season, the schedule's points equal to the simulator's means and its opponents to the snapshot's
 * schedule, Parker's week 13 bye crunch flagged, the engine's notes, and a week under way played from
 * pre-game projections. Phase 4c (planner reply to Checkpoint 4b, change 9, "one baseline everywhere"): the page's
 * odds and the schedule's points are the ones with every team's free-agent pickups (LeagueModel.odds,
 * TeamModel.scoreWithPickups), my odds as rosters stand the smaller second line (LeagueModel.oddsAsRostersStand), and
 * the likely starters' roster after the pickups (rosterAfterPickups) is the engine's own V*(T). Synthetic projections
 * (engine/testLeague.ts) with the real 2026 NFL schedule (byes and kickoffs from the committed ESPN fixture). Team names
 * are placeholders; public NFL player names only.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { normalizeEspnLeague } from "@/adapters/espn/normalize";
import { LABELS, NOW, PARKER, fakeResolver, parkerBundle, readEspn } from "@/adapters/espn/test-helpers";
import { normalizeSleeperLeague } from "@/adapters/sleeper/normalize";
import { fakeResolver as sleeperResolver, loadTestLeague, rawOf } from "@/adapters/sleeper/test-helpers";
import { LeagueView } from "@/components/league/LeagueView";
import { nflScheduleSchema, reduceNflSchedule, toNflScheduleInputs } from "@/data/nflSchedule";
import { config } from "@/engine/config";
import { buildTradeContext, tradeInternals } from "@/engine/evaluate";
import type { ModelInputs } from "@/engine/inputs";
import { buildLeagueModel, buildLeagueModelWithContext } from "@/engine/league";
import type { LeagueModel, SeasonOdds, TeamModel } from "@/engine/leagueModel";
import type { LeagueSnapshot } from "@/engine/model";
import { weekUnderWayNote } from "@/engine/season";
import { evStarter, isStreamId } from "@/engine/teamValue";
import { syntheticInputs } from "@/engine/testLeague";
import { fmtNum, fmtWhole, recordText } from "./format";
import { RISKY_BYES, RISKY_WIN_CHANCE, UNDER_WAY_TEXT, buildLeagueView, likelyStarters, oddsCell, pickupsUnderWayNote, rosterAfterPickups, type OddsCell } from "./leagueView";
import { titleOddsText } from "./tradeView";

const TZ = "America/Chicago";
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** A printed probability as a percent: "<1%" → 0 and ">99%" → 100, so every printed cell is within half a point of the engine's number. */
function printed(cell: OddsCell | null | undefined): number {
  const text = cell?.text ?? "";
  if (text === "<1%") return 0;
  if (text === ">99%") return 100;
  const m = /^(\d+)%$/.exec(text);
  if (!m) throw new Error(`not a printed probability: "${text}"`);
  return Number(m[1]);
}

/** A printed title chance (one decimal, titleCell) as a percent: "<0.1%" → 0 and ">99.9%" → 100, so it is within 0.05 points of the engine's. */
function printedTitle(cell: OddsCell | null | undefined): number {
  const text = cell?.text ?? "";
  if (text === "<0.1%") return 0;
  if (text === ">99.9%") return 100;
  const m = /^(\d+\.\d)%$/.exec(text);
  if (!m) throw new Error(`not a printed title chance: "${text}"`);
  return Number(m[1]);
}

/**
 * The fallback playoff-week weight (league.ts step 5c not measured: config.lineups.playoffWeight, the weight before the
 * planner's reply to Checkpoint 7a, §6.1): this file's narratives (Parker's week-13 bye crunch on these synthetic inputs) were
 * measured with it. The page-and-engine invariants run with the app's own configuration too (ω measured; review of the
 * engine track, Phase 7b: pinned alone, they hid a likely starter the page and the cards disagreed on).
 */
const FIXED_OMEGA = { playoffWeightSims: 0 } as const;

function pipeline(snapshot: LeagueSnapshot, inputs: ModelInputs, now: Date) {
  const model = buildLeagueModel(snapshot, inputs, { now, ...FIXED_OMEGA });
  const view = buildLeagueView({ snapshot, model, inputs, myTeamSource: "platform", timeZone: TZ, now: now.toISOString() });
  return { model, odds: model.odds as SeasonOdds, view, html: renderToStaticMarkup(createElement(LeagueView, { view })) };
}

const teamOf = (model: LeagueModel, id: string) => model.teams.find((t) => t.id === id) as TeamModel;

describe("Parker's league (committed ESPN fixture, synthetic inputs, the real 2026 NFL schedule): odds and schedule on the page", () => {
  const resolver = fakeResolver();
  const { snapshot } = normalizeEspnLeague(parkerBundle(), { leagueId: PARKER.leagueId, resolver, now: NOW, swid: PARKER.swid });
  const nfl = toNflScheduleInputs(reduceNflSchedule(nflScheduleSchema.parse(readEspn(LABELS.proSchedule)), (abbrev) => resolver.defenseId(abbrev) ?? abbrev), snapshot.currentWeek);
  const inputs: ModelInputs = { ...syntheticInputs(snapshot), nfl };
  /** NOW is Tuesday of week 4, before its first kickoff. */
  const before = pipeline(snapshot, inputs, NOW);
  const firstKickoff = Math.min(...Object.values(nfl.kickoffs[PARKER.currentWeek] ?? {}).map((iso) => Date.parse(iso)));
  /** An hour after week 4's first kickoff (Thursday night): week 4 is under way. */
  const gameDay = pipeline(snapshot, inputs, new Date(firstKickoff + 60 * 60 * 1000));
  const me = PARKER.myTeamId;
  const standings = before.view.standings as NonNullable<typeof before.view.standings>;
  const schedule = before.view.schedule as NonNullable<typeof before.view.schedule>;
  const oddsOf = (id: string) => before.odds.teams.find((t) => t.teamId === id);

  it("lists every team once, ranked 1..N in ESPN's own standings order (its playoffSeed: win percentage, then points for), mine marked", () => {
    const raw = readEspn<{ teams: { id: number; playoffSeed: number }[] }>(LABELS.league);
    const espnOrder = [...raw.teams].sort((a, b) => a.playoffSeed - b.playoffSeed).map((t) => String(t.id));
    expect(standings.empty).toBeNull();
    expect(standings.rows.map((r) => r.teamId)).toEqual(espnOrder);
    expect(standings.rows.map((r) => r.rank)).toEqual(range(1, espnOrder.length));
    expect(standings.rows.filter((r) => r.isMine).map((r) => r.teamId)).toEqual([me]);
    expect(standings.rows.some((r) => r.eliminated)).toBe(false);
    expect(before.view.eliminated).toBeNull();
  });

  it("prints each team's odds within half a point of the engine's (title odds, with one decimal, within 0.05), so the columns add up: Σ playoffs ≈ 600%, Σ byes ≈ 200%, Σ titles ≈ 100%", () => {
    // Parker's league: 6 playoff teams, the top 2 seeds get byes.
    const playoffTeams = 6;
    const byes = 2;
    expect(snapshot.settings).toMatchObject({ playoffTeams, playoffByes: byes });
    // The League model plays the shown block's seasons (Checkpoint 7e, planner reply to Checkpoint 7d, item 1.1).
    expect(before.odds).toMatchObject({ sims: config.simulation.shownSims, playoffTeams, byes, playoffsKnown: true });
    expect(standings).toMatchObject({ showPlayoffs: true, showBye: true });
    // The engine's own sums are exact (every season seats 6 teams, 2 byes, 1 champion).
    expect(sum(before.odds.teams.map((t) => t.pPlayoffs))).toBeCloseTo(playoffTeams, 9);
    expect(sum(before.odds.teams.map((t) => t.pBye ?? Number.NaN))).toBeCloseTo(byes, 9);
    expect(sum(before.odds.teams.map((t) => t.pTitle ?? Number.NaN))).toBeCloseTo(1, 9);
    const n = standings.rows.length;
    for (const r of standings.rows) {
      const o = oddsOf(r.teamId);
      expect(Math.abs(printed(r.playoffs) - 100 * (o?.pPlayoffs ?? Number.NaN)), r.teamId).toBeLessThanOrEqual(0.5);
      expect(Math.abs(printed(r.bye) - 100 * (o?.pBye ?? Number.NaN)), r.teamId).toBeLessThanOrEqual(0.5);
      expect(Math.abs(printedTitle(r.title) - 100 * (o?.pTitle ?? Number.NaN)), r.teamId).toBeLessThanOrEqual(0.05 + 1e-9);
    }
    expect(Math.abs(sum(standings.rows.map((r) => printed(r.playoffs))) - 100 * playoffTeams)).toBeLessThanOrEqual(0.5 * n);
    expect(Math.abs(sum(standings.rows.map((r) => printed(r.bye))) - 100 * byes)).toBeLessThanOrEqual(0.5 * n);
    expect(Math.abs(sum(standings.rows.map((r) => printedTitle(r.title))) - 100)).toBeLessThanOrEqual(0.05 * n + 1e-9);
    // My row's title prints what the headline prints (review of track UIP: "9.9%" over "10%").
    expect(standings.mine?.headline.at(-1)?.text).toBe(`${standings.rows.find((r) => r.isMine)?.title.text} title`);
  });

  it("shows today's record and the projected final record over the whole regular season (wins first, one decimal)", () => {
    const seasonGames = snapshot.settings.regularSeasonWeeks.length;
    for (const r of standings.rows) {
      const team = snapshot.teams.find((t) => t.id === r.teamId);
      const o = oddsOf(r.teamId);
      expect(r.record).toBe(recordText(team?.record ?? { w: 0, l: 0, t: 0 }));
      expect((o?.expWins ?? 0) + (o?.expLosses ?? 0) + (o?.expTies ?? 0), r.teamId).toBeCloseTo(seasonGames, 9);
      expect(r.finalRecord).toBe(`${o?.expWins.toFixed(1)}–${o?.expLosses.toFixed(1)}`);
    }
  });

  it("lists the engine's notes under the standings: seasons simulated and the league's own rules (nothing assumed)", () => {
    expect(standings.notes).toEqual([
      `Odds from ${fmtWhole(config.simulation.shownSims)} simulated seasons.`,
      "Ties in the standings go to points for, the league's rule.",
      "The playoff bracket is fixed: no re-seeding after each round.",
      "The top 2 seeds get a first-round bye.",
    ]);
    const explain = before.view.explain.find((e) => e.title === "Playoff odds")?.text ?? "";
    expect(explain).toContain(`We play out the rest of the season ${fmtWhole(config.simulation.shownSims)} times.`);
    expect(explain).toContain("We play out the rest of the season 20,000 times.");
    expect(explain).toContain("win percentage, then points for.");
    expect(explain).not.toContain("assumed");
  });

  it("lists my remaining games week by week against the snapshot's schedule, with the means the headline odds draw around (scores with pickups) as projected points and their win chances", () => {
    expect(schedule.empty).toBeNull();
    expect(schedule.rows.map((r) => r.week)).toEqual(range(PARKER.currentWeek, Math.max(...snapshot.settings.regularSeasonWeeks)));
    const mine = teamOf(before.model, me);
    const withPickups = (t: TeamModel) => t.scoreWithPickups as NonNullable<TeamModel["scoreWithPickups"]>;
    for (const r of schedule.rows) {
      const m = snapshot.schedule.find((x) => !x.isPlayoff && x.week === r.week && (x.teamA === me || x.teamB === me));
      expect(r.opponentId, `week ${r.week}`).toBe(m?.teamA === me ? m?.teamB : m?.teamA);
      const k = before.model.weeks.indexOf(r.week);
      expect(r.mine).toBe(fmtNum(withPickups(mine).mean[k] as number, 1));
      expect(r.theirs).toBe(fmtNum(withPickups(teamOf(before.model, r.opponentId as string)).mean[k] as number, 1));
      const games = before.odds.weekly.find((w) => w.week === r.week)?.games ?? [];
      const my = games.find((g) => g.teamId === me);
      const their = games.find((g) => g.teamId === r.opponentId);
      expect(my?.opponentId).toBe(r.opponentId);
      expect(their?.opponentId).toBe(me);
      // Exact ties are possible, so the two chances add to at most 1 (all but never below it).
      expect((my?.pWin ?? 0) + (their?.pWin ?? 0)).toBeLessThanOrEqual(1 + 1e-12);
      expect(Math.abs(printed(r.win) - 100 * (my?.pWin ?? Number.NaN))).toBeLessThanOrEqual(0.5);
      expect(r.median).toBeNull();
      expect(r.underWay).toBeNull();
      // A week is flagged only for the reasons it gives.
      if (r.risk?.reasons.includes("to win")) expect(printed(r.win)).toBeLessThan(100 * RISKY_WIN_CHANCE);
      if (r.risk?.reasons.includes("on bye")) expect(r.byes?.count ?? 0).toBeGreaterThanOrEqual(RISKY_BYES);
    }
  });

  it("flags Parker's week 13 bye crunch in words, on the page too", () => {
    const wk13 = schedule.rows.find((r) => r.week === 13);
    expect(wk13?.byes?.count ?? 0).toBeGreaterThanOrEqual(RISKY_BYES);
    expect(wk13?.risk?.reasons).toContain(`${wk13?.byes?.count} starters on bye`);
    expect(wk13?.risk?.text).toMatch(/^Risky week: \d+ of your likely starters are on bye/);
    expect(before.html).toContain(`On bye: ${wk13?.byes?.text}`);
    expect(before.html).toContain("Risky week");
  });

  it("renders every number: no NaN, undefined or Infinity anywhere on the page", () => {
    for (const html of [before.html, gameDay.html]) {
      expect(html).not.toMatch(/NaN|undefined|Infinity/);
      expect(html).toContain("Playoff odds");
      expect(html).toContain("Your remaining games");
      expect(html).toContain('aria-label="How the odds were made"');
    }
  });

  it("plays a week under way from pre-game projections: its lineups count only the games left, the odds as rosters stand are the ones from before kickoff, and the page says so", () => {
    expect(gameDay.model.inProgressWeek).toBe(PARKER.currentWeek);
    // Thursday's teams have kicked off, so some lineup is a partial week; the simulator's week 4 isn't.
    const partial = gameDay.model.teams.filter((t) => (t.scen?.lv[0] ?? 0) < (teamOf(before.model, t.id).scen?.lv[0] ?? 0) - 1e-9);
    expect(partial.length).toBeGreaterThan(0);
    for (const t of gameDay.model.teams) expect(t.score).toEqual(teamOf(before.model, t.id).score);
    // Phase 3's identity holds for the odds as rosters stand (Phase 4c: the headline, with pickups, can move at the first
    // kickoff, since each team's pickups count from the next week on; league.ts "Game days").
    const stands = (p: typeof before) => p.model.oddsAsRostersStand as SeasonOdds;
    expect(stands(gameDay).teams).toEqual(stands(before).teams);
    expect(stands(gameDay).weekly).toEqual(stands(before).weekly);
    // On game day the week under way keeps each team's score as it stands: the engine plays it with today's rosters.
    for (const t of gameDay.model.teams) {
      expect(t.scoreWithPickups?.mean[0], `team ${t.id}`).toBe(t.score.mean[0]);
      expect(t.scoreWithPickups?.sd[0], `team ${t.id}`).toBe(t.score.sd[0]);
    }
    expect(gameDay.view.standings?.notes).toContain(weekUnderWayNote(PARKER.currentWeek));
    // …and the odds' notes say the pickups count from the next week, right after the engine's note.
    const notes = gameDay.view.standings?.notes ?? [];
    expect(notes.indexOf(pickupsUnderWayNote(PARKER.currentWeek, PARKER.currentWeek + 1))).toBe(notes.indexOf(weekUnderWayNote(PARKER.currentWeek)) + 1);
    expect(before.view.standings?.notes.some((n) => n.includes("free-agent pickups"))).toBe(false);
    const rows = gameDay.view.schedule?.rows ?? [];
    // Week 4's points are its score as it stands on game day (before kickoff they count the pickups too).
    const k = gameDay.model.weeks.indexOf(PARKER.currentWeek);
    expect(rows[0]).toMatchObject({ week: PARKER.currentWeek, underWay: UNDER_WAY_TEXT, mine: fmtNum(teamOf(gameDay.model, me).score.mean[k] as number, 1) });
    expect(rows[0]?.win).toEqual(oddsCell(gameDay.odds.weekly.find((w) => w.week === PARKER.currentWeek)?.games.find((g) => g.teamId === me)?.pWin ?? null));
    expect(rows.slice(1).every((r) => r.underWay === null)).toBe(true);
    // The note under the schedule says so too, as what the model does (review of track UIP: never "a pickup can't play").
    expect(gameDay.view.schedule?.note).toContain(`free-agent pickups that would help from week ${PARKER.currentWeek + 1} on, as the odds above do: week ${PARKER.currentWeek} is played with today's rosters.`);
    expect(before.view.schedule?.note).toContain("free-agent pickups that would help, as the odds above do.");
    expect(gameDay.html).not.toMatch(/can(&#x27;|')t play/);
  });

  it("leads the odds card with my odds with every team's pickups (the trade search's baseline), and the same as rosters stand under them", () => {
    const head = before.odds.teams.find((t) => t.teamId === me);
    const stand = (before.model.oddsAsRostersStand as SeasonOdds).teams.find((t) => t.teamId === me);
    // As every trade idea prints my odds before it: playoffs in whole percents, the title with one decimal (tradeView.ts).
    expect(standings.mine?.text).toBe(`Your odds: ${oddsCell(head?.pPlayoffs ?? null).text} playoffs · ${titleOddsText(head?.pTitle ?? Number.NaN)} title`);
    expect(standings.mine?.asRostersStandText).toBe(`As rosters stand: ${oddsCell(stand?.pPlayoffs ?? null).text} playoffs · ${titleOddsText(stand?.pTitle ?? Number.NaN)} title`);
    // Both odds add up (each simulates every team's season: 6 playoff spots, 1 champion).
    const sums = (o: SeasonOdds) => [sum(o.teams.map((t) => t.pPlayoffs)), sum(o.teams.map((t) => t.pTitle ?? Number.NaN))];
    expect(sums(before.model.oddsAsRostersStand as SeasonOdds)[0]).toBeCloseTo(6, 9);
    expect(sums(before.model.oddsAsRostersStand as SeasonOdds)[1]).toBeCloseTo(1, 9);
    // Rendered as the view words it, each part kept whole and the dot kept with the part before it (StandingsOdds.tsx: the
    // line wraps between parts only; final review of Checkpoint 7c, ui-UI-7C-2).
    const part = (p: { text: string; srText: string | null }) =>
      `<span class="whitespace-nowrap">${p.srText ? `<span aria-hidden="true">${p.text.replace(/</g, "&lt;")}</span><span class="sr-only">${p.srText}</span>` : p.text.replace(/</g, "&lt;")}</span>`;
    expect(before.html).toContain(`<p class="text-base font-extrabold tabular-nums">Your odds: ${(standings.mine?.headline ?? []).map(part).join(" · ")}</p>`);
  });

  it("counts likely starters on the roster after the free-agent pickups: rosterAfterPickups gives the engine's own V*(T) for every team", () => {
    const build = buildLeagueModelWithContext(snapshot, inputs, { now: NOW });
    for (const w of build.context.work) {
      const team = build.model.teams.find((t) => t.id === w.team.id) as TeamModel;
      expect(rosterAfterPickups(w.team.roster, team.faMoves), `team ${w.team.id}`).toEqual([...w.vstar.roster]);
    }
    // Some team makes pickups here, so the check isn't empty.
    expect(build.model.teams.some((t) => t.faMoves.length > 0)).toBe(true);
  });

  it("flags the weeks the trade cards call risky (evaluate.ts riskyWeeksOf), from the same likely starters, for every team as mine, with ω measured as in the app and with the fallback weight", () => {
    // Review of track UIP: the page picked one lineup by points per game left, which flagged weeks no card's "Covers your
    // risky week" mentioned (a streamed D/ST counted as a starter on bye). Now both read the same starters: V*(T)'s lineup
    // each counted week, streaming rows and IR returners in, at least half the weeks he plays; and (Phase 4c lead decision)
    // neither counts one at a position the team streams on bye (the streaming replacement covers it: on this fixture the
    // check fails when only one side applies that rule). Review of the engine track (Phase 7b): a player the engine releases
    // at a returner's return (league.ts step 5b) is off the page's roster from that week too (TeamModel.displacedWithPickups),
    // so the starters agree in full: with ω measured, team 10 here had two likely starters on the cards' side only (the tight
    // end released in week 5, a starter in the one counted week before it, and the tight end his release lets start), while
    // ω pinned to the fallback hid it.
    let flagged = 0;
    let released = 0;
    for (const opts of [{}, FIXED_OMEGA]) {
      for (const t of snapshot.teams) {
        const mine: LeagueSnapshot = { ...snapshot, myTeamId: t.id };
        const model = buildLeagueModel(mine, inputs, { now: NOW, ...opts });
        const view = buildLeagueView({ snapshot: mine, model, inputs, myTeamSource: "platform", timeZone: TZ, now: NOW.toISOString() });
        const I = tradeInternals(buildTradeContext(mine, inputs, { now: NOW, ...opts }));
        const label = `team ${t.id}, ω ${model.playoffWeight}`;
        const page = (view.schedule?.rows ?? []).filter((r) => r.risk !== null && r.week !== model.inProgressWeek).map((r) => r.week);
        expect(page, label).toEqual([...I.riskyWeeks]);
        flagged += page.length;
        const base = I.me?.base;
        if (!base) throw new Error(`no trade baseline for ${label}`);
        // The model says who the engine releases, and from when: the trade baseline's own displacements (V*(T)'s lineups).
        expect(teamOf(model, t.id).displacedWithPickups, label).toEqual(base.displaced.map((d) => ({ id: d.id, week: model.weeks[d.from], returner: d.returner })));
        released += base.displaced.length;
        // The starters themselves, in full: the engine's (V*(T)'s final lineups, a released player masked from his week).
        const engine = base.ev.team.rows.flatMap((r, k) => (!isStreamId(r.id) && evStarter(base.ev, k, I.weights) ? [r.id] : []));
        expect(likelyStarters(mine, model, t.id, { afterPickups: true }).sort(), label).toEqual(engine.sort());
      }
    }
    // Parker's week 13 crunch at least, and some release, so the checks aren't empty.
    expect(flagged).toBeGreaterThan(0);
    expect(released).toBeGreaterThan(0);
  }, 180_000);

  it("shows 'Streaming picks this week' from the engine: Parker streams K and D/ST (the default), the best free agents by this week's points, none whose game has started", () => {
    expect(before.model.streaming.byTeam[me]).toMatchObject({ positions: ["K", "DEF"], source: "setting" });
    const s = before.view.streaming as NonNullable<typeof before.view.streaming>;
    expect(s.mine).toBe("You stream K and D/ST.");
    expect(s.groups.map((g) => g.label)).toEqual(["K", "D/ST"]);
    const free = new Set(snapshot.freeAgents);
    for (const g of s.groups) {
      expect(g.picks).toHaveLength(config.streaming.picksShown);
      const points = g.picks.map((p) => Number(p.projection));
      expect([...points].sort((a, b) => b - a)).toEqual(points);
      for (const p of g.picks) {
        expect(free.has(p.id), p.id).toBe(true);
        expect(p.name).toBe(snapshot.players[p.id]?.name);
        expect(p.opponent).toMatch(/^(—|vs [A-Z]{2,3}|@ [A-Z]{2,3})$/);
      }
    }
    expect(before.html).toContain("Streaming picks this week");
    // An hour after Thursday's kickoff, a free agent whose game has started is no pick this week.
    const started = new Set(Object.entries(nfl.kickoffs[PARKER.currentWeek] ?? {}).filter(([, iso]) => Date.parse(iso) <= firstKickoff).map(([team]) => team));
    expect(started.size).toBeGreaterThan(0);
    const picks = gameDay.model.streaming.picks;
    expect(picks.length).toBeGreaterThan(0);
    for (const p of picks) expect(started.has(snapshot.players[p.playerId]?.nflTeam ?? ""), p.playerId).toBe(false);
    // Lineup points are labeled with the model's playoff weight.
    expect(before.model.playoffWeight).toBe(config.lineups.playoffWeight);
  });

  it("says when a multi-week matchup is already under way: the row covers only its weeks still to play, since the simulator doesn't read the points scored", () => {
    // My week 4 game made an ESPN two-week matchup period over weeks 3–4 (week 3 played), both teams' own week 3 games gone.
    const wk4 = snapshot.schedule.find((m) => !m.isPlayoff && m.week === 4 && (m.teamA === me || m.teamB === me));
    const opp = wk4?.teamA === me ? wk4.teamB : wk4?.teamA;
    const edited = snapshot.schedule
      .filter((m) => !(m.week === 3 && !m.isPlayoff && [m.teamA, m.teamB].some((id) => id === me || id === opp)))
      .map((m) => (m === wk4 ? { ...m, week: 3, weeks: [3, 4] } : m));
    const spanning = pipeline({ ...snapshot, schedule: edited }, inputs, NOW);
    expect(spanning.view.standings?.notes).toContain("The matchups of weeks 3–4 are under way: only their weeks still to play are simulated (the points already scored aren't read).");
    const row = spanning.view.schedule?.rows[0];
    expect(row).toMatchObject({ week: 4, weekText: "3–4", weekLabel: "Weeks 3–4", opponentId: opp, underWay: "Week 3 already played: its points aren't counted, so these numbers cover week 4 only" });
    // Week 4's numbers alone: the headline odds' means for week 4 (the scores with pickups), as in the unedited league.
    const k = spanning.model.weeks.indexOf(4);
    expect(row?.mine).toBe(fmtNum(teamOf(spanning.model, me).scoreWithPickups?.mean[k] as number, 1));
    expect(row?.mine).toBe(schedule.rows[0]?.mine);
    expect(spanning.view.schedule?.rows.slice(1).every((r) => r.underWay === null)).toBe(true);
  });
});

describe("The Sleeper test league (minimized fixture, synthetic inputs): Sleeper's documented seeding rules on the page", () => {
  const t = loadTestLeague();
  const now = new Date("2026-09-30T12:00:00.000Z");
  const { snapshot } = normalizeSleeperLeague(rawOf(t), { now, resolver: sleeperResolver(t.players), userId: t.meta.me.userId });
  const { odds, view } = pipeline(snapshot, syntheticInputs(snapshot), now);

  it("ranks every team 1..N, the columns add up, and the points-for tiebreaker and re-seeding read as the league's rules, not assumptions", () => {
    expect(snapshot.myTeamId).not.toBeNull();
    expect(snapshot.settings).toMatchObject({ seedingTiebreaker: "pointsFor", playoffSeeding: { reseed: true } });
    const rows = view.standings?.rows ?? [];
    expect(rows.map((r) => r.rank)).toEqual(range(1, snapshot.teams.length));
    expect(rows.filter((r) => r.isMine).map((r) => r.teamId)).toEqual([snapshot.myTeamId]);
    expect(sum(odds.teams.map((x) => x.pPlayoffs))).toBeCloseTo(snapshot.settings.playoffTeams, 9);
    expect(sum(odds.teams.map((x) => x.pTitle ?? Number.NaN))).toBeCloseTo(1, 9);
    expect(Math.abs(sum(rows.map((r) => printedTitle(r.title))) - 100)).toBeLessThanOrEqual(0.05 * rows.length + 1e-9);
    expect(odds).toMatchObject({ tiebreaker: { rule: "pointsFor", assumed: false }, reseed: { value: true, assumed: false } });
    expect(view.standings?.notes).toContain("Ties in the standings go to points for, the league's rule.");
    expect(view.standings?.notes).toContain("The playoffs re-seed after each round: the best seed left plays the worst.");
    expect(view.standings?.notes.some((n) => n.includes("assumed"))).toBe(false);
    const explain = view.explain.find((e) => e.title === "Playoff odds")?.text ?? "";
    expect(explain).toContain("After each round the teams left are re-seeded, best seed against worst.");
    expect(explain).not.toContain("assumed");
    expect(view.schedule?.rows.length).toBe(snapshot.settings.regularSeasonWeeks.filter((w) => w >= snapshot.currentWeek).length);
  });
});

describe("The Sleeper test league split into 2 divisions: division winners seeded first, the league's rule or assumed, on the page", () => {
  /** The test league's rosters in 2 divisions, with `playoffTeams` playoff spots and a fixed bracket. */
  function divided(playoffTeams: number) {
    const t = loadTestLeague();
    const now = new Date("2026-09-30T12:00:00.000Z");
    t.league.settings.divisions = 2;
    t.league.settings.playoff_teams = playoffTeams;
    t.league.settings.playoff_seed_type = 0;
    t.rosters.forEach((r: { settings: Record<string, unknown> }, i: number) => {
      r.settings.division = (i % 2) + 1;
    });
    const { snapshot } = normalizeSleeperLeague(rawOf(t), { now, resolver: sleeperResolver(t.players), userId: t.meta.me.userId });
    return { snapshot, ...pipeline(snapshot, syntheticInputs(snapshot), now) };
  }
  const inferred = (s: LeagueSnapshot) => s.warnings.some((w) => w.code === "SETTING_INFERRED" && w.platformPath === "settings.divisions");
  const explainOf = (view: ReturnType<typeof pipeline>["view"]) => view.explain.find((e) => e.title === "Playoff odds")?.text ?? "";

  it("says an inferred rule is assumed in the explainer too, as the standings notes do (a 4-team playoff: a layout Sleeper's help center doesn't cover)", () => {
    const { snapshot, view } = divided(4);
    expect(snapshot.settings.divisions).toHaveLength(2);
    expect(snapshot.settings.playoffSeeding).toEqual({ reseed: false, divisionWinnersFirst: true });
    expect(inferred(snapshot)).toBe(true);
    expect(view.standings?.notes).toContain("Division winners get the top seeds (assumed: the league doesn't say).");
    expect(explainOf(view)).toContain("win percentage, then points for, with division winners seeded first (assumed: the platform doesn't say). The top 4 make the playoffs.");
  });

  it("states a documented rule as the league's own (a 6-team playoff: the help center gives its 2 division winners the byes)", () => {
    const { snapshot, view } = divided(6);
    expect(snapshot.settings.playoffSeeding).toEqual({ reseed: false, divisionWinnersFirst: true });
    expect(inferred(snapshot)).toBe(false);
    expect(view.standings?.notes).toContain("Division winners get the top seeds.");
    expect(explainOf(view)).toContain("win percentage, then points for, with division winners seeded first. The top 6 make the playoffs");
    expect(explainOf(view)).not.toContain("assumed");
  });
});
