"use client";
/**
 * A table of players with their rest-of-season points (CLAUDE.md §6 step 7, §14 item 3): ROS points
 * split into regular season and playoffs, games left, bye status, value (§9) and lineup cost (§7
 * MV_lose). Tapping a player (a disclosure button) shows the week-by-week breakdown; on wider
 * screens a small bar strip shows the weeks at a glance and hovering it lists them.
 *
 * Phones (375 px) get two columns, player and ROS points; the rest moves into the breakdown, so the
 * page never scrolls sideways.
 *
 * Accessibility: each player's name cell is the row header (th scope="row"), so moving down a column
 * reads whose number it is. The disclosure button fills that cell, name and position/team line
 * together, at least 44 px tall. IR and taxi players come after the active roster, each group in its
 * own row group (tbody) headed by a th scope="rowgroup"; browsers that ignore rowgroup headers still
 * hear the group, because it is part of each of those players' button names.
 *
 * A player whose ESPN return date conflicts with his tag (CLAUDE.md §6 step 3) gets a short line under
 * his position line, inside the button (so it's part of his button's name), with the full sentence on
 * hover and at the top of his breakdown. A player the market blend reached (§6 step 8) shows "Our projection
 * 210 · Trade market 170 · Used 190" at the top of his breakdown, with what each number is in words under it (visible
 * text, not a hover: phones have none), and at the top of the ROS cell's hover text.
 *
 * Another team's player his manager would want a little extra for (planner addendum to Checkpoint 3, §2) carries a
 * gold "Harder to get" pill on his position line, after any injury badge: words, part of his button's name, with why
 * on hover (the page's explainer says it in full).
 */
import { useId, useState } from "react";
import type { PlayerRow, WeekRow } from "@/lib/leagueView";
import { Badge, cx } from "../ui";
import { HarderToGetBadge } from "./HarderToGetBadge";

const GROUP_TITLE: Record<PlayerRow["group"], string | null> = {
  active: null,
  fa: null,
  ir: "Injured reserve",
  taxi: "Taxi squad",
};

function InjuryBadge({ injury }: { injury: NonNullable<PlayerRow["injury"]> }) {
  return (
    <Badge tone={injury.tone} className="ml-1 align-middle">
      <span aria-hidden>{injury.short}</span>
      <span className="sr-only">{injury.long}</span>
    </Badge>
  );
}

function ValueText({ value }: { value: PlayerRow["value"] }) {
  if (!value) return <span className="text-muted">—</span>;
  return (
    <span title={value.title}>
      {value.text}
      {value.srText ? <span className="sr-only">{` ${value.srText}`}</span> : null}
    </span>
  );
}

/**
 * Weekly points as thin bars on the table's shared scale (`max`: the best week of anyone listed), so
 * a bar's height compares across players. A bye, and a game already under way, are a flat stub.
 * Visual only: the breakdown table has the numbers.
 */
function WeekStrip({ weeks, text, max }: { weeks: WeekRow[]; text: string; max: number }) {
  return (
    <span aria-hidden title={text} className="inline-flex h-7 items-end gap-0.5 align-middle">
      {weeks.map((w, i) => {
        // A little extra room where the playoffs start.
        const gap = w.playoff && i > 0 && !weeks[i - 1]?.playoff;
        if (w.note === "Bye" || w.started) return <span key={w.week} className={cx("mb-0.5 h-0.5 w-1 rounded-full bg-line", gap && "ml-1")} />;
        const height = max > 0 && w.points > 0 ? Math.max(8, Math.round((w.points / max) * 100)) : 4;
        return <span key={w.week} className={cx("w-1 rounded-t-[2px]", w.points > 0 ? "bg-brand" : "bg-line", gap && "ml-1")} style={{ height: `${height}%` }} />;
      })}
    </span>
  );
}

function WeekTable({ player }: { player: PlayerRow }) {
  return (
    <table className="mt-2 w-full max-w-md text-xs">
      <caption className="sr-only">{player.name}: projected points week by week</caption>
      <thead>
        <tr className="text-left text-muted">
          <th scope="col" className="py-1 pr-2 font-bold">
            Week
          </th>
          <th scope="col" className="py-1 pr-2 text-right font-bold">
            Pts
          </th>
          <th scope="col" className="py-1 pr-2 text-right font-bold">
            <abbr title="Chance he plays that week">Plays</abbr>
          </th>
          <th scope="col" className="py-1 font-bold">
            Note
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {player.weeks.map((w) => (
          <tr key={w.week}>
            <th scope="row" className="py-1 pr-2 text-left font-semibold whitespace-nowrap">
              {w.week}
              {w.playoff ? <span className="ml-1 font-normal text-muted">playoffs</span> : null}
            </th>
            <td className="py-1 pr-2 text-right tabular-nums">{w.pointsText}</td>
            <td className="py-1 pr-2 text-right tabular-nums">{w.availabilityText}</td>
            <td className="py-1 text-muted">{w.note ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The breakdown under a player: the conflict note and the market blend's line (Our projection · Trade market · Used,
 * CLAUDE.md §6 step 8, with what each is in words) when he has them, the columns phones don't show, then his
 * week-by-week points.
 */
export function PlayerDetail({ player, showLineupCost }: { player: PlayerRow; showLineupCost: boolean }) {
  const p = player;
  return (
    <div className="rounded-xl bg-surface-muted p-3">
      {p.availabilityNote ? <p className="mb-2 text-xs leading-relaxed">{p.availabilityNote.long}.</p> : null}
      {p.blend ? (
        <p className="mb-2 text-xs leading-relaxed break-words">
          <span className="font-medium">{p.blend.text}</span>
          <span className="block text-muted">{p.blend.title}</span>
        </p>
      ) : null}
      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-muted">Games left</dt>
          <dd className="font-bold">{p.gamesText}</dd>
        </div>
        <div>
          <dt className="text-muted">Value</dt>
          <dd className="font-bold">
            <ValueText value={p.value} />
          </dd>
        </div>
        {showLineupCost ? (
          <div>
            <dt className="text-muted">Lineup cost</dt>
            <dd className="font-bold">{p.lineupCost ?? "—"}</dd>
          </div>
        ) : null}
      </dl>
      {p.weeks.length ? <WeekTable player={p} /> : <p className="mt-2 text-xs text-muted">No projections for him.</p>}
    </div>
  );
}

/** One player: his row (the row header holds the disclosure button) and the row his breakdown opens in. */
function PlayerRows({ player, columns, showLineupCost, scaleMax }: { player: PlayerRow; columns: number; showLineupCost: boolean; scaleMax: number }) {
  const [open, setOpen] = useState(false);
  const detailId = `weeks-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const p = player;
  const group = GROUP_TITLE[p.group];
  return (
    <>
      <tr className={open ? undefined : "border-b border-line"}>
        <th scope="row" className="p-0 text-left align-top font-normal">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={detailId}
            onClick={() => setOpen((o) => !o)}
            className="flex min-h-11 w-full flex-col justify-center py-1 pr-2 pl-4 text-left sm:pl-0"
          >
            <span className="flex items-center gap-1.5">
              <span aria-hidden className={cx("inline-block text-xs text-muted transition-transform", open && "rotate-90")}>
                ▸
              </span>
              <span className="font-bold break-words">{p.name}</span>
            </span>
            {group ? <span className="sr-only">{`, ${group.toLowerCase()}`}</span> : null}
            <span className="block pl-4 text-xs text-muted">
              {p.pos} · {p.nflTeam} · {p.byeText}
              {p.injury ? <InjuryBadge injury={p.injury} /> : null}
              {p.tag ? <HarderToGetBadge tag={p.tag} className="ml-1" /> : null}
            </span>
            {p.availabilityNote ? (
              <span title={p.availabilityNote.long} className="block pl-4 text-xs break-words text-muted italic">
                {p.availabilityNote.short}
              </span>
            ) : null}
            <span className="sr-only">, week by week</span>
          </button>
        </th>
        <td className="py-1 pr-4 text-right align-top tabular-nums sm:pr-3" title={p.weeksText}>
          <span className="block font-extrabold">{p.rosText}</span>
          <span className="block text-xs text-muted">{p.splitText}</span>
        </td>
        <td className="hidden py-2 pr-3 text-right align-top whitespace-nowrap tabular-nums sm:table-cell">{p.gamesText}</td>
        <td className="hidden py-2 pr-3 align-top md:table-cell">{p.weeks.length ? <WeekStrip weeks={p.weeks} text={p.weeksText} max={scaleMax} /> : null}</td>
        <td className="hidden py-2 pr-3 text-right align-top tabular-nums sm:table-cell">
          <ValueText value={p.value} />
        </td>
        {showLineupCost ? <td className="hidden py-2 text-right align-top tabular-nums sm:table-cell">{p.lineupCost ?? <span className="text-muted">—</span>}</td> : null}
      </tr>
      {/* The row is always there for aria-controls; its content is built only when opened (a league has hundreds of players). */}
      <tr id={detailId} hidden={!open} className="border-b border-line">
        <td colSpan={columns} className="px-4 pb-3 sm:px-0">
          {open ? <PlayerDetail player={p} showLineupCost={showLineupCost} /> : null}
        </td>
      </tr>
    </>
  );
}

/** Consecutive players of the same group (the view lists active, then IR, then taxi). */
function groupRuns(players: readonly PlayerRow[]): { group: PlayerRow["group"]; players: PlayerRow[] }[] {
  const runs: { group: PlayerRow["group"]; players: PlayerRow[] }[] = [];
  for (const p of players) {
    const last = runs[runs.length - 1];
    if (last && last.group === p.group) last.players.push(p);
    else runs.push({ group: p.group, players: [p] });
  }
  return runs;
}

export function PlayerTable({
  players,
  caption,
  showLineupCost,
  split,
  lineupCostTitle = "Rest-of-season lineup points his team would lose without him",
}: {
  players: PlayerRow[];
  caption: string;
  showLineupCost: boolean;
  split: boolean;
  /** The Lineup cost column's definition (LeagueView.lineupCostTitle). */
  lineupCostTitle?: string;
}) {
  const columns = showLineupCost ? 6 : 5;
  const scaleMax = Math.max(0, ...players.flatMap((p) => p.weeks.map((w) => w.points)));
  return (
    <div className="-mx-4 sm:mx-0">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            <th scope="col" className="py-2 pr-2 pl-4 font-bold sm:pl-0">
              Player
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-bold sm:pr-3">
              <abbr title="Projected points over the rest of the season">ROS pts</abbr>
              {split ? <span className="block font-normal">reg / playoffs</span> : null}
            </th>
            <th scope="col" className="hidden py-2 pr-3 text-right font-bold sm:table-cell">
              Games left
            </th>
            <th scope="col" className="hidden py-2 pr-3 font-bold md:table-cell">
              Weeks
            </th>
            <th scope="col" className="hidden py-2 pr-3 text-right font-bold sm:table-cell">
              Value
            </th>
            {showLineupCost ? (
              <th scope="col" className="hidden py-2 text-right font-bold sm:table-cell">
                <abbr title={lineupCostTitle}>Lineup cost</abbr>
              </th>
            ) : null}
          </tr>
        </thead>
        {groupRuns(players).map((run, i) => {
          const heading = GROUP_TITLE[run.group];
          return (
            <tbody key={`${run.group}-${i}`}>
              {heading ? (
                <tr>
                  <th scope="rowgroup" colSpan={columns} className="bg-surface-muted py-1.5 pl-4 text-left text-xs font-bold tracking-wide text-muted uppercase sm:pl-2">
                    {heading}
                  </th>
                </tr>
              ) : null}
              {run.players.map((p) => (
                <PlayerRows key={p.id} player={p} columns={columns} showLineupCost={showLineupCost} scaleMax={scaleMax} />
              ))}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
