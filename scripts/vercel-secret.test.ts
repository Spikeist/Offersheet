/**
 * npm run vercel:secret (final review SEC-9): its arguments, the secret it makes (never printed), the CLI arguments that
 * carry it on stdin, and that the CLI's answers never show it. No network: the CLI is never run here.
 */
import { describe, expect, it } from "vitest";
import { envAddArgs, newSessionSecret, vercelSecretArgs, withoutSecret } from "./vercel-secret";

describe("vercel:secret", () => {
  it("previews by default; --env production for production; --replace; anything else in words", () => {
    expect(vercelSecretArgs(["--live"])).toEqual({ env: "preview", replace: false });
    expect(vercelSecretArgs(["--live", "--env", "production", "--replace"])).toEqual({ env: "production", replace: true });
    expect(vercelSecretArgs(["--env", "development"])).toEqual({ error: "--env takes preview or production." });
    expect(vercelSecretArgs(["--env"])).toEqual({ error: "--env takes preview or production." });
    expect(vercelSecretArgs(["--prod"])).toMatchObject({ error: expect.stringContaining('Unknown option "--prod"') });
  });

  it("makes a new 32-byte secret each time (43 base64url characters: SESSION_SECRET needs 32+), never the same twice", () => {
    const a = newSessionSecret();
    const b = newSessionSecret();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it("adds it as a sensitive variable for that environment only, its value on stdin (never on the command line); --force only to replace", () => {
    expect(envAddArgs("preview", false)).toEqual(["env", "add", "SESSION_SECRET", "preview", "--project", "offersheet", "--sensitive", "--yes"]);
    expect(envAddArgs("production", true)).toEqual(["env", "add", "SESSION_SECRET", "production", "--project", "offersheet", "--sensitive", "--yes", "--force"]);
    const secret = newSessionSecret();
    for (const args of [envAddArgs("preview", false), envAddArgs("production", true)]) expect(args.join(" ")).not.toContain(secret);
  });

  it("cuts the secret out of anything the CLI says", () => {
    expect(withoutSecret("Error: value abc123 rejected; abc123", "abc123")).toBe("Error: value [secret] rejected; [secret]");
    expect(withoutSecret("nothing to cut", "")).toBe("nothing to cut");
  });
});
