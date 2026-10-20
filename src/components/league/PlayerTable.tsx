"use client";
/**
 * A table of players with their rest-of-season points (CLAUDE.md §6 step 7, §14 item 3): ROS points
 * split into regular season and playoffs, games left, bye status and lineup cost (§7 MV_lose). No trade value: planner
 * reply to Checkpoint 7a, 5.4 (Offer Sheet doesn't display FantasyCalc's values at all; a "Value" column and breakdown
 * row showed them, our estimates marked ~, until Phase 7b). Tapping a player (a disclosure button) shows the week-by-week
 * breakdown; on wider screens a small bar strip shows the weeks at a glance and hovering it lists them.
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
 * hover and at the top of his breakdown. A player the market blend reached (§6 step 8) says which way it moved his
 * projection, in words ("His projection leans up toward the trade market's view."), at the top of his breakdown, with how
 * the lean works under it (visible text, not a hover: phones have none), and at the top of the ROS cell's hover text; never
 * a number of the market's (planner reply to Checkpoint 7a, 5.4: until Phase 7b "Our projection 210 · Trade market 170 ·
 * Used 190").
 *
 * Another team's player his manager would want a little extra for (planner addendum to Checkpoint 3, §2) carries a
 * gold "Harder to get" pill on his position line, after any injury badge: words, part of his button's name, with why
 * on hover (the page's explainer says it in full).
 *
 * My roster card (Checkpoint 7e; planner reply to Checkpoint 7d, items 3.3 and 3.5): each of my active and IR players has a
 * lock icon beside his button (UntouchableLock: marks him untouchable, the Settings page's own setting; PlayerRow.lockable),
 * and each injured one the model has out now a line under it, "Expected back: week 8 (ESPN)" (or "our guess", "your week"),
 * whose select sets the week the user expects (ReturnWeekControl; PlayerRow.returnWeek), in a row of its own under his so
 * his row header stays his button and lock (review of wave C, UI-C-10); his breakdown repeats the line, not the select
 * (UI-C-5), with how such a week counts. Both edit the league's settings through the League page (leagueSettingsEdit.ts);
 * without it (another page, a static render) there's no lock, and the return line is text alone. The line replaces the
 * conflict note's short line in his button (it says the same, or a week of the user's in its place); the sentence stays in
 * his breakdown. Checkpoint 7h keeps it so (the lead's ruling: moving the select into his breakdown saved almost nothing and
 * put the setting a tap deeper); my roster card itself is closed by default since then (LeagueView.tsx).
 */
import { useId, useState } from "react";
import { returnWeekOptions, type PlayerRow, type ReturnWeekRow, type WeekRow } from "@/lib/leagueView";
import { Badge, cx } from "../ui";
import { HarderToGetBadge } from "./HarderToGetBadge";
import { useLeagueSettingsEdit } from "./leagueSettingsEdit";
import { UntouchableLock } from "./UntouchableLock";

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
 * The return week's select: 44 px tall, and 16 px text so iOS doesn't zoom in on it (ui.tsx inputBase's look, inline). On
 * phones it takes its line's width (a select sized in percent can shrink, so the name column never pushes the table past
 * 375 px; its text is clipped if it must be), from 640 px up its own.
 */
const RETURN_SELECT = "min-h-11 w-full max-w-full min-w-0 rounded-xl border border-line bg-surface px-2 py-1 text-base text-foreground shadow-inner focus:border-brand sm:w-auto";

/**
 * "Expected back: week 8 (ESPN)" for one of my injured players (Checkpoint 7e; planner reply to Checkpoint 7d, item 3.5),
 * with a select to set the week the user expects (leagueSettingsEdit.ts setReturnWeek; returnWeekOptions: the platform's
 * date or our guess first, which clears his week, then next week through the league's last, then "out for the season"). The
 * select shows the week as the browser holds it now (set for this season: leagueSettingsEdit.ts returnWeekOf), so a change
 * shows at once while the page computes again; its label names him for screen readers. A change the browser refuses shows
 * its reason (role alert). Without the League page's settings edits around it (LeagueSettingsEditContext), the line alone.
 * One per player, in a row of its own under his (review of wave C: UI-C-5, the breakdown had a second; UI-C-10, inside
 * his row header it was read out with his name in every cell of the row).
 */
export function ReturnWeekControl({ playerId, name, row, className }: { playerId: string; name: string; row: ReturnWeekRow; className?: string }) {
  const edit = useLeagueSettingsEdit();
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  if (!edit) return <span className={cx("block text-xs text-muted", className)}>{row.text}</span>;
  const { options, selected } = returnWeekOptions(row, edit.returnWeekOf(playerId));
  const change = (value: string) => {
    setError(null);
    void edit.setReturnWeek(playerId, value === "" ? null : Number(value)).then((r) => {
      if (!r.ok) setError(r.message);
    });
  };
  return (
    <span className={cx("flex flex-wrap items-center gap-x-2 gap-y-1 text-xs", className)}>
      <label htmlFor={id} className="font-semibold text-muted">
        Expected back<span className="sr-only">{` for ${name}`}</span>:
      </label>
      <select id={id} value={selected} onChange={(e) => change(e.target.value)} className={RETURN_SELECT}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.text}
          </option>
        ))}
      </select>
      {error ? (
        <span role="alert" className="font-semibold text-danger-fg">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The breakdown under a player: the conflict note and the market blend's line (which way it moved his projection, in
 * words, CLAUDE.md §6 step 8, with how the lean works) when he has them, my injured player's expected return week with how
 * a week of mine counts (Checkpoint 7e, item 3.5: the line, its select being on the row above: review of wave C, UI-C-5),
 * the columns phones don't show, then his week-by-week points.
 */
export function PlayerDetail({ player, showLineupCost }: { player: PlayerRow; showLineupCost: boolean }) {
  const p = player;
  return (
    <div className="rounded-xl bg-surface-muted p-3">
      {p.availabilityNote ? <p className="mb-2 text-xs leading-relaxed">{p.availabilityNote.long}.</p> : null}
      {p.returnWeek ? (
        <div className="mb-2">
          <p className="text-xs font-semibold">{p.returnWeek.text}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">{p.returnWeek.help}</p>
        </div>
      ) : null}
      {p.blend ? (
        <p className="mb-2 text-xs leading-relaxed break-words">
          <span className="font-medium">{p.blend.text}</span>
          <span className="block text-muted">{p.blend.title}</span>
        </p>
      ) : null}
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-muted">Games left</dt>
          <dd className="font-bold">{p.gamesText}</dd>
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
  const edit = useLeagueSettingsEdit();
  const p = player;
  const group = GROUP_TITLE[p.group];
  // My roster card's lock (Checkpoint 7e, item 3.3), where the League page's settings edits are: beside the button.
  const lock = p.lockable && edit !== null;
  const button = (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={detailId}
      onClick={() => setOpen((o) => !o)}
      className={
        lock ? "flex min-h-11 min-w-0 flex-1 flex-col justify-center py-1 pr-2 pl-4 text-left sm:pl-0" : "flex min-h-11 w-full flex-col justify-center py-1 pr-2 pl-4 text-left sm:pl-0"
      }
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
      {/* The return-week line below says when he's expected back (Checkpoint 7e), so the conflict note's short line goes. */}
      {p.availabilityNote && !p.returnWeek ? (
        <span title={p.availabilityNote.long} className="block pl-4 text-xs break-words text-muted italic">
          {p.availabilityNote.short}
        </span>
      ) : null}
      <span className="sr-only">, week by week</span>
    </button>
  );
  // My injured player's return line and its select (item 3.5) take a row of their own under his, so his row header stays
  // his button and lock (review of wave C, UI-C-10: inside it, the select's label and week were read with every cell).
  const returnRow = p.returnWeek !== null;
  return (
    <>
      <tr className={open || returnRow ? undefined : "border-b border-line"}>
        <th scope="row" className="p-0 text-left align-top font-normal">
          {lock ? (
            <div className="flex items-start gap-1">
              {button}
              <UntouchableLock playerId={p.id} name={p.name} className="shrink-0 pr-1 sm:pr-2" />
            </div>
          ) : (
            button
          )}
        </th>
        <td className="py-1 pr-4 text-right align-top tabular-nums sm:pr-3" title={p.weeksText}>
          <span className="block font-extrabold">{p.rosText}</span>
          <span className="block text-xs text-muted">{p.splitText}</span>
        </td>
        <td className="hidden py-2 pr-3 text-right align-top whitespace-nowrap tabular-nums sm:table-cell">{p.gamesText}</td>
        <td className="hidden py-2 pr-3 align-top md:table-cell">{p.weeks.length ? <WeekStrip weeks={p.weeks} text={p.weeksText} max={scaleMax} /> : null}</td>
        {showLineupCost ? <td className="hidden py-2 text-right align-top tabular-nums sm:table-cell">{p.lineupCost ?? <span className="text-muted">—</span>}</td> : null}
      </tr>
      {p.returnWeek ? (
        <tr className={open ? undefined : "border-b border-line"}>
          <td colSpan={columns} className="p-0">
            <ReturnWeekControl playerId={p.id} name={p.name} row={p.returnWeek} className="pr-4 pb-2 pl-8 sm:pr-0 sm:pl-4" />
          </td>
        </tr>
      ) : null}
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
  const columns = showLineupCost ? 5 : 4;
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
