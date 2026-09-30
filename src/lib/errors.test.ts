import { describe, expect, it } from "vitest";
import { IMPORT_ERROR_CODES, errorMessage, errorStatus, isImportErrorCode, redactSecrets, type AppErrorCode } from "./errors";

const ALL_CODES: AppErrorCode[] = [...IMPORT_ERROR_CODES, "INVALID_REQUEST", "SESSION_UNAVAILABLE", "BAD_ORIGIN", "INTERNAL"];

describe("error codes → messages", () => {
  it("uses the spec's exact wording for a wrong season (CLAUDE.md §2.2)", () => {
    expect(errorMessage("LEAGUE_NOT_FOUND", { platform: "espn", season: 2026 })).toBe("League not found for that season.");
  });

  it("passes the adapter's friendly message through for unsupported leagues", () => {
    expect(errorMessage("UNSUPPORTED_LEAGUE", { platform: "sleeper", adapterMessage: "Guillotine leagues aren't supported yet." })).toBe("Guillotine leagues aren't supported yet.");
    expect(errorMessage("UNSUPPORTED_LEAGUE", { platform: "sleeper" })).toMatch(/doesn't support/);
  });

  it("names the platform and season where it helps", () => {
    expect(errorMessage("SOURCE_DOWN", { platform: "sleeper" })).toBe("Sleeper isn't responding right now. Please try again in a few minutes.");
    expect(errorMessage("NO_LEAGUE", { platform: "sleeper", season: 2026 })).toBe("We didn't find any Sleeper leagues for that username in 2026.");
    expect(errorMessage("BAD_RESPONSE", { platform: "espn", adapterMessage: "missing settings.scoringSettings" })).toContain("(missing settings.scoringSettings)");
  });

  it("has a plain message and an HTTP status for every code", () => {
    for (const code of ALL_CODES) {
      expect(errorMessage(code, { platform: "espn" }).length).toBeGreaterThan(10);
      expect(errorStatus(code)).toBeGreaterThanOrEqual(400);
    }
    expect(errorStatus("LEAGUE_NOT_FOUND")).toBe(404);
    expect(errorStatus("PRIVATE_LEAGUE")).toBe(403);
    expect(errorStatus("BAD_CREDENTIALS")).toBe(401);
    expect(errorStatus("INTERNAL")).toBe(500);
  });

  it("never forwards credential-looking text from an adapter", () => {
    const fakeSwid = "{00000000-0000-4000-8000-000000000000}";
    const fakeS2 = `AEB${"q".repeat(80)}`;
    const msg = errorMessage("UNSUPPORTED_LEAGUE", { adapterMessage: `owner ${fakeSwid} cookie espn_s2=${fakeS2}; token ${fakeS2}` });
    expect(msg).not.toContain(fakeSwid.slice(1, -1));
    expect(msg).not.toContain(fakeS2);
  });

  it("recognizes adapter codes", () => {
    expect(isImportErrorCode("PRIVATE_LEAGUE")).toBe(true);
    expect(isImportErrorCode("INTERNAL")).toBe(false);
    expect(isImportErrorCode(42)).toBe(false);
  });
});

describe("redactSecrets", () => {
  it("replaces SWIDs, GUIDs, cookie pairs and long tokens, and leaves JSON paths alone", () => {
    expect(redactSecrets("member {00000000-0000-4000-8000-000000000000}")).toBe("member {SWID}");
    expect(redactSecrets("id 00000000-0000-4000-8000-000000000000")).toBe("id [id]");
    expect(redactSecrets("SWID=abc; espn_s2=def")).toBe("SWID=[redacted]; espn_s2=[redacted]");
    expect(redactSecrets(`x ${"A".repeat(70)} y`)).toBe("x [redacted] y");
    expect(redactSecrets("missing field at settings.scoringSettings.scoringItems[3].statId")).toBe("missing field at settings.scoringSettings.scoringItems[3].statId");
  });
});
