"use client";
/**
 * ESPN connect flow (CLAUDE.md §14 "How users connect ESPN leagues"):
 * 1. Paste the league link or ID. A league viewable to the public imports right away.
 * 2. A private league shows two choices: ask the commissioner to make it viewable, or connect with
 *    the ESPN cookies on a computer (kept only in this browser session).
 *
 * Results appear below the form, which on a phone is below the fold, so an error or the
 * private-league options are scrolled into view and focused (reveal.ts). A team from a pasted team
 * link isn't sent as "my team": ESPN uses the same kind of link for every team's page, so it's kept
 * in the browser as a pick the user confirms on the Import Report (finishImport).
 */
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { callApi, isApiError, type EspnSessionStatus, type ImportResponse } from "@/lib/api";
import { parseEspnLeagueInput } from "@/lib/espnLink";
import type { AppErrorCode } from "@/lib/errors";
import { defaultSeason, newestSeason, seasonFromLink } from "@/lib/season";
import { revealResult } from "../reveal";
import { Badge, Callout, Card, CardTitle, FOCUS_TARGET, Spinner, buttonClass, cx, inputClass } from "../ui";
import { EspnPrivateLeague } from "./EspnPrivateLeague";
import { finishImport } from "./finishImport";
import { SeasonSelect } from "./SeasonSelect";

const LOADING_TEXT = "Importing from ESPN… The first import can take up to a minute while we load the player database.";
const ESPN_COOKIES_FORGOTTEN = "Done. Your ESPN cookies are gone from this browser session.";

type ImportError = { code: AppErrorCode; message: string };
/** What to bring into view after an action: the field that needs fixing, the error, the private-league options, or the "cookies are gone" line. */
type Reveal = { n: number; target: "input" | "error" | "private" | "forget" };

const isPrivateError = (e: ImportError | null) => e?.code === "PRIVATE_LEAGUE" || e?.code === "BAD_CREDENTIALS";

export function EspnConnect() {
  const router = useRouter();
  const [now] = useState(() => new Date());
  const newest = newestSeason(now);
  const [input, setInput] = useState("");
  const [seasonField, setSeasonField] = useState(() => defaultSeason(now));
  const [showInputError, setShowInputError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ImportError | null>(null);
  const [session, setSession] = useState<EspnSessionStatus | null>(null);
  const [forgetNote, setForgetNote] = useState<string | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const privateRef = useRef<HTMLDivElement>(null);
  const privateAlertRef = useRef<HTMLDivElement>(null);
  const forgetRef = useRef<HTMLParagraphElement>(null);

  const parsed = useMemo(() => parseEspnLeagueInput(input), [input]);
  // A link's season locks the picker only when Offer Sheet can import it; otherwise a note says so.
  const fromLink = seasonFromLink(parsed.ok ? parsed.season : undefined, now);
  const lockedSeason = fromLink.season;
  const season = lockedSeason ?? seasonField;
  const seasonNote = fromLink.note ?? null;
  const privateLeague = isPrivateError(error);
  const inputError = !parsed.ok && (showInputError || (input.trim().length > 6 && parsed.reason !== "no-league-id")) ? parsed.message : null;

  useEffect(() => {
    let cancelled = false;
    void callApi<EspnSessionStatus>("/api/session/espn", { method: "GET" }).then((res) => {
      if (!cancelled && !isApiError(res)) setSession(res);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!reveal) return;
    if (reveal.target === "input") revealResult(inputRef.current);
    else if (reveal.target === "private") revealResult(privateRef.current, privateAlertRef.current);
    else if (reveal.target === "error") revealResult(errorRef.current);
    else revealResult(forgetRef.current);
  }, [reveal]);

  const revealNext = (target: Reveal["target"]) => setReveal((r) => ({ n: (r?.n ?? 0) + 1, target }));

  async function runImport() {
    if (!parsed.ok) {
      // After the render that ties the message to the field (aria-describedby), so it's read on focus.
      setShowInputError(true);
      revealNext("input");
      return;
    }
    const leagueId = parsed.leagueId;
    setBusy(true);
    setError(null);
    const res = await callApi<ImportResponse>("/api/import/espn", { method: "POST", body: { leagueId, season } });
    if (isApiError(res)) {
      setBusy(false);
      setError(res.error);
      revealNext(isPrivateError(res.error) ? "private" : "error");
      return;
    }
    const saved = finishImport({ platform: "espn", season, leagueId }, res, parsed.teamId);
    if (!saved.ok) {
      setBusy(false);
      setError({ code: "INTERNAL", message: saved.message });
      revealNext("error");
      return;
    }
    router.push("/import");
  }

  /** "Forget my credentials". Its status line lives here, so it stays when the cookies panel goes away. */
  async function forgetCookies() {
    setForgetNote(null);
    const res = await callApi<EspnSessionStatus>("/api/session/espn", { method: "DELETE" });
    if (isApiError(res)) setForgetNote(res.error.message);
    else {
      setSession(res);
      setForgetNote(ESPN_COOKIES_FORGOTTEN);
    }
    revealNext("forget");
  }

  return (
    <div>
      <Card>
        <CardTitle eyebrow="ESPN">Paste your league link</CardTitle>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void runImport();
          }}
        >
          <div>
            <label htmlFor="espn-league" className="mb-1 block text-sm font-bold">
              League link or ID
            </label>
            <input
              ref={inputRef}
              id="espn-league"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="https://fantasy.espn.com/football/league?leagueId=…"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setShowInputError(false);
              }}
              aria-invalid={inputError ? true : undefined}
              aria-describedby={cx("espn-league-help", inputError && "espn-league-error", seasonNote && "espn-season-note")}
              className={inputClass}
            />
            <p id="espn-league-help" className="mt-1.5 text-sm text-muted">
              On fantasy.espn.com, open your league and copy the address from the address bar. Just the league ID works too.
            </p>
            {/* Always mounted, so what the field understood (or why not) is announced as it changes. */}
            <div aria-live="polite">
              {parsed.ok ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge tone="brand">League {parsed.leagueId}</Badge>
                  {lockedSeason ? <Badge tone="muted">Season {lockedSeason} from your link</Badge> : null}
                  {parsed.teamId ? <Badge tone="muted">Team {parsed.teamId} from your link</Badge> : null}
                </div>
              ) : inputError ? (
                <p id="espn-league-error" className="mt-2 text-sm font-semibold text-danger-fg">
                  {inputError}
                </p>
              ) : null}
              {seasonNote ? (
                <p id="espn-season-note" className="mt-2 text-sm font-semibold text-warn-fg">
                  {seasonNote}
                </p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-[12rem_1fr] sm:items-end">
            <div>
              <label htmlFor="espn-season" className="mb-1 block text-sm font-bold">
                Season
              </label>
              <SeasonSelect
                id="espn-season"
                value={season}
                newest={newest}
                onChange={setSeasonField}
                disabled={lockedSeason !== undefined}
                describedBy={seasonNote ? "espn-season-note" : undefined}
              />
            </div>
            <button type="submit" className={buttonClass("primary")} disabled={busy}>
              {busy ? <Spinner /> : null}
              {busy ? "Importing…" : "Import league"}
            </button>
          </div>
        </form>
        <p className={busy ? "mt-4 text-sm text-muted" : undefined} aria-live="polite">
          {busy ? LOADING_TEXT : null}
        </p>

        {session?.connected ? (
          <div className="mt-4">
            <Callout tone="ok">Your ESPN cookies are saved for this browser session, so private leagues you belong to will import too.</Callout>
          </div>
        ) : null}
        {/* Always mounted: "Forget my credentials" removes the panel its button sits in. */}
        <p ref={forgetRef} role="status" tabIndex={FOCUS_TARGET.tabIndex} className={cx(FOCUS_TARGET.className, forgetNote && "mt-4 text-sm font-semibold")}>
          {forgetNote}
        </p>
      </Card>

      {error && !privateLeague ? (
        <div ref={errorRef} tabIndex={FOCUS_TARGET.tabIndex} className={cx("mt-4 rounded-xl", FOCUS_TARGET.className)}>
          <Callout tone="danger" title="That didn't work">
            <p>{error.message}</p>
            {error.code === "LEAGUE_NOT_FOUND" ? <p className="mt-1">Check the league ID and the season. A league that hasn&apos;t been renewed for this season won&apos;t show up yet.</p> : null}
          </Callout>
        </div>
      ) : null}

      {privateLeague || session?.connected ? (
        <div ref={privateRef} className={cx("mt-4", FOCUS_TARGET.className)}>
          <EspnPrivateLeague
            error={privateLeague ? error : null}
            session={session}
            onSessionChange={(s) => {
              setSession(s);
              if (s.connected) setForgetNote(null);
            }}
            onCookiesSaved={() => {
              void runImport();
            }}
            onForget={() => {
              void forgetCookies();
            }}
            busy={busy}
            alertRef={privateAlertRef}
          />
        </div>
      ) : null}
    </div>
  );
}
