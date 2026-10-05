/**
 * The gzip bodies the browser sends (track BF; ./upload.ts): caps before and while unpacking, the strict shape of a league
 * upload and of a signed import, the platform's own addresses, the parts' ages, and SWIDs pseudonymized before anything
 * is parsed. Made-up data only. No network.
 */
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ESPN_READS_BASE } from "@/adapters/espn/leagueData";
import { swidPseudonym } from "@/adapters/espn/swid";
import { SLEEPER_API } from "@/adapters/sleeper/leagueData";
import type { LeagueUpload } from "@/adapters/upload";
import { browserFetchLimits } from "@/server/limits";
import { gzipRequest, jsonRequest } from "./testFakes";
import { isGzipRequest, readGzipText, readLeagueUpload, readSignedModelUpload } from "./upload";

const URL = "http://localhost:3000/api/import/espn";
const SWID = "{00000000-0000-4000-8000-0000000000AB}";

function espnUpload(over: Partial<LeagueUpload> = {}): LeagueUpload {
  return {
    v: 1,
    platform: "espn",
    request: { leagueId: "4242", season: 2026 },
    sentAt: 2_000_000,
    parts: [{ url: `${ESPN_READS_BASE}/seasons/2026/segments/0/leagues/4242?view=mSettings`, status: 200, json: { members: [{ id: SWID, displayName: "Zorblax" }] }, at: 1_999_000 }],
    ...over,
  };
}

describe("readGzipText", () => {
  it("unpacks a gzip body; refuses other types, bodies over the caps (before and while unpacking), non-gzip and non-UTF-8", async () => {
    expect(isGzipRequest(gzipRequest(URL, { a: 1 }))).toBe(true);
    expect(isGzipRequest(jsonRequest(URL, { a: 1 }))).toBe(false);
    expect(await readGzipText(gzipRequest(URL, { a: 1 }))).toEqual({ ok: true, value: '{"a":1}' });
    expect(await readGzipText(jsonRequest(URL, { a: 1 }))).toEqual({ ok: false, why: "not gzip" });
    // Over the compressed cap: refused unread.
    const big = gzipRequest(URL, "x".repeat(1000));
    expect(await readGzipText(big, { compressedBytes: 10, unpackedBytes: 1_000_000 })).toEqual({ ok: false, why: "too large" });
    // A zip bomb: small packed, huge unpacked.
    const bomb = new Request(URL, { method: "POST", headers: { "content-type": "application/gzip" }, body: gzipSync(Buffer.alloc(5_000_000)) });
    expect(await readGzipText(bomb, { compressedBytes: 3_000_000, unpackedBytes: 1_000_000 })).toEqual({ ok: false, why: "not gzip, or too large unpacked" });
    const notGzip = new Request(URL, { method: "POST", headers: { "content-type": "application/gzip" }, body: "plain text" });
    expect((await readGzipText(notGzip)).ok).toBe(false);
    const latin1 = new Request(URL, { method: "POST", headers: { "content-type": "application/gzip" }, body: gzipSync(Buffer.from([0x7b, 0xff, 0x7d])) });
    expect(await readGzipText(latin1)).toEqual({ ok: false, why: "not UTF-8" });
  });
});

describe("readLeagueUpload", () => {
  it("reads an ESPN upload, its SWIDs pseudonymized before it's parsed (as the server's own read does)", async () => {
    const read = await readLeagueUpload(gzipRequest(URL, espnUpload()), "espn");
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(JSON.stringify(read.value)).not.toContain("0000000000AB");
    expect((read.value.parts[0]?.json as { members: Array<{ id: string }> }).members[0]?.id).toBe(swidPseudonym(SWID));
  });

  it("refuses anything but the expected shape: unknown fields, another platform's addresses, too many parts, stale or future parts", async () => {
    const bad = async (u: unknown, platform: "espn" | "sleeper" = "espn") => (await readLeagueUpload(gzipRequest(URL, u), platform)).ok;
    expect(await bad(espnUpload())).toBe(true);
    expect(await bad({ ...espnUpload(), extra: 1 })).toBe(false);
    expect(await bad({ ...espnUpload(), v: 2 })).toBe(false);
    expect(await bad(espnUpload(), "sleeper")).toBe(false);
    expect(await bad(espnUpload({ request: { leagueId: "not-a-league", season: 2026 } }))).toBe(false);
    expect(await bad(espnUpload({ parts: [{ url: "https://evil.example/x", status: 200, at: 1_999_000 }] }))).toBe(false);
    expect(await bad(espnUpload({ parts: [{ url: `${SLEEPER_API}/state/nfl`, status: 200, at: 1_999_000 }] }))).toBe(false);
    const part = { url: `${ESPN_READS_BASE}/seasons/2026/x`, status: 200, at: 1_999_000 };
    expect(await bad(espnUpload({ parts: Array.from({ length: browserFetchLimits.maxParts + 1 }, () => part) }))).toBe(false);
    expect(await bad(espnUpload({ parts: [{ ...part, at: 2_000_000 - browserFetchLimits.maxPartAgeMs - 1 }] }))).toBe(false);
    expect(await bad(espnUpload({ parts: [{ ...part, at: 2_000_001 }] }))).toBe(false);
    expect(await bad("not json")).toBe(false);
    // Sleeper: a league ID as a bare number, and a username checked as everywhere else.
    const sleeper = { v: 1, platform: "sleeper", request: { leagueId: "123456789012345678", season: 2026, username: "@zorblax_q" }, sentAt: 10, parts: [{ url: `${SLEEPER_API}/state/nfl`, status: 200, json: { week: 4 }, at: 9 }] };
    const read = await readLeagueUpload(gzipRequest(URL, sleeper), "sleeper");
    expect(read.ok && read.value.request).toEqual({ leagueId: "123456789012345678", season: 2026, username: "zorblax_q" });
    expect(await bad({ ...sleeper, request: { leagueId: "https://sleeper.com/leagues/123456789012345678", season: 2026 } }, "sleeper")).toBe(false);
    expect(await bad({ ...sleeper, request: { leagueId: "123456789012345678", season: 2026, username: "zorblax q" } }, "sleeper")).toBe(false);
  });
});

describe("readSignedModelUpload", () => {
  it("hands back the import exactly as parsed (its signature covers that object), and refuses other shapes", async () => {
    const snapshot = { platform: "sleeper", leagueId: "123456789012345678", season: 2026, b: { z: 1, a: 2 } };
    const body = { v: 1, leagueId: "123456789012345678", season: 2026, username: "zorblax_q", import: { snapshot, modelPart: {} }, signed: { issuedAt: 5, token: "t" } };
    const read = await readSignedModelUpload(gzipRequest(URL, body), "sleeper");
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value).toEqual({ leagueId: "123456789012345678", season: 2026, username: "zorblax_q", import: { snapshot, modelPart: {} }, signed: { issuedAt: 5, token: "t" } });
    expect(Object.keys(read.value.import.snapshot.b as object)).toEqual(["z", "a"]);
    expect((await readSignedModelUpload(gzipRequest(URL, { ...body, username: undefined, leagueId: "4242" }), "espn")).ok).toBe(true);
    expect((await readSignedModelUpload(gzipRequest(URL, { ...body, username: undefined, leagueId: "4242", extra: true }), "espn")).ok).toBe(false);
    expect((await readSignedModelUpload(gzipRequest(URL, { ...body, signed: { issuedAt: 1.5, token: "t" } }), "sleeper")).ok).toBe(false);
    expect((await readSignedModelUpload(gzipRequest(URL, { ...body, import: { snapshot: [], modelPart: {} } }), "sleeper")).ok).toBe(false);
  });
});
