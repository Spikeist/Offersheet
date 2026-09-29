/**
 * Probe runner: wires env, scrubbing, polite HTTP, fixtures, the sanitizer and the checklist.
 *
 *   runProbe("espn", async (p) => {
 *     const { data, res } = await p.getJson(url, { cookie, cache: p.leagueCache(url, scope) });
 *     await p.saveRaw(`league:${id}:mSettings`, data, res);
 *     p.redactor.register(...);                                   // leaguemates' identities
 *     await p.saveSanitized("league:{leagueId}:mSettings", data, res, { protect });
 *     p.cl.ok("A", "A.season", "Season", "2026", { path: "seasonId", sample: 2026, url: p.safeUrl(url) });
 *   });
 *
 * Console output, report files and fixture labels all pass through the .env.local scrubber and the
 * platform Redactor. The probe exits 0 when it ran (even with ❌ items) and 2 if it crashed.
 */
import { Checklist } from "./checklist";
import { TTL, credentialScope } from "./cache";
import { env, envStatus } from "./env";
import { saveRawFixture, saveSanitizedFixture, type FixtureMeta } from "./fixtures";
import { getJson, request, requestLog, type HttpResult, type RequestOptions } from "./http";
import { installConsoleScrubber, registerScrubber, scrubEverything } from "./redact";
import { Redactor, type ApplyOptions } from "./sanitize";

export interface ProbeContext {
  platform: string;
  cl: Checklist;
  redactor: Redactor;
  env: typeof env;
  envStatus: typeof envStatus;
  request: typeof request;
  getJson: typeof getJson;
  /** URL safe for reports: .env.local values and registered leaguemate values replaced. */
  safeUrl(url: string): string;
  /** Cache options for league data (10 min TTL). Pass a credential scope for private leagues. */
  leagueCache(key: string, credential?: string[]): NonNullable<RequestOptions["cache"]>;
  /** Save the exact response (git-ignored). */
  saveRaw(key: string, body: unknown, res?: HttpResult | FixtureMeta, ext?: string): Promise<string>;
  /**
   * Sanitize `raw` with the redactor and save it. `label` must already be placeholder-only
   * (e.g. "league:{leagueId}:view=mSettings"). Throws LeakError if anything sensitive remains.
   */
  saveSanitized(label: string, raw: unknown, res?: HttpResult | FixtureMeta, opts?: ApplyOptions, ext?: string): Promise<string>;
  /** Time an async step; timings are saved in the report. */
  timed<T>(label: string, fn: () => Promise<T>): Promise<T>;
  timings: Record<string, number>;
}

function toMeta(res?: HttpResult | FixtureMeta): FixtureMeta {
  if (!res) return {};
  if ("finalUrl" in res) return { url: res.url, status: res.status, contentType: res.contentType };
  return res;
}

export async function runProbe(platform: string, body: (p: ProbeContext) => Promise<void>): Promise<void> {
  const redactor = new Redactor(platform);
  installConsoleScrubber(redactor);
  registerScrubber(redactor);
  const cl = new Checklist(platform, (t) => redactor.scrubText(t));
  const timings: Record<string, number> = {};
  const safeUrl = (url: string) => redactor.scrubText(scrubEverything(url));

  const ctx: ProbeContext = {
    platform,
    cl,
    redactor,
    env,
    envStatus,
    request,
    getJson,
    safeUrl,
    leagueCache: (key, credential) => ({
      key: credential?.length ? `${platform}:${credentialScope(...credential)}:${key}` : `${platform}:public:${key}`,
      ttlMs: TTL.league,
      namespace: `league-${platform}`,
    }),
    saveRaw: (key, data, res, ext) => saveRawFixture(platform, key, data, toMeta(res), ext),
    saveSanitized: (label, raw, res, opts, ext) => {
      const clean = typeof raw === "string" ? redactor.scrubText(raw) : redactor.apply(raw, opts);
      const meta = toMeta(res);
      return saveSanitizedFixture(platform, label, clean, { ...meta, url: meta.url && safeUrl(meta.url) }, { redactor, opts }, ext);
    },
    timed: async (label, fn) => {
      const t0 = Date.now();
      try {
        return await fn();
      } finally {
        timings[label] = (timings[label] ?? 0) + (Date.now() - t0);
      }
    },
    timings,
  };

  console.log(`\n### probe: ${platform}\n`);
  let crashed = false;
  try {
    await body(ctx);
  } catch (err) {
    crashed = true;
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    cl.fail("RUN", "run.crash", "Probe run", `crashed: ${msg}`);
    if (err instanceof Error && err.stack) console.error(err.stack);
  } finally {
    await redactor.saveMap();
    cl.meta.timingsMs = timings;
    cl.meta.requestCount = requestLog.length;
    cl.printSummary();
    const out = await cl.save();
    console.log(`    saved: ${out.md.replace(/\\/g, "/")}`);
  }
  process.exitCode = crashed ? 2 : 0;
}
