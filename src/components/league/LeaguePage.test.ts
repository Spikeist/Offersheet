/**
 * The League page container's states, rendered statically (no DOM, first render only): reading
 * storage, fetching inputs, computing, a failure with Try again, and the ready page, all in one frame
 * whose status line (role="status") stays at the same place in the tree, so React keeps that element
 * and every change of state is announced (CLAUDE.md §14 item 3). Nothing is aria-busy.
 */
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "@/engine/config";
import { fmtWhole } from "@/lib/format";
import { IMPORT_FORMAT_VERSION, type StoredImport } from "@/lib/importStore";
import { buildLeagueView } from "@/lib/leagueView";
import { LeagueError, LeagueFrame, LeaguePage, READY_TEXT, UPDATED_TEXT, UPDATING_TEXT, joinInputsRequest, type LeagueFrameState } from "./LeaguePage";
import { NOW, leagueFixture } from "./testFixtures";

const f = leagueFixture();
const view = buildLeagueView({ ...f, myTeamSource: "platform", timeZone: "America/Chicago", now: NOW });
const noop = () => {};
const refresh = { onRefresh: noop, refreshing: false, error: null, status: null };

const STATES: Record<string, LeagueFrameState> = {
  loading: { kind: "loading" },
  fetching: { kind: "fetching" },
  computing: { kind: "computing" },
  error: { kind: "error", message: "ESPN isn't responding right now.", onRetry: noop },
  ready: { kind: "ready", view, updating: false, readyText: READY_TEXT, refresh },
  updating: { kind: "ready", view, updating: true, readyText: UPDATED_TEXT, refresh: { ...refresh, refreshing: true, status: "Refreshed: new league data from 3:55 PM." } },
};

const render = (state: LeagueFrameState) => renderToStaticMarkup(createElement(LeagueFrame, { state, leagueName: "The Gloopdorf Invitational" }));

/** The status line's element and text (it's the only role="status" outside the ready page's header). */
function statusOf(html: string): { tag: string; text: string } | null {
  const m = /<p role="status" tabindex="-1" class="([^"]*)">(.*?)<\/p>/.exec(html);
  return m ? { tag: m[1] ?? "", text: (m[2] ?? "").replace(/<[^>]+>/g, "").trim() } : null;
}

describe("LeagueFrame: one status line through every state", () => {
  it("keeps the status line at the same slot of the same frame in every state, so React keeps the element and announces each change", () => {
    const slots = Object.values(STATES).map((state) => {
      const frame = LeagueFrame({ state, leagueName: "The Gloopdorf Invitational" }) as ReactElement<{ children: ReactNode[] }>;
      expect(frame.type).toBe("div");
      return frame.props.children.findIndex((c) => isValidElement(c) && (c.props as { role?: string }).role === "status");
    });
    expect(slots).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it("says what the page is waiting for, then that it's ready", () => {
    const text = Object.fromEntries(Object.entries(STATES).map(([k, s]) => [k, statusOf(render(s))?.text]));
    expect(text).toEqual({
      loading: "Loading your league…",
      fetching: "Loading projections…",
      computing: "Crunching the numbers…",
      error: "",
      ready: READY_TEXT,
      updating: UPDATING_TEXT,
    });
    // Visible with a spinner while waiting or updating; screen readers only otherwise.
    expect(statusOf(render(STATES.fetching as LeagueFrameState))?.tag).toContain("flex");
    expect(statusOf(render(STATES.updating as LeagueFrameState))?.tag).toContain("flex");
    expect(statusOf(render(STATES.ready as LeagueFrameState))?.tag).toContain("sr-only");
    expect(statusOf(render(STATES.error as LeagueFrameState))?.tag).toContain("sr-only");
    expect(render(STATES.fetching as LeagueFrameState)).toMatch(/<p role="status"[^>]*><span aria-hidden="true"[^>]*><\/span> Loading projections…<\/p>/);
  });

  it("says what the wait is for, under the league's name", () => {
    const fetching = render(STATES.fetching as LeagueFrameState);
    expect(fetching).toContain("The Gloopdorf Invitational");
    expect(fetching).toContain("The first load of the day can take half a minute.");
    expect(render(STATES.computing as LeagueFrameState)).toContain(`and ${fmtWhole(config.simulation.finalSims)} simulated seasons for the playoff odds. This runs in your browser`);
  });

  it("never marks anything aria-busy, which would hold back the status lines it wraps", () => {
    for (const state of Object.values(STATES)) expect(render(state)).not.toContain("aria-busy");
    // The updating page dims the numbers and says so in the status line; the Refresh outcome is a live region too.
    const updating = render(STATES.updating as LeagueFrameState);
    expect(updating).toMatch(/<div class="transition-opacity opacity-60">/);
    expect(updating.match(/role="status"/g)).toHaveLength(2);
    expect(updating).toContain("Refreshed: new league data from 3:55 PM.");
  });

  it("shows a failure as an alert, with Try again and a way back", () => {
    const html = render(STATES.error as LeagueFrameState);
    expect(html).toMatch(/role="alert"[^>]*>.*We couldn&#x27;t build your League page.*ESPN isn&#x27;t responding right now\./);
    expect(html).toMatch(/<button type="button" class="[^"]*min-h-11[^"]*">Try again<\/button>/);
    expect(html).toContain('href="/import"');
    // The error block itself owns no status line: the frame's is the one.
    expect(renderToStaticMarkup(createElement(LeagueError, { message: "x", onRetry: noop }))).not.toContain('role="status"');
  });

  it("gives the ready page's heading a way to take focus after a Try again", () => {
    const html = renderToStaticMarkup(createElement(LeagueFrame, { state: { ...(STATES.ready as Extract<LeagueFrameState, { kind: "ready" }>), headingRef: { current: null } } }));
    expect(html).toMatch(/<h1 tabindex="-1" class="[^"]*">The Gloopdorf Invitational<\/h1>/);
    // Without a ref the heading isn't focusable.
    expect(render(STATES.ready as LeagueFrameState)).toMatch(/<h1 class="[^"]*">The Gloopdorf Invitational<\/h1>/);
  });
});

describe("LeaguePage", () => {
  it("renders the frame's loading status on the server, before it can read this tab's storage", () => {
    const html = renderToStaticMarkup(createElement(LeaguePage));
    expect(html).toMatch(/<p role="status" tabindex="-1"[^>]*><span aria-hidden="true"[^>]*><\/span> Loading your league…<\/p>/);
  });
});

describe("joinInputsRequest: one model request per page load", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const stored = (leagueId = "4242"): StoredImport => {
    const snapshot = { ...f.snapshot, leagueId };
    return { version: IMPORT_FORMAT_VERSION, savedAt: NOW, request: { platform: "espn", season: 2026, leagueId }, response: { snapshot, notes: [] } };
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));

  /** A fetch that records its calls and answers only when told to. */
  function fakeFetch() {
    const calls: { url: string; init: RequestInit; answer: (body: unknown) => void }[] = [];
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => new Promise<Response>((resolve) => calls.push({ url, init, answer: (body) => resolve(new Response(JSON.stringify(body), { status: 200 })) })));
    return calls;
  }

  it("sends one POST through React StrictMode's mount → unmount → mount, and the remount gets the answer", async () => {
    const calls = fakeFetch();
    const first = joinInputsRequest(stored());
    first.leave(); // StrictMode's simulated unmount, then the remount in the same tick
    const second = joinInputsRequest(stored());
    await tick();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/api/model/espn");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ leagueId: "4242", season: 2026 });
    expect(calls[0]?.init.signal?.aborted).toBe(false);
    calls[0]?.answer({ import: { snapshot: f.snapshot, notes: [] }, model: f.inputs });
    await expect(second.promise).resolves.toMatchObject({ ok: true });
    second.leave();
  });

  it("aborts the request once the page is gone, and a later page load asks again", async () => {
    const calls = fakeFetch();
    const page = joinInputsRequest(stored("5151"));
    page.leave();
    await tick();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.signal?.aborted).toBe(true);
    const again = joinInputsRequest(stored("5151"));
    expect(calls).toHaveLength(2);
    expect(calls[1]?.init.signal?.aborted).toBe(false);
    again.leave();
    await tick();
  });
});
