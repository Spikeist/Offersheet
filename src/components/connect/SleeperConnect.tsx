"use client";
/**
 * Sleeper connect flow: a username (then pick a league if there are several), or a league ID or
 * link with an optional username so we can find the user's team. A sleeper.com league link typed
 * into the username box switches to League ID and imports that league.
 *
 * Results appear below the form, which on a phone is below the fold, so an error or the league list
 * is scrolled into view and focused (reveal.ts).
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { callApi, isApiError, isChooseLeague, type ImportResponse, type SleeperChooseLeagueResponse } from "@/lib/api";
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
import { revealResult } from "../reveal";
import { Callout, Card, CardTitle, FOCUS_TARGET, Spinner, buttonClass, cx, inputClass } from "../ui";
import { finishImport } from "./finishImport";
import { SeasonSelect } from "./SeasonSelect";
import { SleeperLeagueChoices } from "./SleeperLeagueChoices";

type Mode = SleeperInputMode;
type Choices = SleeperChooseLeagueResponse["chooseLeague"];
type FormError = SleeperFormError;
type Reveal = { n: number; target: "error" | "choices" };

const ERROR_ID = "sleeper-error";
const LINK_SWITCH_NOTE = "That's a league link, so we switched to League ID.";

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
  const [note, setNote] = useState<string | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const choicesRef = useRef<HTMLDivElement>(null);
  const choicesHeadingRef = useRef<HTMLHeadingElement>(null);

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

  async function submit(chooseLeagueId?: string) {
    setError(null);
    let currentMode = mode;
    let userText = username;
    let leagueText = leagueInput;
    if (!chooseLeagueId) {
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
    }
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
    const body = { season, ...(name ? { username: name } : {}), ...(leagueId ? { leagueId } : {}), ...(chooseLeagueId ? { chooseLeagueId } : {}) };
    const res = await callApi<ImportResponse | SleeperChooseLeagueResponse>("/api/import/sleeper", { method: "POST", body });
    if (isApiError(res)) {
      setBusy(false);
      fail(sleeperServerError(res.error, currentMode));
      return;
    }
    if (isChooseLeague(res)) {
      setBusy(false);
      setChoices(res.chooseLeague);
      revealNext("choices");
      return;
    }
    const saved = finishImport({ platform: "sleeper", season, leagueId: res.snapshot.leagueId, ...(name ? { username: name } : {}) }, res);
    if (!saved.ok) {
      setBusy(false);
      fail({ message: saved.message });
      return;
    }
    router.push("/import");
  }

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
            <button type="submit" className={buttonClass("primary")} disabled={busy}>
              {busy ? <Spinner /> : null}
              {busy ? "Working…" : mode === "username" ? "Find my leagues" : "Import league"}
            </button>
          </div>
        </form>
        <p className={busy ? "mt-4 text-sm text-muted" : undefined} aria-live="polite">
          {busy ? "Talking to Sleeper… The first import can take up to a minute while we load the player database." : null}
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
        <div ref={choicesRef} className={cx("mt-4", FOCUS_TARGET.className)}>
          <SleeperLeagueChoices choices={choices} busy={busy} onPick={(id) => void submit(id)} headingRef={choicesHeadingRef} />
        </div>
      ) : null}
    </div>
  );
}
