import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { LeagueImportError } from "@/adapters/types";
import { busyResponse, dataSourceStamps, importErrorResponse, isSameOrigin, readJsonBody, scrubSwids, workRefusedResponse } from "./respond";
import { fakeResolver } from "./testFakes";

const URL = "http://localhost:3000/api/x";
const schema = z.object({ a: z.string().regex(/^\d+$/, "A must be digits.") });

function post(body: BodyInit, headers: Record<string, string> = {}): Request {
  return new Request(URL, { method: "POST", body, headers: { "content-type": "application/json", ...headers } });
}

describe("readJsonBody", () => {
  it("parses and validates, with the schema's own message", async () => {
    expect(await readJsonBody(post(JSON.stringify({ a: "12", extra: true })), schema)).toEqual({ ok: true, data: { a: "12" } });
    expect(await readJsonBody(post(JSON.stringify({ a: "x" })), schema)).toEqual({ ok: false, message: "A must be digits." });
    expect(await readJsonBody(post("{not json"), schema)).toEqual({ ok: false, message: "That request wasn't valid JSON." });
    expect(await readJsonBody(post(JSON.stringify({})), schema)).toEqual({ ok: false, message: 'The "a" field isn\'t valid.' });
  });

  it("refuses big bodies without reading them all", async () => {
    expect(await readJsonBody(post(JSON.stringify({ a: "1".repeat(20_000) })), schema)).toEqual({ ok: false, message: "That request is too large." });
    // A streamed body with no Content-Length is cut off as soon as it passes the cap.
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(8192).fill(49));
        if (pulled > 1000) controller.close();
      },
    });
    const req = new Request(URL, { method: "POST", body: stream, headers: { "content-type": "application/json" }, duplex: "half" } as RequestInit & { duplex: "half" });
    expect(await readJsonBody(req, schema)).toEqual({ ok: false, message: "That request is too large." });
    expect(pulled).toBeLessThan(10);
  });

  it("refuses bodies not sent as JSON (a cross-site form or text/plain post), without reading them", async () => {
    const asText = new Request(URL, { method: "POST", body: JSON.stringify({ a: "12" }), headers: { "content-type": "text/plain;charset=UTF-8" } });
    expect(await readJsonBody(asText, schema)).toEqual({ ok: false, message: "That request wasn't sent as JSON." });
    expect(asText.bodyUsed).toBe(false);
    const asForm = new Request(URL, { method: "POST", body: "a=12", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect((await readJsonBody(asForm, schema)).ok).toBe(false);
    const none = new Request(URL, { method: "POST", body: new Uint8Array([123, 125]) });
    expect((await readJsonBody(none, schema)).ok).toBe(false);
    expect(await readJsonBody(post(JSON.stringify({ a: "12" }), { "content-type": "Application/JSON; charset=utf-8" }), schema)).toEqual({ ok: true, data: { a: "12" } });
  });
});

describe("isSameOrigin", () => {
  it("allows same-origin and Origin-less requests, refuses other sites", () => {
    expect(isSameOrigin(new Request(URL, { headers: { host: "localhost:3000" } }))).toBe(true);
    expect(isSameOrigin(new Request(URL, { headers: { host: "localhost:3000", origin: "http://localhost:3000" } }))).toBe(true);
    expect(isSameOrigin(new Request(URL, { headers: { host: "offersheet.example", origin: "https://offersheet.example", "x-forwarded-host": "offersheet.example" } }))).toBe(true);
    expect(isSameOrigin(new Request(URL, { headers: { host: "localhost:3000", origin: "https://evil.example" } }))).toBe(false);
    expect(isSameOrigin(new Request(URL, { headers: { origin: "null" } }))).toBe(false);
  });

  it("without Origin, refuses what the browser marks as sent by another site", () => {
    const withSite = (site: string) => new Request(URL, { method: "POST", headers: { host: "localhost:3000", "sec-fetch-site": site } });
    expect(isSameOrigin(withSite("cross-site"))).toBe(false);
    expect(isSameOrigin(withSite("same-site"))).toBe(false);
    expect(isSameOrigin(withSite("same-origin"))).toBe(true);
    expect(isSameOrigin(withSite("none"))).toBe(true);
  });

  it("compares the scheme too: an http page may not post to the https site", () => {
    const secure = "https://offersheet.example/api/x";
    expect(isSameOrigin(new Request(secure, { headers: { host: "offersheet.example", origin: "https://offersheet.example" } }))).toBe(true);
    expect(isSameOrigin(new Request(secure, { headers: { host: "offersheet.example", origin: "http://offersheet.example" } }))).toBe(false);
    // Behind a proxy that says the browser used https (the app itself sees plain http).
    const proxied = { host: "offersheet.example", "x-forwarded-proto": "https" };
    expect(isSameOrigin(new Request(URL, { headers: { ...proxied, origin: "https://offersheet.example" } }))).toBe(true);
    expect(isSameOrigin(new Request(URL, { headers: { ...proxied, origin: "http://offersheet.example" } }))).toBe(false);
    // Other schemes and default ports.
    expect(isSameOrigin(new Request(URL, { headers: { host: "localhost:3000", origin: "chrome-extension://abcdef" } }))).toBe(false);
    expect(isSameOrigin(new Request(secure, { headers: { host: "offersheet.example:443", origin: "https://offersheet.example" } }))).toBe(true);
  });
});

describe("importErrorResponse", () => {
  it("maps adapter errors, including ones from another copy of the class", async () => {
    const res = importErrorResponse(new LeagueImportError("SOURCE_DOWN", "detail"), { platform: "espn" });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: { code: "SOURCE_DOWN", message: "ESPN isn't responding right now. Please try again in a few minutes." } });

    const lookalike = Object.assign(new Error("x"), { name: "LeagueImportError", code: "USER_NOT_FOUND" });
    expect((await importErrorResponse(lookalike, { platform: "sleeper" }).json()) as unknown).toMatchObject({ error: { code: "USER_NOT_FOUND" } });
  });

  it("a used-up daily budget answers BUSY for the platform, with Retry-After until the next UTC midnight and that wait in words (track RL)", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 4, 18, 0, 0), toFake: ["Date"] });
    try {
      const { BudgetExhaustedError } = await import("@/server/budget");
      const res = importErrorResponse(new BudgetExhaustedError("espn"), { platform: "espn", season: 2026 });
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe(String(6 * 3600));
      expect(await res.json()).toEqual({ error: { code: "BUSY", message: "Offer Sheet has used today's share of requests to ESPN. Try again in about 6 hours." } });
      // Sleeper's adapter turns its client's error into SOURCE_DOWN; the request's scope still knows it was the budget.
      const { newRequestScope, noteCut, runInRequestScope } = await import("@/server/deadline");
      const scope = newRequestScope("import", Date.now());
      const sleeper = await runInRequestScope(scope, async () => {
        noteCut("budget", "sleeper");
        return importErrorResponse(new LeagueImportError("SOURCE_DOWN", "Sleeper couldn't be reached.", { platform: "sleeper" }), { platform: "sleeper" });
      });
      expect(await sleeper.json()).toEqual({ error: { code: "BUSY", message: "Offer Sheet has used today's share of requests to Sleeper. Try again in about 6 hours." } });
    } finally {
      vi.useRealTimers();
    }
  });

  it("on Vercel the day's BUSY waits until its slice allowance next grows, not the day's end (final review SEC-2)", async () => {
    const at = Date.UTC(2026, 9, 4, 13, 30, 0); // slice 6: 7/12 of the day is open until 14:00
    const vercel = busyResponse("espn", "day", at, { VERCEL: "1" });
    expect(vercel.headers.get("retry-after")).toBe("1800");
    expect(await vercel.json()).toEqual({ error: { code: "BUSY", message: "Offer Sheet has used today's share of requests to ESPN. Try again in about 30 minutes." } });
    expect(busyResponse("espn", "day", at, {}).headers.get("retry-after")).toBe(String(10.5 * 3600)); // no slices: midnight
    expect(busyResponse("espn", "share", at, { VERCEL: "1" }).headers.get("retry-after")).toBe(String(10.5 * 3600));
  });

  it("the daily work budget's refusals (final review SEC-1, F1): BUSY, the visitor's own day until midnight, the server's until its slice grows", async () => {
    const at = Date.UTC(2026, 9, 4, 1, 0, 0);
    for (const limit of ["client", "group"] as const) {
      const res = workRefusedResponse(limit, at);
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe(String(23 * 3600));
      expect(await res.json()).toEqual({ error: { code: "BUSY", message: "Your connection has used today's share of requests to Offer Sheet. Try again in about 23 hours." } });
    }
    const day = workRefusedResponse("day", at);
    expect(day.headers.get("retry-after")).toBe(String(5 * 3600));
    expect(await day.json()).toEqual({ error: { code: "BUSY", message: "Offer Sheet has used its share of free server time for now. Try again in about 5 hours." } });
  });

  it("the client's own share of the day answers BUSY in words about its connection (review RL-4)", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 4, 23, 30, 0), toFake: ["Date"] });
    try {
      const { BudgetExhaustedError } = await import("@/server/budget");
      const res = importErrorResponse(new BudgetExhaustedError("espn", "share"), { platform: "espn" });
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe("1800");
      expect(await res.json()).toEqual({ error: { code: "BUSY", message: "Your connection has used today's share of requests to ESPN. Try again in about 30 minutes." } });
      const { newRequestScope, noteCut, runInRequestScope } = await import("@/server/deadline");
      const sleeper = await runInRequestScope(newRequestScope("import", Date.now()), async () => {
        noteCut("share", "sleeper");
        return importErrorResponse(new LeagueImportError("SOURCE_DOWN", "x", { platform: "sleeper" }), { platform: "sleeper" });
      });
      expect(((await sleeper.json()) as { error: { message: string } }).error.message).toBe("Your connection has used today's share of requests to Sleeper. Try again in about 30 minutes.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a request whose deadline came first answers SOURCE_SLOW, naming only a source that was slow; a plain outage stays SOURCE_DOWN (review RL-8)", async () => {
    const { newRequestScope, noteCut, runInRequestScope } = await import("@/server/deadline");
    type Cuts = Partial<Record<"slow" | "busy" | "skipped", string[]>>;
    const down = new LeagueImportError("SOURCE_DOWN", "ESPN isn't responding right now.", { platform: "espn" });
    const answer = async (cuts: Cuts) => {
      const scope = newRequestScope("import", Date.now());
      const res = await runInRequestScope(scope, async () => {
        for (const [reason, platforms] of Object.entries(cuts)) for (const p of platforms ?? []) noteCut(reason as keyof Cuts, p);
        return importErrorResponse(down, { platform: "espn" });
      });
      return { status: res.status, body: (await res.json()) as { error: { code: string; message: string } } };
    };
    expect(await answer({ slow: ["espn", "sleeper"] })).toEqual({ status: 504, body: { error: { code: "SOURCE_SLOW", message: "ESPN is answering slowly right now, so Offer Sheet stopped waiting. Try again in a few minutes." } } });
    expect((await answer({ slow: ["fantasycalc"] })).body.error.message).toBe("FantasyCalc is answering slowly right now, so Offer Sheet stopped waiting. Try again in a few minutes.");
    expect((await answer({ slow: ["sleeper", "github"] })).body.error.message).toBe("One of our data sources is answering slowly right now, so Offer Sheet stopped waiting. Try again in a few minutes.");
    // The reviewer's case: Sleeper's player list took the time, and the ESPN league request never went out.
    expect((await answer({ slow: ["sleeper"], skipped: ["espn"] })).body.error.message).toBe("Sleeper is answering slowly right now, so Offer Sheet stopped waiting. Try again in a few minutes.");
    // Nothing was slow: the time went to Offer Sheet's own queue or cache, or ran out before ESPN was asked.
    const busy = "Offer Sheet is busy right now. Try again in a few minutes.";
    expect(await answer({ busy: ["espn"], skipped: ["espn"] })).toEqual({ status: 504, body: { error: { code: "SOURCE_SLOW", message: busy } } });
    expect((await answer({ busy: ["cache"] })).body.error.message).toBe(busy);
    expect((await answer({ skipped: ["espn"] })).body.error.message).toBe(busy);
    expect((await answer({})).body.error.code).toBe("SOURCE_DOWN");
    // A cut never turns a user's own mistake into "slow".
    const scope = newRequestScope("import", Date.now());
    const notFound = await runInRequestScope(scope, async () => {
      noteCut("slow", "espn");
      return importErrorResponse(new LeagueImportError("LEAGUE_NOT_FOUND", "no"), { platform: "espn" });
    });
    expect(notFound.status).toBe(404);
  });

  it("turns anything else into a generic 500", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = importErrorResponse(new RangeError("secret-ish detail"), { platform: "espn" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: "INTERNAL", message: "Something went wrong on our side. Please try again." } });
    expect(errors.mock.calls.flat().join(" ")).not.toContain("secret-ish detail"); // NODE_ENV is "test", so only the error's name is logged
  });
});

describe("scrubSwids and dataSourceStamps", () => {
  it("leaves clean bodies alone", () => {
    const body = { a: 1, b: ["x"] };
    expect(scrubSwids(body, "test")).toBe(body);
    // A bare GUID that isn't a known SWID stays (ESPN transaction IDs look like this).
    const tx = { id: "00000000-0000-4000-8000-0000000000aa" };
    expect(scrubSwids(tx, "test", ["{00000000-0000-4000-8000-000000000001}"])).toBe(tx);
  });

  it("replaces braced and %7B-encoded SWIDs, and the user's own SWID in any form or case", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const own = "{00000000-0000-4000-8000-00000000abcd}";
    const body = {
      braced: "{00000000-0000-4000-8000-000000000042}",
      encoded: "x=%7B00000000-0000-4000-8000-000000000043%7D&y=%7b00000000-0000-4000-8000-000000000044%7d",
      bare: "owner 00000000-0000-4000-8000-00000000ABCD",
      ownEncoded: "%7B00000000-0000-4000-8000-00000000abcd%7D",
    };
    const out = scrubSwids(body, "test", [own]);
    expect(JSON.stringify(out)).not.toMatch(/00000000-0000-4000-8000-0000000000(42|43|44)|abcd/i);
    expect(out).toEqual({ braced: "{SWID}", encoded: "x={SWID}&y={SWID}", bare: "owner {SWID}", ownEncoded: "{SWID}" });
    // Logged as a bug, allowlisted fields only (src/server/log.ts): nothing of the body, the count or the caller's words.
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[0])).toBe(JSON.stringify({ route: "server", event: "swid_scrubbed", platform: "espn" }));
  });

  it("uses the resolver's status() when it has one", () => {
    const withStatus = { ...fakeResolver, status: () => [{ name: "Sleeper players", fetchedAt: null, fromCache: true, available: true, note: "partial: {00000000-0000-4000-8000-000000000000}" }] };
    expect(dataSourceStamps(withStatus)).toEqual([{ name: "Sleeper players", fetchedAt: null, fromCache: true, available: true, note: "partial: {SWID}" }]);
    expect(dataSourceStamps(fakeResolver)).toEqual([{ name: "Sleeper players", fetchedAt: "2026-09-29T22:00:00.000Z" }]);
    // A cached source keeps its original fetch time, so the Import Report can show it.
    const cached = { ...fakeResolver, status: () => [{ name: "DynastyProcess player IDs", fetchedAt: "2026-09-29T08:30:00.000Z", fromCache: true, available: true }] };
    expect(dataSourceStamps(cached)).toEqual([{ name: "DynastyProcess player IDs", fetchedAt: "2026-09-29T08:30:00.000Z", fromCache: true, available: true }]);
  });
});
