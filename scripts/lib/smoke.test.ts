import path from "node:path";
import { describe, expect, it } from "vitest";
import { cacheFile, credentialScope, sha256 } from "./cache";
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

  it("shape view never prints string values", () => {
    const out = formatShape(describeShape({ members: [{ displayName: "Very Private Name", id: "{ABCDEF12-3456-7890-ABCD-EF1234567890}" }] }));
    expect(out).toContain("members[].displayName");
    expect(out).not.toContain("Very Private Name");
    expect(out).not.toContain("ABCDEF12");
  });
});
