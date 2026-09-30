import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { LeagueImportError } from "@/adapters/types";
import { dataSourceStamps, importErrorResponse, isSameOrigin, readJsonBody, scrubSwids } from "./respond";
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
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[0])).toContain("replaced 5 SWID-like value(s)");
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
