import path from "node:path";
import { describe, expect, it } from "vitest";
import { cacheFile, credentialScope, sha256, writeCache } from "./cache";
import { isStrangerFixture } from "./fixtures";
import { OfflineCacheMiss, request } from "./http";
import { ICON, formatSample, rollup } from "./checklist";
import { ROOT } from "./env";
import { fantasyCalcUrl, matchRate, nearest, type FcEntry } from "./fantasycalc";
import { describeShape, formatShape } from "./shape";

describe("probe library smoke test", () => {
  it("finds the project root", () => {
    expect(path.basename(ROOT)).toBe("fantasy-trade-finder");
  });

  it("uses hash filenames that are valid on Windows", () => {
    const f = path.basename(cacheFile("http", "espn:league:123?view=mSettings&view=mTeam"));
    expect(f).toMatch(/^[0-9a-f]{64}\.json$/);
    expect(sha256("a")).toHaveLength(64);
  });

  it("credential scopes are stable, short and don't contain the inputs", () => {
    const a = credentialScope("s2value", "{SWID}");
    expect(a).toBe(credentialScope("s2value", "{SWID}"));
    expect(a).not.toBe(credentialScope("other", "{SWID}"));
    expect(a).toMatch(/^cred-[0-9a-f]{16}$/);
  });

  it("rolls up checklist statuses (worst wins, n/a only when all n/a)", () => {
    expect(rollup(["ok", "warn", "ok"])).toBe("warn");
    expect(rollup(["na", "ok"])).toBe("ok");
    expect(rollup(["na", "na"])).toBe("na");
    expect(rollup(["warn", "fail"])).toBe("fail");
    expect(ICON.fail).toBe("❌");
    expect(formatSample("x".repeat(500), 20)).toHaveLength(20);
  });

  it("FantasyCalc helpers pick formats and compute match rate", () => {
    expect(nearest([8, 10, 12, 14], 11)).toBe(10);
    expect(nearest([8, 10, 12, 14], 16)).toBe(14);
    expect(fantasyCalcUrl({ isDynasty: false, numQbs: 1, numTeams: 12, ppr: 1 })).toBe(
      "https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=1&numTeams=12&ppr=1",
    );
    const fc = [{ player: { id: 1, name: "A", position: "QB", espnId: "100" }, value: 5 }] as FcEntry[];
    const r = matchRate(
      [
        { id: "100", name: "A", pos: "QB" },
        { id: "200", name: "B", pos: "RB" },
        { id: "300", name: "C", pos: "K" },
      ],
      fc,
      "espnId",
    );
    expect(r).toMatchObject({ eligible: 2, matched: 1, rate: 0.5 });
    expect(r.misses.map((m) => m.id)).toEqual(["200"]);
  });

  it("routes strangers' league fixtures out of git (label-based cases)", () => {
    expect(isStrangerFixture("espn", "public-league/{publicLeagueId}/view=mSettings")).toBe(true);
    expect(isStrangerFixture("espn", "league/{leagueId}/view=mSettings")).toBe(false);
    expect(isStrangerFixture("sleeper", "public-test-league/league/{leagueId}")).toBe(true);
    expect(isStrangerFixture("sleeper", "state/nfl")).toBe(false);
    expect(isStrangerFixture("fleaflicker", "oracle/FetchLeagueRules")).toBe(true);
    expect(isStrangerFixture("mfl", "mfl/2026/export?TYPE=allRules&JSON=1")).toBe(false);
    expect(isStrangerFixture("shared", "fantasycalc/redraft-1qb-12-ppr1")).toBe(false);
  });

  it("offline requests serve any cached copy and never touch the network", async () => {
    const url = "https://example.invalid/offline-test";
    const key = "smoke-offline:fixed"; // one fixed key: the test rewrites the same cache file every run
    await writeCache("smoke-offline", key, { status: 200, contentType: "application/json", finalUrl: url, headers: {}, text: '{"ok":1}' }, 0);
    const res = await request(url, { cache: { key, ttlMs: 1, namespace: "smoke-offline" }, offline: true });
    expect(res.fromCache).toBe(true);
    expect(res.json).toEqual({ ok: 1 });
    await expect(request(url, { cache: { key: `${key}-missing`, ttlMs: 1, namespace: "smoke-offline" }, offline: true })).rejects.toBeInstanceOf(OfflineCacheMiss);
  });

  it("shape view never prints string values", () => {
    const out = formatShape(describeShape({ members: [{ displayName: "Very Private Name", id: "{ABCDEF12-3456-7890-ABCD-EF1234567890}" }] }));
    expect(out).toContain("members[].displayName");
    expect(out).not.toContain("Very Private Name");
    expect(out).not.toContain("ABCDEF12");
  });
});
