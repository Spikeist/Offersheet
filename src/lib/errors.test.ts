import { describe, expect, it } from "vitest";
import { IMPORT_ERROR_CODES, errorForStatus, errorMessage, errorStatus, isImportErrorCode, redactSecrets, retryAfterSeconds, waitWords, type AppErrorCode } from "./errors";

const ALL_CODES: AppErrorCode[] = [...IMPORT_ERROR_CODES, "INVALID_REQUEST", "BAD_UPLOAD", "SESSION_UNAVAILABLE", "BAD_ORIGIN", "RATE_LIMITED", "BUSY", "SOURCE_SLOW", "INTERNAL"];

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

  it("the public beta's limits read in words that say what happened and what to do (track RL)", () => {
    expect(errorMessage("RATE_LIMITED")).toBe("You're going a bit fast. Try again in a minute or two.");
    expect(errorStatus("RATE_LIMITED")).toBe(429);
    expect(errorMessage("BUSY", { platform: "espn" })).toBe("Offer Sheet has used today's share of requests to ESPN. Try again after midnight UTC.");
    expect(errorMessage("BUSY", { platform: "espn", source: "Sleeper" })).toBe("Offer Sheet has used today's share of requests to Sleeper. Try again after midnight UTC.");
    expect(errorStatus("BUSY")).toBe(503);
    expect(errorMessage("SOURCE_SLOW", { platform: "sleeper" })).toBe("Sleeper is answering slowly right now, so Offer Sheet stopped waiting. Try again in a few minutes.");
    expect(errorMessage("SOURCE_SLOW")).toBe("One of our data sources is answering slowly right now, so Offer Sheet stopped waiting. Try again in a few minutes.");
    expect(errorStatus("SOURCE_SLOW")).toBe(504);
    // The source label never changes the other messages.
    expect(errorMessage("SOURCE_DOWN", { platform: "espn" })).toBe("ESPN isn't responding right now. Please try again in a few minutes.");
  });

  it("the waits these answers carry are said in words that match their Retry-After (review RL-9)", () => {
    expect(errorMessage("RATE_LIMITED", { retryAfterS: 469 })).toBe("You're going a bit fast. Try again in about 8 minutes.");
    expect(errorMessage("RATE_LIMITED", { retryAfterS: 45 })).toBe("You're going a bit fast. Try again in a minute or two.");
    expect(errorMessage("RATE_LIMITED", { retryAfterS: 3_000 })).toBe("You're going a bit fast. Try again in about 50 minutes.");
    expect(errorMessage("BUSY", { source: "ESPN", retryAfterS: 6 * 3600 })).toBe("Offer Sheet has used today's share of requests to ESPN. Try again in about 6 hours.");
    expect(errorMessage("BUSY", { source: "ESPN", retryAfterS: 6 * 3600, ownShare: true })).toBe("Your connection has used today's share of requests to ESPN. Try again in about 6 hours.");
    expect(errorMessage("SOURCE_SLOW", { platform: "espn", busyHere: true })).toBe("Offer Sheet is busy right now. Try again in a few minutes.");
    expect([30, 90, 91, 600, 3_540, 3_600, 3_900, 21_600, 21_700, 86_400].map((s) => waitWords(s))).toEqual([
      "in a minute or two",
      "in a minute or two",
      "in about 2 minutes",
      "in about 10 minutes",
      "in about 59 minutes",
      "in about an hour",
      "in about an hour",
      "in about 6 hours",
      "in about 6 hours",
      "in about 24 hours",
    ]);
    expect([undefined, 0, -5, Number.NaN].map((s) => waitWords(s))).toEqual([undefined, undefined, undefined, undefined]);
    const now = Date.UTC(2026, 9, 4, 18, 0, 0);
    expect(retryAfterSeconds("120", now)).toBe(120);
    expect(retryAfterSeconds(new Date(now + 90_500).toUTCString(), now)).toBe(90);
    expect([retryAfterSeconds(null, now), retryAfterSeconds("", now), retryAfterSeconds("soon", now), retryAfterSeconds("0", now)]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("errorForStatus: a reply that isn't ours (a host's or firewall's page) still reads in words", () => {
    expect(errorForStatus(429)).toEqual({ code: "RATE_LIMITED", message: "You're going a bit fast. Try again in a minute or two." });
    expect(errorForStatus(429, "600")).toEqual({ code: "RATE_LIMITED", message: "You're going a bit fast. Try again in about 10 minutes." });
    expect(errorForStatus(504)).toEqual({ code: "SOURCE_SLOW", message: "Offer Sheet took too long to answer. Try again in a few minutes." });
    expect(errorForStatus(413).code).toBe("INVALID_REQUEST");
    expect(errorForStatus(503)).toEqual({ code: "INTERNAL", message: "Offer Sheet isn't available right now. Try again later." });
    expect(errorForStatus(500)).toEqual({ code: "INTERNAL", message: "Something went wrong on our side. Please try again." });
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
