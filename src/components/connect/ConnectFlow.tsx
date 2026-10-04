"use client";
/**
 * The Connect page: a platform picker plus the form for the chosen platform (CLAUDE.md §14 item 1).
 *
 * The picker is one group of native radios, styled differently by screen width. The planner's reply
 * to Checkpoint 1 asked for a compact picker on phones, so the league-link box and the Import button
 * fit on the first screen.
 * - Phones (below sm): a two-segment control (ESPN | Sleeper) with 44 px targets, and one muted line
 *   naming the platforms that are coming. The unavailable options are hidden there.
 * - From sm up: a card per platform with its note, as before. The unavailable cards are disabled and
 *   badged.
 *
 * One group (not a phone copy plus a desktop copy) keeps the same inputs, names and keyboard behavior
 * at every width. Arrow keys move between the available platforms, and turning a phone sideways
 * doesn't lose focus. The radios are visually hidden, so their label shows the keyboard focus ring.
 *
 * Phase 4c (planner reply to Checkpoint 4b, change 11): each import is saved in this browser as a new league,
 * or as an update of the same league already saved, and becomes the league shown (finishImport.ts). With
 * leagues saved already, a line under the form says so (the switcher's "Add league" opens this page).
 */
import { useState } from "react";
import { plural } from "@/lib/format";
import { useSavedLeagues } from "../league/useLeagueInputs";
import { Badge, cx } from "../ui";
import { EspnConnect } from "./EspnConnect";
import { SleeperConnect } from "./SleeperConnect";

export type PlatformChoice = "espn" | "sleeper";

type PlatformOption =
  | { id: PlatformChoice; name: string; note: string; enabled: true }
  | { id: "yahoo" | "other" | "manual"; name: string; note: string; enabled: false; badge: string; badgeTone: "warn" | "muted" };

const OPTIONS: readonly PlatformOption[] = [
  { id: "espn", name: "ESPN", note: "League link or ID", enabled: true },
  { id: "sleeper", name: "Sleeper", note: "Username or league ID", enabled: true },
  { id: "yahoo", name: "Yahoo", note: "Waiting on Yahoo's approval", enabled: false, badge: "Coming soon", badgeTone: "warn" },
  { id: "other", name: "Fleaflicker, MFL, Fantrax", note: "Fantrax: public leagues", enabled: false, badge: "Later", badgeTone: "muted" },
  { id: "manual", name: "Manual entry", note: "NFL.com, CBS and others", enabled: false, badge: "Later", badgeTone: "muted" },
];

/** What phones show instead of the unavailable cards. Keep it in step with OPTIONS. */
const COMING_LINE = "Yahoo, Fleaflicker, MFL, Fantrax and manual entry are coming.";

/** Phones: a segmented-control track around the two available platforms. From sm up: a row of five cards. */
const TRACK = "grid grid-cols-2 gap-1 rounded-xl border border-line bg-surface-muted p-1 sm:grid-cols-5 sm:gap-2 sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0";
/**
 * Every option. The radio itself is visually hidden, so the label shows the keyboard focus ring. The
 * transition leaves out outline-color, so the ring appears in gold at once, as it does everywhere else.
 */
const OPTION =
  "relative rounded-lg transition-[color,background-color,border-color] has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus";
/** Phones: a segment at least 44 px tall. */
const SEGMENT = "min-h-11 items-center justify-center px-3 text-center";
/** From sm up: a card, as before the compact phone picker. */
const CARD = "sm:min-h-20 sm:flex-col sm:items-stretch sm:justify-between sm:rounded-2xl sm:border sm:p-3 sm:text-left";
/** Selected: tinted, with a ring (a shape, not only a color change). */
const SELECTED = "bg-brand-soft ring-2 ring-brand sm:border-brand";
const UNSELECTED = "text-muted hover:text-foreground sm:border-line sm:bg-surface sm:text-foreground sm:hover:bg-surface-muted";

/** The platform radios. Presentational and hook-free: connect.test.ts calls it directly to reach the radios' onChange. */
export function PlatformPicker({ value, onChange }: { value: PlatformChoice; onChange: (platform: PlatformChoice) => void }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-bold text-muted">Platform</legend>
      <div className={TRACK}>
        {OPTIONS.map((o) => {
          const selected = o.id === value;
          return (
            <label
              key={o.id}
              className={cx(OPTION, SEGMENT, CARD, o.enabled ? "flex cursor-pointer" : "hidden cursor-not-allowed opacity-60 sm:flex", selected ? SELECTED : UNSELECTED)}
            >
              <input
                type="radio"
                name="platform"
                value={o.id}
                checked={selected}
                disabled={!o.enabled}
                onChange={() => {
                  if (o.enabled) onChange(o.id);
                }}
                className="sr-only"
              />
              <span className="font-extrabold leading-tight">{o.name}</span>
              {/* On phones the segment is just the name; the note returns with the cards. */}
              <span className={cx("mt-1 text-xs text-muted", o.enabled && "hidden sm:block")}>{o.note}</span>
              {o.enabled ? null : (
                <Badge tone={o.badgeTone} className="mt-2 self-start">
                  {o.badge}
                </Badge>
              )}
            </label>
          );
        })}
      </div>
      <p className="mt-2 text-sm text-muted sm:hidden">{COMING_LINE}</p>
    </fieldset>
  );
}

/**
 * What the page says when leagues are saved in this browser already (Phase 4c, planner reply to Checkpoint 4b, change
 * 11): another import joins them, or updates the saved copy of the same league (pure; null with none saved).
 */
export function savedLeaguesNote(count: number): string | null {
  if (!count) return null;
  return `You have ${plural(count, "league")} saved in this browser. A league you import joins ${count === 1 ? "it" : "them"} (or updates its saved copy) and shows right away; switch leagues at the top of any page.`;
}

export function ConnectFlow() {
  const [platform, setPlatform] = useState<PlatformChoice>("espn");
  const saved = useSavedLeagues();
  const note = savedLeaguesNote(saved?.leagues.length ?? 0);

  return (
    <div className="space-y-4 sm:space-y-6">
      <PlatformPicker value={platform} onChange={setPlatform} />
      {platform === "espn" ? <EspnConnect /> : <SleeperConnect />}
      {/* Under the form, so on a phone the league box and the Import button stay on the first screen (§14 item 1). */}
      {note ? <p className="max-w-2xl text-sm text-muted">{note}</p> : null}
    </div>
  );
}
