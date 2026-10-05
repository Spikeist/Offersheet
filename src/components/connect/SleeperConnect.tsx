"use client";
/**
 * Sleeper connect flow: a username (then pick one or more leagues if there are several), or a league ID
 * or link with an optional username so we can find the user's team. A sleeper.com league link typed
 * into the username box switches to League ID and imports that league.
 *
 * Every league imported is saved in this browser (finishImport.ts: src/lib/leagueStore.ts; Phase 4c,
 * planner reply to Checkpoint 4b, change 11). Several picked from the username's list are imported one
 * after another (politely: one request at a time; sleeperBatch.ts), the status line saying which one is
 * under way and each league saying how it went; the first one imported becomes the league this tab shows.
 * When they all import, the Import Report opens; when some don't, the page stays, says why under each, and
 * links to the Import Report for the ones that did. ⚠️ Leaving the page mid-batch (review of track ML) stops
 * it after the league under way, which is saved without switching the tab's league, and nothing navigates;
 * opened again while that league finishes, the page says so and its buttons wait, then says how it ended.
 *
 * Results appear below the form, which on a phone is below the fold, so an error or the league list
 * is scrolled into view and focused (reveal.ts).
 *
 * Part B (planner reply to Checkpoint 4c, B1: browser fetching; track BF): this browser reads Sleeper itself, the
 * username's leagues included (Offer Sheet hears nothing until a league is picked), and sends Offer Sheet only what it
 * needs (src/lib/leagueFetch.ts importLeague); when it can't reach Sleeper, Offer Sheet's server reads it, as before.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { isApiError, isChooseLeague, type SleeperChooseLeagueResponse } from "@/lib/api";
import { importLeague } from "@/lib/leagueFetch";
import { savedLeagueId } from "@/lib/leagueStore";
import { defaultSeason, newestSeason } from "@/lib/season";
import {
  SLEEPER_LEAGUE_ID_HINT,
  SLEEPER_USERNAME_INVALID,
  normalizeSleeperUsername,
  parseSleeperLeagueInput,
  sleeperLeagueLinkId,
  sleeperServerError,
  type SleeperFormError,
  type SleeperInputMode,
} from "@/lib/sleeperInput";
import { useSavedLeagues } from "../league/useLeagueInputs";
import { revealResult } from "../reveal";
import { Callout, Card, CardTitle, FOCUS_TARGET, Spinner, buttonClass, cx, inputClass } from "../ui";
import { finishImport } from "./finishImport";
import { SeasonSelect } from "./SeasonSelect";
import { BATCH_RUNNING_TEXT, detachedText, runSleeperBatch, useSleeperBatch, type BatchOutcome } from "./sleeperBatch";
import { SleeperLeagueChoices, type LeagueImportState } from "./SleeperLeagueChoices";

type Mode = SleeperInputMode;
type Choices = SleeperChooseLeagueResponse["chooseLeague"];
type FormError = SleeperFormError;
type Reveal = { n: number; target: "error" | "choices" };

const ERROR_ID = "sleeper-error";
const LINK_SWITCH_NOTE = "That's a league link, so we switched to League ID.";
const NOT_SENT = "Sleeper didn't send that league. Try again in a moment.";
const TALKING_TO_SLEEPER = "Talking to Sleeper… The first import can take up to a minute while we load the player database.";

/** What the status line says once a batch is done and some leagues didn't import (pure; all imported: the Import Report opens). */
export function batchOutcomeText(imported: number, total: number): string {
  if (!imported) return total === 1 ? "That league didn't import: see why below." : `None of the ${total} leagues imported: see why under each.`;
  return `Imported ${imported} of ${total} leagues. See why the others didn't under each.`;
}

/**
 * Imports one league of a username's list and saves it; `makeCurrent()`, asked once the league is in, says whether it
 * becomes the league this tab shows (not once the page that asked for it is gone: sleeperBatch.ts).
 */
async function importChosen(leagueId: string, username: string, season: number, makeCurrent: () => boolean): Promise<BatchOutcome> {
  const res = await importLeague({ platform: "sleeper", body: { season, username, chooseLeagueId: leagueId } });
  if (isApiError(res)) return { ok: false, message: res.error.message };
  if (isChooseLeague(res) || !("snapshot" in res)) return { ok: false, message: NOT_SENT };
  const saved = await finishImport({ platform: "sleeper", season, leagueId: res.snapshot.leagueId, username }, res, undefined, { makeCurrent: makeCurrent() });
  return saved.ok ? { ok: true } : { ok: false, message: saved.message };
}

export function SleeperConnect() {
  const router = useRouter();
  const [now] = useState(() => new Date());
  const newest = newestSeason(now);
  const [mode, setMode] = useState<Mode>("username");
  const [username, setUsername] = useState("");
  const [leagueInput, setLeagueInput] = useState("");
  const [season, setSeason] = useState(() => defaultSeason(now));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const [choices, setChoices] = useState<Choices | null>(null);
  // The batch of leagues picked from the list: each one's import, and what the status line says about it.
  const [results, setResults] = useState<Record<string, LeagueImportState>>({});
  const [batchNote, setBatchNote] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const savedLeagues = useSavedLeagues();
  // The listed leagues already saved in this browser (by their Sleeper id), so the list can say so.
  const saved = useMemo(() => {
    const ids = new Set(savedLeagues?.leagues.map((l) => l.id) ?? []);
    return new Set(choices?.leagues.filter((l) => ids.has(savedLeagueId({ platform: "sleeper", leagueId: l.id, season: choices.season }))).map((l) => l.id) ?? []);
  }, [savedLeagues, choices]);
  const errorRef = useRef<HTMLDivElement>(null);
  const choicesRef = useRef<HTMLDivElement>(null);
  const choicesHeadingRef = useRef<HTMLHeadingElement>(null);
  // A batch under way, this page's or one started before the page was left and opened again (sleeperBatch.ts): the
  // page's Sleeper requests wait for it.
  const batch = useSleeperBatch();
  const working = busy || batch.running;
  // The page is open (a batch it started stops, and doesn't navigate, once it's gone).
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    if (!reveal) return;
    if (reveal.target === "choices") revealResult(choicesRef.current, choicesHeadingRef.current);
    else revealResult(errorRef.current);
  }, [reveal]);

  const revealNext = (target: Reveal["target"]) => setReveal((r) => ({ n: (r?.n ?? 0) + 1, target }));
  const fail = (e: FormError) => {
    setError(e);
    revealNext("error");
  };

  async function submit() {
    if (working) return;
    setError(null);
    let currentMode = mode;
    let userText = username;
    let leagueText = leagueInput;
    // A league link pasted into the username box: import that league instead of failing.
    const linkId = currentMode === "username" ? sleeperLeagueLinkId(userText) : undefined;
    if (linkId) {
      currentMode = "league";
      leagueText = userText.trim();
      userText = "";
      setMode("league");
      setLeagueInput(leagueText);
      setUsername("");
      setNote(LINK_SWITCH_NOTE);
    } else setNote(null);
    const name = userText.trim() ? normalizeSleeperUsername(userText) : undefined;
    if (userText.trim() && !name) {
      fail({ message: currentMode === "username" ? `${SLEEPER_USERNAME_INVALID} ${SLEEPER_LEAGUE_ID_HINT}` : SLEEPER_USERNAME_INVALID, field: "username" });
      return;
    }
    let leagueId: string | undefined;
    if (currentMode === "league") {
      const parsed = parseSleeperLeagueInput(leagueText);
      if (!parsed.ok) {
        fail({ message: parsed.message, field: "league" });
        return;
      }
      leagueId = parsed.leagueId;
    } else if (!name) {
      fail({ message: "Enter your Sleeper username.", field: "username" });
      return;
    }
    setBusy(true);
    const body = { season, ...(name ? { username: name } : {}), ...(leagueId ? { leagueId } : {}) };
    const res = await importLeague({ platform: "sleeper", body });
    if (isApiError(res)) {
      setBusy(false);
      fail(sleeperServerError(res.error, currentMode));
      return;
    }
    if (isChooseLeague(res)) {
      setBusy(false);
      setResults({});
      setBatchNote(null);
      setChoices(res.chooseLeague);
      revealNext("choices");
      return;
    }
    const saved = await finishImport({ platform: "sleeper", season, leagueId: res.snapshot.leagueId, ...(name ? { username: name } : {}) }, res);
    if (!saved.ok) {
      setBusy(false);
      fail({ message: saved.message });
      return;
    }
    router.push("/import");
  }

  /** The leagues picked from the username's list, one after another (see the header; sleeperBatch.ts). */
  async function importPicked(ids: readonly string[]) {
    if (!choices || working || !ids.length) return;
    const { username: user, season: listSeason } = choices;
    const names = new Map(choices.leagues.map((l) => [l.id, l.name]));
    setBusy(true);
    setError(null);
    setResults(Object.fromEntries(ids.map((id) => [id, { kind: "waiting" } as LeagueImportState])));
    const done = await runSleeperBatch(ids, {
      attached: () => live.current,
      // The first one imported becomes the league this tab shows (while this page is open); the others are saved next to it.
      importOne: (id, makeCurrent) => importChosen(id, user, listSeason, makeCurrent),
      onStart: (id, i) => {
        setResults((r) => ({ ...r, [id]: { kind: "importing" } }));
        setBatchNote(`Importing ${i + 1} of ${ids.length}: ${names.get(id) ?? "a league"}…`);
      },
      onEnd: (id, outcome) => setResults((r) => ({ ...r, [id]: outcome.ok ? { kind: "done" } : { kind: "failed", message: outcome.message } })),
    });
    // The page was left meanwhile: nothing to show here, and nowhere to go.
    if (!live.current) return;
    setBusy(false);
    // (null: another batch was under way; the buttons wait for it, so this doesn't happen.)
    if (!done) return;
    if (done.imported === ids.length) {
      setBatchNote(`Imported ${ids.length === 1 ? "the league" : `all ${ids.length} leagues`}. Opening the Import Report…`);
      router.push("/import");
      return;
    }
    setBatchNote(batchOutcomeText(done.imported, ids.length));
  }

  // Under the form: talking to Sleeper; else a batch from before the page was left, finishing or how it ended.
  const formNote = busy && !choices ? TALKING_TO_SLEEPER : !busy && batch.running ? BATCH_RUNNING_TEXT : !busy && !choices && batch.detached ? detachedText(batch.detached) : null;

  const importedSome = Object.values(results).some((r) => r.kind === "done");

  const invalid = (field: "username" | "league") => error?.field === field;

  return (
    <div>
      <Card>
        <CardTitle eyebrow="Sleeper">Find your league</CardTitle>
        <div role="group" aria-label="How to find your league" className="mb-4 inline-flex rounded-xl border border-line bg-surface-muted p-1">
          {(["username", "league"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => {
                setMode(m);
                setError(null);
                setChoices(null);
                setNote(null);
              }}
              className={cx("min-h-11 rounded-lg px-3 text-sm font-bold", mode === m ? "bg-surface text-foreground shadow-sm" : "text-muted")}
            >
              {m === "username" ? "Username" : "League ID"}
            </button>
          ))}
        </div>
        <p role="status" className={note ? "mb-4 text-sm font-semibold text-ok-fg" : undefined}>
          {note}
        </p>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setChoices(null);
            void submit();
          }}
        >
          {mode === "league" ? (
            <div>
              <label htmlFor="sleeper-league" className="mb-1 block text-sm font-bold">
                League ID or link
              </label>
              <input
                id="sleeper-league"
                inputMode="url"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="https://sleeper.com/leagues/…"
                value={leagueInput}
                onChange={(e) => setLeagueInput(e.target.value)}
                aria-invalid={invalid("league") || undefined}
                aria-describedby={cx("sleeper-league-help", invalid("league") && ERROR_ID)}
                className={inputClass}
              />
              <p id="sleeper-league-help" className="mt-1.5 text-sm text-muted">
                It&apos;s the long number in your league&apos;s web address on sleeper.com.
              </p>
            </div>
          ) : null}

          <div>
            <label htmlFor="sleeper-username" className="mb-1 block text-sm font-bold">
              {mode === "username" ? "Sleeper username" : "Your Sleeper username (optional)"}
            </label>
            <input
              id="sleeper-username"
              autoComplete="username"
              autoCapitalize="off"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              aria-invalid={invalid("username") || undefined}
              aria-describedby={cx("sleeper-username-help", invalid("username") && ERROR_ID)}
              className={inputClass}
            />
            <p id="sleeper-username-help" className="mt-1.5 text-sm text-muted">
              {mode === "username" ? "Your username, not your display name or team name. We'll list your leagues." : "Lets us find your team. You can also pick it on the next page."}
            </p>
          </div>

          {/* Season and the button side by side at every width, as in the ESPN form. */}
          <div className="grid grid-cols-[minmax(0,7rem)_1fr] items-end gap-4 sm:grid-cols-[12rem_1fr]">
            <div>
              <label htmlFor="sleeper-season" className="mb-1 block text-sm font-bold">
                Season
              </label>
              <SeasonSelect id="sleeper-season" value={season} newest={newest} onChange={setSeason} />
            </div>
            <button type="submit" className={buttonClass("primary")} disabled={working}>
              {working ? <Spinner /> : null}
              {working ? "Working…" : mode === "username" ? "Find my leagues" : "Import league"}
            </button>
          </div>
        </form>
        <p className={formNote ? "mt-4 text-sm text-muted" : undefined} aria-live="polite">
          {formNote}
        </p>
      </Card>

      {error ? (
        <div ref={errorRef} tabIndex={FOCUS_TARGET.tabIndex} className={cx("mt-4 rounded-xl", FOCUS_TARGET.className)}>
          <Callout id={ERROR_ID} tone="danger" title="That didn't work">
            {error.message}
          </Callout>
        </div>
      ) : null}

      {choices ? (
        <div ref={choicesRef} className={cx("mt-4 space-y-3", FOCUS_TARGET.className)}>
          <SleeperLeagueChoices choices={choices} busy={working} saved={saved} results={results} onImport={(ids) => void importPicked(ids)} headingRef={choicesHeadingRef} />
          {/* Always mounted while the list shows, so each league's import is announced. */}
          <p role="status" className={batchNote ? "text-sm font-semibold" : "sr-only"}>
            {batchNote ?? ""}
          </p>
          {importedSome && !busy ? (
            <Link href="/import" className={buttonClass("secondary")}>
              See the Import Report
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
