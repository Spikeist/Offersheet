/**
 * Signed imports (track BF; ./importToken.ts): the canonical JSON, a signature that survives the browser's round trip
 * (JSON, IndexedDB's key order), and every way one stops checking out. A made-up secret only. No network.
 */
import { describe, expect, it } from "vitest";
import { browserFetchLimits } from "./limits";
import { canonicalJson, importSignatureProblem, signImport } from "./importToken";

const ENV = { SESSION_SECRET: "import-token tests: a made-up secret, never a real one" };
const T0 = Date.UTC(2026, 9, 4, 20);
const content = () => ({
  snapshot: { platform: "espn", leagueId: "4242", season: 2026, fetchedAt: "2026-10-04T20:00:00.000Z", teams: [{ id: "1", name: "Team 1", ir: [] }], optional: undefined },
  modelPart: { espn: { "4046": { 3: 17.1, 4: null } } },
});

describe("canonicalJson", () => {
  it("sorts keys, leaves out undefined properties as JSON does, and reads values JSON can't hold as null", () => {
    expect(canonicalJson({ b: 1, a: [3, { d: undefined, c: "x" }], e: undefined })).toBe('{"a":[3,{"c":"x"}],"b":1}');
    expect(canonicalJson([undefined, () => 1, Number.NaN, -0])).toBe("[null,null,null,0]");
    expect(canonicalJson("é ")).toBe(JSON.stringify("é "));
    expect(canonicalJson({ z: 1, a: 2 })).toBe(canonicalJson({ a: 2, z: 1 }));
  });
});

describe("signImport and importSignatureProblem", () => {
  it("signs what the import route answers, and checks the browser's copy after a JSON round trip with its keys reordered", () => {
    const sig = signImport("espn", content(), T0, ENV);
    expect(sig).toMatchObject({ issuedAt: T0, token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    if (!sig) return;
    const back = JSON.parse(JSON.stringify(content())) as ReturnType<typeof content>;
    const reordered = { modelPart: back.modelPart, snapshot: Object.fromEntries(Object.entries(back.snapshot).reverse()) };
    expect(importSignatureProblem("espn", reordered, sig, T0 + 60_000, ENV)).toBeNull();
  });

  it("refuses a changed snapshot or model part, another platform, another secret, a stale or future issue time, and a malformed token", () => {
    const sig = signImport("espn", content(), T0, ENV);
    if (!sig) throw new Error("expected a signature");
    const changed = content();
    changed.snapshot.teams[0] = { id: "1", name: "Team 9", ir: [] };
    expect(importSignatureProblem("espn", changed, sig, T0, ENV)).toBe("doesn't match");
    expect(importSignatureProblem("espn", { ...content(), modelPart: { espn: {} } }, sig, T0, ENV)).toBe("doesn't match");
    expect(importSignatureProblem("sleeper", content(), sig, T0, ENV)).toBe("doesn't match");
    expect(importSignatureProblem("espn", content(), sig, T0, { SESSION_SECRET: "another made-up secret of at least 32 chars" })).toBe("doesn't match");
    expect(importSignatureProblem("espn", content(), sig, T0 + browserFetchLimits.tokenMaxAgeMs + 1, ENV)).toBe("too old");
    expect(importSignatureProblem("espn", content(), sig, T0 - browserFetchLimits.tokenFutureSkewMs - 1, ENV)).toBe("issued in the future");
    expect(importSignatureProblem("espn", content(), { issuedAt: T0 + 1, token: sig.token }, T0 + 2, ENV)).toBe("doesn't match");
    expect(importSignatureProblem("espn", content(), { issuedAt: 1.5, token: sig.token }, T0, ENV)).toBe("malformed");
    expect(importSignatureProblem("espn", content(), { issuedAt: T0, token: "short" }, T0, ENV)).toBe("doesn't match");
  });

  it("takes a token for as long as the League page sends one back plus 5 minutes, not hours (review BF-R7)", () => {
    // The page sends a signed import back only while its league data is under reimportAfterMs (10 minutes) old.
    expect(browserFetchLimits.tokenMaxAgeMs).toBe(browserFetchLimits.reimportAfterMs + 5 * 60_000);
    const sig = signImport("espn", content(), T0, ENV);
    if (!sig) throw new Error("expected a signature");
    expect(importSignatureProblem("espn", content(), sig, T0 + browserFetchLimits.reimportAfterMs, ENV)).toBeNull();
    expect(importSignatureProblem("espn", content(), sig, T0 + 15 * 60_000, ENV)).toBeNull();
    expect(importSignatureProblem("espn", content(), sig, T0 + 15 * 60_000 + 1, ENV)).toBe("too old");
    expect(importSignatureProblem("espn", content(), sig, T0 + 60 * 60_000, ENV)).toBe("too old");
  });

  it("signs nothing without SESSION_SECRET (the model route then reads the league itself), and checks nothing either", () => {
    expect(signImport("espn", content(), T0, {})).toBeUndefined();
    expect(signImport("espn", content(), T0, { SESSION_SECRET: "too short" })).toBeUndefined();
    expect(importSignatureProblem("espn", content(), { issuedAt: T0, token: "x" }, T0, {})).toBe("no key to check it with");
  });
});
