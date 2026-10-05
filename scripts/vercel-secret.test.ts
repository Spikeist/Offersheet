/**
 * npm run vercel:secret (final review SEC-9; planner reply to Checkpoint 7a, §6.3: CRON_SECRET too): its arguments, the
 * secret it makes (never printed), the CLI arguments that carry it on stdin, and that the CLI's answers never show it. No
 * network: the CLI is never run here.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_SECRET_ENV, envAddArgs, newSecret, newSessionSecret, vercelSecretArgs, withoutSecret } from "./vercel-secret";

describe("vercel:secret", () => {
  it("SESSION_SECRET for previews by default; --env production for production; --replace; anything else in words", () => {
    expect(vercelSecretArgs(["--live"])).toEqual({ name: "SESSION_SECRET", env: "preview", replace: false });
    expect(vercelSecretArgs(["--live", "--env", "production", "--replace"])).toEqual({ name: "SESSION_SECRET", env: "production", replace: true });
    expect(vercelSecretArgs(["--env", "development"])).toEqual({ error: "--env takes preview or production." });
    expect(vercelSecretArgs(["--env"])).toEqual({ error: "--env takes preview or production." });
    expect(vercelSecretArgs(["--prod"])).toMatchObject({ error: expect.stringContaining('Unknown option "--prod"') });
  });

  it("--name CRON_SECRET: production by default (Vercel runs crons on production only), --env preview for a preview; no other name", () => {
    expect(DEFAULT_SECRET_ENV).toEqual({ SESSION_SECRET: "preview", CRON_SECRET: "production" });
    expect(vercelSecretArgs(["--live", "--name", "CRON_SECRET"])).toEqual({ name: "CRON_SECRET", env: "production", replace: false });
    expect(vercelSecretArgs(["--live", "--name", "CRON_SECRET", "--env", "preview", "--replace"])).toEqual({ name: "CRON_SECRET", env: "preview", replace: true });
    expect(vercelSecretArgs(["--live", "--name", "SESSION_SECRET"])).toEqual({ name: "SESSION_SECRET", env: "preview", replace: false });
    expect(vercelSecretArgs(["--name", "KV_REST_API_TOKEN"])).toEqual({ error: "--name takes SESSION_SECRET or CRON_SECRET." });
    expect(vercelSecretArgs(["--name"])).toEqual({ error: "--name takes SESSION_SECRET or CRON_SECRET." });
  });

  it("makes a new 32-byte secret each time (43 base64url characters: SESSION_SECRET and the cron route need 32+), never the same twice", () => {
    const a = newSecret();
    const b = newSecret();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(newSessionSecret()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("adds it as a sensitive variable for that environment only, its value on stdin (never on the command line); --force only to replace", () => {
    expect(envAddArgs("preview", false)).toEqual(["env", "add", "SESSION_SECRET", "preview", "--project", "offersheet", "--sensitive", "--yes"]);
    expect(envAddArgs("production", true)).toEqual(["env", "add", "SESSION_SECRET", "production", "--project", "offersheet", "--sensitive", "--yes", "--force"]);
    expect(envAddArgs("production", false, "CRON_SECRET")).toEqual(["env", "add", "CRON_SECRET", "production", "--project", "offersheet", "--sensitive", "--yes"]);
    const secret = newSecret();
    for (const args of [envAddArgs("preview", false), envAddArgs("production", true), envAddArgs("production", false, "CRON_SECRET")]) expect(args.join(" ")).not.toContain(secret);
  });

  it("cuts the secret out of anything the CLI says", () => {
    expect(withoutSecret("Error: value abc123 rejected; abc123", "abc123")).toBe("Error: value [secret] rejected; [secret]");
    expect(withoutSecret("nothing to cut", "")).toBe("nothing to cut");
  });
});
