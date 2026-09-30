/**
 * Phase 0 probe: Yahoo Fantasy (CLAUDE.md §2.4). Yahoo needs an approved app, so today this probe
 * checks that the API host answers, reads Yahoo's OAuth guide, and records items A–M as untested.
 *
 *   npm run probe:yahoo
 *
 * Once YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET are set it runs the browser-free part of 3-legged
 * OAuth and stops with the next step (see scripts/lib/yahoo/flow.ts):
 *   1. no code, no refresh token → writes the authorize URL to .cache/yahoo-oauth/authorize-url.txt
 *      (not printed: it contains the client ID) and explains how to open it;
 *   2. YAHOO_AUTH_CODE set → exchanges it once and writes YAHOO_REFRESH_TOKEN into .env.local
 *      (never printed);
 *   3. YAHOO_REFRESH_TOKEN set → gets a 1-hour access token and looks up the current NFL game key
 *      via game/nfl (never hardcoded). 403 there means Yahoo hasn't enabled the app yet.
 * Even with access live, it does NOT check items A–M: the Yahoo league checklist is Phase 5 work.
 */
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "./lib/cache";
import { ROOT } from "./lib/env";
import { runProbe } from "./lib/probe";
import { runYahoo } from "./lib/yahoo/flow";
import { YAHOO_REFRESH_TOKEN_VAR, upsertEnvLine } from "./lib/yahoo/oauth";

const AUTH_URL_FILE = path.join(ROOT, ".cache", "yahoo-oauth", "authorize-url.txt");
const ENV_FILE = path.join(ROOT, ".env.local");

/** Write the refresh token straight into .env.local (like gen:secret); the value is never printed. */
async function saveRefreshToken(token: string): Promise<void> {
  let text = "";
  try {
    text = await readFile(ENV_FILE, "utf8");
  } catch {
    // no .env.local yet; upsertEnvLine starts a new one
  }
  await writeFileAtomic(ENV_FILE, upsertEnvLine(text, YAHOO_REFRESH_TOKEN_VAR, token));
}

void runProbe("yahoo", (p) =>
  runYahoo(p, {
    saveRefreshToken,
    writeAuthorizeUrl: (url) => writeFileAtomic(AUTH_URL_FILE, url + "\n"),
    print: (text) => console.log(text),
    randomState: () => randomBytes(16).toString("hex"),
    readSharedOutput: async () => {
      try {
        return JSON.parse(await readFile(path.join(ROOT, "reports", "probe-output", "shared.json"), "utf8")) as unknown;
      } catch {
        return undefined;
      }
    },
    readEnvExample: async () => {
      try {
        return await readFile(path.join(ROOT, ".env.example"), "utf8");
      } catch {
        return undefined;
      }
    },
  }),
);
