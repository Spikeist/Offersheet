/**
 * The Settings page's view model (CLAUDE.md §14 item 6 "Settings", §12 "User settings", §7 "Streaming
 * positions"; lead decision L12): every TradeSettings field (src/engine/settings.ts) as plain-English
 * choices for the imported league, the edits the page makes (applySettingsEdit), and warnings about
 * combinations that can't work. Pure: no React, no storage.
 *
 * What the page offers, and why:
 * - Positions I stream weekly: the streamable positions (config.streaming.streamable: K, DEF, QB, TE) this
 *   league's lineup starts; K and DEF are on by default. It applies to my team only; other teams count as
 *   streaming a position after config.streaming.detectAdds adds there this season.
 * - Playoff weight: 1× to 2× (PLAYOFF_WEIGHT_RANGE) in quarter steps, the default marked, plus a saved value
 *   off those steps so the page never hides what's saved.
 * - Win now ↔ Future (λ, §10): dynasty and keeper leagues only. "Automatic" (null) is the default by my
 *   playoff odds (config.benefit.lambda); the slider starts at the keeper default in a keeper league and
 *   at the bubble default (balanced) in a dynasty one. Keeper costs aren't modeled, and the page says so.
 * - Protect my trade value (planner addendum to Checkpoint 3, §3; lead decision N3): Low / Medium / High (κ =
 *   config.benefit.protectValue: how much Helps you counts the trade value given up or gained, so the user keeps value
 *   for later deals before the deadline), Medium (config.benefit.protectValueDefault) marked as the default. Redraft
 *   leagues only: dynasty and keeper leagues have no market term in Helps you (their long-term value counts instead,
 *   through Win now ↔ Future). The help says depth for injuries and byes is counted either way.
 * - Max players per side: 1 to config.search.maxPerSideAllowed.
 * - Untouchables (my players: roster, IR and taxi) and must-include players (any team's, mine first) need
 *   my team; without it the page points to the Import Report. A player is never both: marking one moves him
 *   out of the other list. Saved players who are no longer on my team (untouchables) or on any team
 *   (must-include) are listed so they can be removed.
 * - Positions to target and to avoid: the positions this league starts, without the ones trade ideas
 *   leave out (config.market.tradeSearchExcluded: P, K, DEF, IDP) unless those are included. A position is
 *   never both; turning "include" off clears the left-out positions from both lists, so no hidden choice
 *   can empty the search.
 * - Include K, D/ST and IDP: only when the league starts one of them, named after the ones it starts.
 * - Include draft picks: dynasty and keeper leagues only.
 * Warnings: must-include players from two other teams (a trade is with one team), more must-include players
 * on a side than a trade allows, a player on both lists, saved players who left, targets the search can't use.
 */
import { config } from "@/engine/config";
import { POSITIONS, type LeagueSnapshot, type PlayerInfo, type Pos } from "@/engine/model";
import { PLAYOFF_WEIGHT_RANGE, PROTECT_VALUE_LEVELS, normalizeTradeSettings, type ProtectValue, type TradeSettings } from "@/engine/settings";
import { fmtNum } from "@/lib/format";
import { LEAGUE_TYPE_LABEL, PLATFORM_LABEL, posLabel } from "@/lib/labels";

/** One option of a choice group: its value, its words, and whether it's chosen. */
export interface Choice<T> {
  value: T;
  label: string;
  /** Smaller words after the label ("default", "QB · BUF · IR"). */
  detail?: string;
  checked: boolean;
}

export interface PlayerPick {
  id: string;
  /** "Josh Allen" (or a stand-in when the player isn't in the league's data any more). */
  name: string;
  /** "QB · BUF" (and "IR" or "taxi" when he's there). */
  detail: string;
}

export interface MustIncludeGroup {
  teamId: string;
  /** "Your team" or the team's name. */
  label: string;
  options: { id: string; label: string }[];
}

export type PlayersView =
  | { kind: "noTeam"; text: string }
  | {
      kind: "ok";
      untouchables: { choices: Choice<string>[]; stale: PlayerPick[] };
      mustInclude: {
        /** Players that can still be added, by team (mine first). */
        groups: MustIncludeGroup[];
        /** Players already chosen, with where they are ("Your team", a team's name, or "Not on a team"). */
        chosen: (PlayerPick & { team: string })[];
        warnings: string[];
      };
    };

export interface SettingsView {
  league: { name: string; platformLabel: string; season: number; typeLabel: string; dynastyOrKeeper: boolean };
  /** The league has saved settings (false: the defaults). */
  stored: boolean;
  /** "Positions I stream weekly"; null when the league starts none of the streamable positions. */
  stream: { choices: Choice<Pos>[]; help: string } | null;
  playoffWeight: { choices: Choice<number>[]; help: string };
  /** Win now ↔ Future: dynasty and keeper leagues only. */
  lambda: {
    automatic: boolean;
    /** The slider's value (the saved one, or where it starts when "Automatic" is turned off). */
    value: number;
    /** The value in words, e.g. "Mostly this season: later seasons count 35%". */
    valueText: string;
    automaticText: string;
    help: string;
    keeperNote: string | null;
  } | null;
  /** "Protect my trade value": Low / Medium / High; redraft leagues only (null otherwise). */
  protectValue: { choices: Choice<ProtectValue>[]; help: string } | null;
  maxPerSide: { choices: Choice<number>[]; help: string };
  players: PlayersView;
  positions: { target: Choice<Pos>[]; avoid: Choice<Pos>[]; note: string | null };
  /** "Include kickers and D/STs in trade ideas"; null when the league starts none of them. */
  kDefIdp: { label: string; checked: boolean; help: string } | null;
  /** Dynasty and keeper leagues only. */
  picks: { checked: boolean; help: string } | null;
}

type SnapshotPart = Pick<LeagueSnapshot, "platform" | "name" | "season" | "settings" | "teams" | "players">;

export interface SettingsViewInput {
  snapshot: SnapshotPart;
  /** My team, as the pages resolve it (resolveMyTeam); null when the user hasn't picked one. */
  myTeamId: string | null;
  settings: TradeSettings;
  stored: boolean;
}

/** The order positions are listed in (QB, RB, WR, TE, K, P, DEF, DL, LB, DB). */
const POS_ORDER = new Map(POSITIONS.map((p, i) => [p, i]));
const EXCLUDED: ReadonlySet<Pos> = new Set(config.market.tradeSearchExcluded);
const IDP: ReadonlySet<Pos> = new Set<Pos>(["DL", "LB", "DB"]);

function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

/** "a", "a and b", "a, b and c". */
function listText(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** Positions some starting slot of this league accepts, in POSITIONS order. */
export function startablePositions(snapshot: Pick<LeagueSnapshot, "settings">): Pos[] {
  const set = new Set<Pos>();
  for (const slot of snapshot.settings.lineup) if (slot.count > 0) for (const p of slot.eligible) set.add(p);
  return POSITIONS.filter((p) => set.has(p));
}

/** A position's name in a sentence, as this platform's users know it. */
function positionWords(pos: Pos, platform: LeagueSnapshot["platform"]): string {
  switch (pos) {
    case "QB":
      return "quarterbacks";
    case "RB":
      return "running backs";
    case "WR":
      return "wide receivers";
    case "TE":
      return "tight ends";
    case "K":
      return "kickers";
    case "P":
      return "punters";
    case "DEF":
      return platform === "espn" ? "D/STs" : "team defenses";
    default:
      return "IDP players";
  }
}

const STREAM_NAME: Partial<Record<Pos, string>> = { QB: "Quarterback", TE: "Tight end", K: "Kicker" };

function streamLabel(pos: Pos, platform: LeagueSnapshot["platform"]): string {
  if (pos === "DEF") return platform === "espn" ? "D/ST" : "Team defense (DEF)";
  return `${STREAM_NAME[pos] ?? pos} (${pos})`;
}

/** Where a player is on his team, for his detail line. */
function slotWord(team: LeagueSnapshot["teams"][number], id: string): string | null {
  if (team.ir.includes(id)) return "IR";
  if (team.taxi.includes(id)) return "taxi";
  return null;
}

function playerPick(id: string, info: PlayerInfo | undefined, platform: LeagueSnapshot["platform"], where: string | null): PlayerPick {
  if (!info) return { id, name: "A player who's no longer in this league's data", detail: "" };
  const parts = [posLabel(info.pos, platform), info.nflTeam ?? "no NFL team", ...(where ? [where] : [])];
  return { id, name: info.name, detail: parts.join(" · ") };
}

/** A team's players (roster, IR, taxi), each once, by position then name. */
function teamPlayers(snapshot: SnapshotPart, teamId: string): PlayerPick[] {
  const team = snapshot.teams.find((t) => t.id === teamId);
  if (!team) return [];
  const ids = [...new Set([...team.roster, ...team.ir, ...team.taxi])];
  const rank = (pos: Pos | undefined) => (pos === undefined ? POSITIONS.length : (POS_ORDER.get(pos) ?? POSITIONS.length));
  return ids
    .map((id) => ({ pick: playerPick(id, snapshot.players[id], snapshot.platform, slotWord(team, id)), pos: snapshot.players[id]?.pos }))
    .sort((a, b) => rank(a.pos) - rank(b.pos) || a.pick.name.localeCompare(b.pick.name) || a.pick.id.localeCompare(b.pick.id))
    .map((x) => x.pick);
}

/** Which team a player is on now (roster, IR or taxi), if any. */
function teamOf(snapshot: SnapshotPart, id: string): LeagueSnapshot["teams"][number] | undefined {
  return snapshot.teams.find((t) => t.roster.includes(id) || t.ir.includes(id) || t.taxi.includes(id));
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** λ in words: how much later seasons count. */
export function lambdaText(value: number): string {
  const lean = value <= 0.1 ? "This season" : value < 0.4 ? "Mostly this season" : value <= 0.6 ? "Balanced" : value < 0.9 ? "Mostly the future" : "The future";
  return `${lean}: later seasons count ${pct(value)}`;
}

/** "Protect my trade value" levels in words (each one's weight is config.benefit.protectValue): the level, capitalized. */
export const PROTECT_VALUE_LABEL: Record<ProtectValue, string> = { low: "Low", medium: "Medium", high: "High" };

/** Where the Win now ↔ Future slider starts when "Automatic" is turned off. */
export function lambdaStart(leagueType: LeagueSnapshot["settings"]["leagueType"]): number {
  return leagueType === "keeper" ? config.benefit.lambda.keeper : config.benefit.lambda.bubble;
}

/** The playoff weights offered: quarter steps across PLAYOFF_WEIGHT_RANGE, plus a saved value off those steps. */
function playoffWeights(saved: number): number[] {
  const [lo, hi] = PLAYOFF_WEIGHT_RANGE;
  const out: number[] = [];
  for (let w = lo; w <= hi + 1e-9; w += 0.25) out.push(Math.round(w * 100) / 100);
  if (!out.some((w) => Math.abs(w - saved) < 1e-9)) out.push(saved);
  return out.sort((a, b) => a - b);
}

export function buildSettingsView(input: SettingsViewInput): SettingsView {
  const { snapshot, myTeamId } = input;
  const s = normalizeTradeSettings(input.settings);
  const platform = snapshot.platform;
  const type = snapshot.settings.leagueType;
  const dynastyOrKeeper = type === "dynasty" || type === "keeper";
  const startable = startablePositions(snapshot);
  const lam = config.benefit.lambda;

  const streamable = config.streaming.streamable.filter((p) => startable.includes(p));
  const stream = streamable.length
    ? {
        choices: streamable.map((p) => ({ value: p, label: streamLabel(p, platform), checked: s.streamPositions.includes(p) })),
        help:
          `Each week you pick up whichever free agent has the best matchup. For a position you stream, Offer Sheet values your lineup spot at the better of your own player and the ${ordinal(config.streaming.streamRank)}-best free agent that week (other managers stream too), so a trade never pays for what the waiver wire gives you anyway. ` +
          `It's for your team; another team counts as streaming a position once it has picked up ${config.streaming.detectAdds} or more players there this season.`,
      }
    : null;

  const playoffWeight = {
    choices: playoffWeights(s.playoffWeight).map((w) => ({
      value: w,
      label: `${fmtNum(w)}×`,
      ...(w === config.lineups.playoffWeight ? { detail: "default" } : {}),
      checked: Math.abs(w - s.playoffWeight) < 1e-9,
    })),
    help: `When Offer Sheet adds up your lineup's points for the rest of the season, each playoff week counts this many times a regular-season week. 1× counts them the same.`,
  };

  const lambda = dynastyOrKeeper
    ? {
        automatic: s.lambda === null,
        value: s.lambda ?? lambdaStart(type),
        valueText: lambdaText(s.lambda ?? lambdaStart(type)),
        automaticText:
          type === "keeper"
            ? `Later seasons count ${pct(lam.keeper)} in a keeper league.`
            : `Set from your playoff odds: later seasons count ${pct(lam.contender)} when you're ${pct(lam.contenderAt)} or better to make the playoffs, ${pct(lam.bubble)} from ${pct(lam.bubbleAt)} to ${pct(lam.contenderAt)}, and ${pct(lam.rebuild)} below ${pct(lam.bubbleAt)}.`,
        help: "A trade can help you this season, in later seasons, or both. This sets how much later seasons count when Offer Sheet scores a trade for you.",
        keeperNote: type === "keeper" ? "What it costs to keep a player next season isn't part of the score yet." : null,
      }
    : null;

  const protectValue =
    type === "redraft"
      ? {
          choices: PROTECT_VALUE_LEVELS.map((level) => ({
            value: level,
            label: PROTECT_VALUE_LABEL[level],
            ...(level === config.benefit.protectValueDefault ? { detail: "default" } : {}),
            checked: level === s.protectValue,
          })),
          help:
            "How much Helps you counts trade value, so you keep some for later deals before your trade deadline: giving up more value than you get lowers it, getting more raises it. " +
            "High protects your value the most; Low goes for the biggest lineup gain now. Your bench's worth as cover for injuries and byes counts either way.",
        }
      : null;

  const maxPerSide = {
    choices: Array.from({ length: config.search.maxPerSideAllowed }, (_, i) => i + 1).map((n) => ({
      value: n,
      label: String(n),
      ...(n === config.search.maxPerSide ? { detail: "default" } : {}),
      checked: n === s.maxPerSide,
    })),
    help: `The most players either team gives in one trade idea. ${config.search.maxPerSideAllowed} finds bigger packages, but the search takes longer.`,
  };

  const excludedHere = startable.filter((p) => EXCLUDED.has(p));
  const excludedWords = [...new Set(excludedHere.map((p) => (IDP.has(p) ? "IDP players" : positionWords(p, platform))))];
  const kDefIdp = excludedHere.length
    ? {
        label: `Include ${listText(excludedWords)} in trade ideas`,
        checked: s.includeKDefIdp,
        help: "Off by default: managers rarely trade for them, and FantasyCalc doesn't value them, so their trade values are Offer Sheet's estimates.",
      }
    : null;

  const shown = startable.filter((p) => s.includeKDefIdp || !EXCLUDED.has(p));
  const targetHidden = s.targetPositions.filter((p) => !shown.includes(p));
  const positions = {
    target: shown.map((p) => ({ value: p, label: posLabel(p, platform), checked: s.targetPositions.includes(p) })),
    avoid: shown.map((p) => ({ value: p, label: posLabel(p, platform), checked: s.avoidPositions.includes(p) })),
    note:
      s.targetPositions.length > 0 && targetHidden.length === s.targetPositions.length
        ? `Your saved target positions (${listText(targetHidden.map((p) => posLabel(p, platform)))}) aren't in trade ideas here, so they'd find nothing. Pick positions above, or leave them all unchecked.`
        : null,
  };

  const picks = dynastyOrKeeper
    ? { checked: s.includePicks, help: "Adds future draft picks, yours and theirs, to trade ideas. Off by default: pick values are FantasyCalc's and haven't been checked against a real dynasty league yet." }
    : null;

  return {
    league: { name: snapshot.name, platformLabel: PLATFORM_LABEL[platform], season: snapshot.season, typeLabel: LEAGUE_TYPE_LABEL[type], dynastyOrKeeper },
    stored: input.stored,
    stream,
    playoffWeight,
    lambda,
    protectValue,
    maxPerSide,
    players: playersView(snapshot, myTeamId, s),
    positions,
    kDefIdp,
    picks,
  };
}

function playersView(snapshot: SnapshotPart, myTeamId: string | null, s: TradeSettings): PlayersView {
  const mine = myTeamId ? snapshot.teams.find((t) => t.id === myTeamId) : undefined;
  if (!mine) {
    return { kind: "noTeam", text: "Pick your team on the Import Report first: untouchables and must-include players are chosen from the rosters, starting with yours." };
  }
  const myPlayers = teamPlayers(snapshot, mine.id);
  const onMyTeam = new Set(myPlayers.map((p) => p.id));
  const untouchables = {
    choices: myPlayers.map((p) => ({ value: p.id, label: p.name, detail: p.detail, checked: s.untouchables.includes(p.id) })),
    stale: s.untouchables.filter((id) => !onMyTeam.has(id)).map((id) => playerPick(id, snapshot.players[id], snapshot.platform, null)),
  };

  const chosen = new Set(s.mustInclude);
  const others = snapshot.teams.filter((t) => t.id !== mine.id);
  const groups: MustIncludeGroup[] = [mine, ...others].map((team) => ({
    teamId: team.id,
    label: team.id === mine.id ? "Your team" : team.name,
    options: teamPlayers(snapshot, team.id)
      .filter((p) => !chosen.has(p.id))
      .map((p) => ({ id: p.id, label: `${p.name} (${p.detail}${team.id === mine.id && s.untouchables.includes(p.id) ? " · untouchable" : ""})` })),
  }));

  const warnings: string[] = [];
  const chosenTeams = s.mustInclude.map((id) => teamOf(snapshot, id));
  const chosenList = s.mustInclude.map((id, i) => {
    const team = chosenTeams[i];
    const pick = playerPick(id, snapshot.players[id], snapshot.platform, team ? slotWord(team, id) : null);
    return { ...pick, team: team ? (team.id === mine.id ? "Your team" : team.name) : "Not on a team" };
  });
  chosenList.forEach((p, i) => {
    if (!chosenTeams[i]) warnings.push(`${p.name} isn't on a team in this league any more, so no trade can include him. Remove him.`);
  });
  const partners = [...new Set(chosenTeams.flatMap((t) => (t && t.id !== mine.id ? [t.id] : [])))];
  if (partners.length >= 2) {
    const names = partners.map((id) => snapshot.teams.find((t) => t.id === id)?.name ?? id);
    warnings.push(`A trade is with one team at a time, so players from ${listText(names)} can't all be in one trade, and trade ideas will find none. Keep players from one other team.`);
  }
  const mineCount = chosenTeams.filter((t) => t?.id === mine.id).length;
  const theirCount = chosenTeams.filter((t) => t && t.id !== mine.id).length;
  if (mineCount > s.maxPerSide) warnings.push(`You chose ${mineCount} of your players, but a trade idea has at most ${s.maxPerSide} per side.`);
  if (partners.length === 1 && theirCount > s.maxPerSide) warnings.push(`You chose ${theirCount} of their players, but a trade idea has at most ${s.maxPerSide} per side.`);
  const both = s.mustInclude.filter((id) => s.untouchables.includes(id));
  for (const id of both) warnings.push(`${snapshot.players[id]?.name ?? "A player"} is both untouchable and a must-include player. Remove him from one list.`);

  return { kind: "ok", untouchables, mustInclude: { groups, chosen: chosenList, warnings } };
}

// ---------------------------------------------------------------------------------------------
// Edits

export type SettingsEdit =
  | { kind: "stream"; pos: Pos; on: boolean }
  | { kind: "playoffWeight"; value: number }
  /** null = Automatic. */
  | { kind: "lambda"; value: number | null }
  | { kind: "protectValue"; value: ProtectValue }
  | { kind: "maxPerSide"; value: number }
  | { kind: "untouchable"; id: string; on: boolean }
  | { kind: "mustInclude"; id: string; on: boolean }
  | { kind: "target"; pos: Pos; on: boolean }
  | { kind: "avoid"; pos: Pos; on: boolean }
  | { kind: "includeKDefIdp"; on: boolean }
  | { kind: "includePicks"; on: boolean };

const withOut = <T>(xs: readonly T[], x: T): T[] => xs.filter((y) => y !== x);
const withIn = <T>(xs: readonly T[], x: T): T[] => (xs.includes(x) ? [...xs] : [...xs, x]);
const toggled = <T>(xs: readonly T[], x: T, on: boolean): T[] => (on ? withIn(xs, x) : withOut(xs, x));

/**
 * One change on the Settings page: the new settings (normalized), and a note when the change also undid
 * another choice (a player can't be both untouchable and a must-include player; a position can't be both
 * targeted and avoided; turning "include K, D/ST and IDP" off clears those positions from both lists).
 * `nameOf` names players in the note.
 */
export function applySettingsEdit(settings: TradeSettings, edit: SettingsEdit, nameOf: (id: string) => string = () => "That player", platform?: LeagueSnapshot["platform"]): { settings: TradeSettings; note: string | null } {
  const s = normalizeTradeSettings(settings);
  let note: string | null = null;
  let next: TradeSettings;
  switch (edit.kind) {
    case "stream":
      next = { ...s, streamPositions: toggled(s.streamPositions, edit.pos, edit.on) };
      break;
    case "playoffWeight":
      next = { ...s, playoffWeight: edit.value };
      break;
    case "lambda":
      next = { ...s, lambda: edit.value };
      break;
    case "protectValue":
      next = { ...s, protectValue: edit.value };
      break;
    case "maxPerSide":
      next = { ...s, maxPerSide: edit.value };
      break;
    case "untouchable":
      if (edit.on && s.mustInclude.includes(edit.id)) note = `${nameOf(edit.id)} is no longer a must-include player.`;
      next = { ...s, untouchables: toggled(s.untouchables, edit.id, edit.on), mustInclude: edit.on ? withOut(s.mustInclude, edit.id) : s.mustInclude };
      break;
    case "mustInclude":
      if (edit.on && s.untouchables.includes(edit.id)) note = `${nameOf(edit.id)} is no longer untouchable.`;
      next = { ...s, mustInclude: toggled(s.mustInclude, edit.id, edit.on), untouchables: edit.on ? withOut(s.untouchables, edit.id) : s.untouchables };
      break;
    case "target":
      if (edit.on && s.avoidPositions.includes(edit.pos)) note = `${posLabel(edit.pos, platform)} is no longer avoided.`;
      next = { ...s, targetPositions: toggled(s.targetPositions, edit.pos, edit.on), avoidPositions: edit.on ? withOut(s.avoidPositions, edit.pos) : s.avoidPositions };
      break;
    case "avoid":
      if (edit.on && s.targetPositions.includes(edit.pos)) note = `${posLabel(edit.pos, platform)} is no longer a target.`;
      next = { ...s, avoidPositions: toggled(s.avoidPositions, edit.pos, edit.on), targetPositions: edit.on ? withOut(s.targetPositions, edit.pos) : s.targetPositions };
      break;
    case "includeKDefIdp": {
      next = { ...s, includeKDefIdp: edit.on };
      if (!edit.on) {
        const cleared = [...new Set([...s.targetPositions, ...s.avoidPositions].filter((p) => EXCLUDED.has(p)))];
        if (cleared.length) {
          next = { ...next, targetPositions: s.targetPositions.filter((p) => !EXCLUDED.has(p)), avoidPositions: s.avoidPositions.filter((p) => !EXCLUDED.has(p)) };
          note = `${listText(cleared.map((p) => posLabel(p, platform)))} ${cleared.length === 1 ? "is" : "are"} no longer targeted or avoided.`;
        }
      }
      break;
    }
    case "includePicks":
      next = { ...s, includePicks: edit.on };
      break;
  }
  return { settings: normalizeTradeSettings(next), note };
}
