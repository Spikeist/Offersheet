/**
 * Gzip request bodies (planner reply to Checkpoint 4c, Part B, B1: browser fetching; track BF): a league the browser read
 * itself, posted to the import routes (src/adapters/upload.ts LeagueUpload), and a saved import with its signature,
 * posted to the model routes (src/server/importToken.ts). Both come as Content-Type application/gzip (a gzip file, not a
 * Content-Encoding: nothing between the browser and the route unpacks it).
 *
 * - The body is refused unread once it passes its compressed cap, and while unpacking once it passes its unpacked cap (a
 *   zip bomb stops there): uploadLimits for a league upload, signedUploadLimits for a signed import (final review SEC-1:
 *   both lowered, 2 MB / 6 MB and 1 MB / 4 MB, since parsing is the cost); then it must be UTF-8 JSON in the shape below
 *   (zod, strict: an unknown field is refused), a league upload's parts only the league-data reads a browser makes, each
 *   once (uploadPartsProblem). Anything wrong is BAD_UPLOAD, which the browser answers by asking the server to read the
 *   league itself (src/lib/leagueFetch.ts), so a user never sees it.
 * - An import upload's ESPN text has its SWIDs pseudonymized before it's parsed (src/adapters/espn/swid.ts), as the
 *   server's own read does (the browser already did; this is the server's guarantee).
 * - Nothing here logs or keeps a body: what the browser sends serves that one request and is never cached (a forged copy
 *   under a league's key would reach its leaguemates).
 */
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { z } from "zod";
import { ESPN_READS_BASE } from "@/adapters/espn/leagueData";
import { pseudonymizeSwids } from "@/adapters/espn/swid";
import { SLEEPER_API } from "@/adapters/sleeper/leagueData";
import { mapSleeperScoring } from "@/adapters/sleeper/scoringMap";
import { UPLOAD_VERSION, isLeagueDataRead, uploadShapeProblem, uploadTimesProblem, type LeagueUpload, type UploadPart } from "@/adapters/upload";
import type { LeagueSnapshot } from "@/engine/model";
import { SLEEPER_USERNAME_INVALID, normalizeSleeperUsername } from "@/lib/sleeperInput";
import { browserFetchLimits, signedUploadLimits, uploadLimits, uploadShapeLimits } from "@/server/limits";
import { relevantPlayerIds } from "@/server/modelInputs";

const gunzipAsync = promisify(gunzip);

/** The content type of a gzip body (application/x-gzip too, as some tools write it). */
export function isGzipRequest(request: Request): boolean {
  const type = (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  return type === "application/gzip" || type === "application/x-gzip";
}

export type UploadRead<T> = { ok: true; value: T } | { ok: false; why: string };

/** The body's bytes, or null as soon as they pass `max` (never buffers more than that). */
async function readBytesCapped(request: Request, max: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return bytes;
}

/** A gzip body unpacked to text within the caps (see the header). */
export async function readGzipText(request: Request, limits: { compressedBytes: number; unpackedBytes: number } = uploadLimits): Promise<UploadRead<string>> {
  if (!isGzipRequest(request)) return { ok: false, why: "not gzip" };
  let packed: Uint8Array | null;
  try {
    packed = await readBytesCapped(request, limits.compressedBytes);
  } catch {
    return { ok: false, why: "unreadable" };
  }
  if (!packed) return { ok: false, why: "too large" };
  let unpacked: Buffer;
  try {
    unpacked = await gunzipAsync(packed, { maxOutputLength: limits.unpackedBytes });
  } catch {
    return { ok: false, why: "not gzip, or too large unpacked" };
  }
  try {
    return { ok: true, value: new TextDecoder("utf-8", { fatal: true }).decode(unpacked) };
  } catch {
    return { ok: false, why: "not UTF-8" };
  }
}

/** JSON text, parsed (undefined when it isn't JSON). */
function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

const season = z.number().int().min(2000).max(2100);

const espnLeagueId = z.string().regex(/^\d{1,12}$/);

/** A Sleeper league ID as the browser sends it: the bare number (src/lib/sleeperInput.ts reads what users type). */
const sleeperLeagueId = z.string().regex(/^\d{5,25}$/);

const sleeperUsername = z.string().transform((v, ctx) => {
  const name = normalizeSleeperUsername(v);
  if (!name) ctx.addIssue({ code: "custom", message: SLEEPER_USERNAME_INVALID });
  return name ?? "";
});

/** One part of an upload (src/adapters/upload.ts UploadPart), its address the platform's own. */
function partSchema(base: string) {
  return z.strictObject({
    url: z
      .string()
      .max(2_000)
      .refine((u) => u.startsWith(`${base}/`)),
    filter: z.string().max(100_000).optional(),
    status: z.number().int().min(0).max(599),
    html: z.literal(true).optional(),
    json: z.unknown().optional(),
    at: z.number().finite(),
  });
}

const espnUploadSchema = z.strictObject({
  v: z.literal(UPLOAD_VERSION),
  platform: z.literal("espn"),
  request: z.strictObject({ leagueId: espnLeagueId, season }),
  sentAt: z.number().finite(),
  parts: z.array(partSchema(ESPN_READS_BASE)).max(browserFetchLimits.maxParts),
});

const sleeperUploadSchema = z.strictObject({
  v: z.literal(UPLOAD_VERSION),
  platform: z.literal("sleeper"),
  request: z.strictObject({ leagueId: sleeperLeagueId, season, username: sleeperUsername.optional() }),
  sentAt: z.number().finite(),
  parts: z.array(partSchema(SLEEPER_API)).max(browserFetchLimits.maxParts),
});

/**
 * Why an upload's parts aren't what a browser's read of a league makes, or null (final review SEC-1): a part at an address
 * the browser path never reads (src/adapters/upload.ts isLeagueDataRead: anything but the league-data reads, such as
 * projections or player lists, the server's own to read), or the same request twice (the browser keeps one answer per
 * address and ESPN filter: src/adapters/upload.ts recordingClient). Either way the server would only parse and keep more
 * than an honest read sends.
 */
export function uploadPartsProblem(parts: readonly Pick<UploadPart, "url" | "filter">[]): string | null {
  const seen = new Set<string>();
  for (const p of parts) {
    if (!isLeagueDataRead(p.url)) return "a response the browser doesn't read";
    const key = `${p.url}\u0000${p.filter ?? ""}`;
    if (seen.has(key)) return "the same response twice";
    seen.add(key);
  }
  return null;
}

/**
 * A league upload posted to an import route (see the header): unpacked, its ESPN SWIDs pseudonymized, parsed and checked
 * (its shape, the platform's own league-data addresses, each once, every part at most browserFetchLimits.maxPartAgeMs
 * older than the upload, and no more in it than a real league holds: uploadShapeLimits, review BF-R1).
 */
export async function readLeagueUpload(request: Request, platform: "espn" | "sleeper"): Promise<UploadRead<LeagueUpload>> {
  const text = await readGzipText(request);
  if (!text.ok) return text;
  const json = parseJsonText(platform === "espn" ? pseudonymizeSwids(text.value) : text.value);
  if (json === undefined) return { ok: false, why: "not JSON" };
  const parsed = (platform === "espn" ? espnUploadSchema : sleeperUploadSchema).safeParse(json);
  if (!parsed.success) return { ok: false, why: "not an upload" };
  const upload = parsed.data as LeagueUpload;
  const parts = uploadPartsProblem(upload.parts);
  if (parts) return { ok: false, why: parts };
  const times = uploadTimesProblem(upload, browserFetchLimits.maxPartAgeMs);
  if (times) return { ok: false, why: times };
  const shape = uploadShapeProblem(upload, uploadShapeLimits) ?? (platform === "sleeper" ? sleeperScoringProblem(upload) : null);
  if (shape) return { ok: false, why: shape };
  return { ok: true, value: upload };
}

/**
 * Why a Sleeper upload's scoring makes more rules than any real league's, or null (review BF-R1; uploadShapeLimits
 * .sleeperScoringRules): the import scores every free agent's projected weeks under each of them. The scoring map the
 * normalizer itself uses counts them; a league body it can't read is the normalizer's to turn down.
 */
function sleeperScoringProblem(upload: LeagueUpload): string | null {
  const league = upload.parts.find((p) => /^\/v1\/league\/\d+$/.test(pathOf(p.url)))?.json;
  const scoring = league && typeof league === "object" ? (league as { scoring_settings?: unknown }).scoring_settings : undefined;
  if (!scoring || typeof scoring !== "object" || Array.isArray(scoring)) return null;
  return mapSleeperScoring(scoring as Record<string, unknown>).scoring.rules.length > uploadShapeLimits.sleeperScoringRules ? "more scoring rules than a Sleeper league has" : null;
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

/**
 * The model build's work for a snapshot (review BF-R1; uploadShapeLimits.modelWork): the players it scores (every rostered
 * player and free agent: src/server/modelInputs.ts relevantPlayerIds) times the league's scoring rules, a stepped rule
 * counted steppedRuleWeight times. The scoring of each player's weeks is what a model build spends its time on. A part
 * the snapshot lacks counts as empty.
 */
export function modelWorkOf(snapshot: Pick<LeagueSnapshot, "teams" | "freeAgents" | "settings">): number {
  const rules = snapshot.settings?.scoring?.rules ?? [];
  const stepped = rules.filter((r) => r.kind === "stepped").length;
  const complete = (snapshot.teams ?? []).map((t) => ({ ...t, roster: t.roster ?? [], ir: t.ir ?? [], taxi: t.taxi ?? [] }));
  const players = relevantPlayerIds({ teams: complete, freeAgents: snapshot.freeAgents ?? [] }).length;
  return players * (rules.length - stepped + stepped * uploadShapeLimits.steppedRuleWeight);
}

/**
 * Why an import made from a browser's upload can't be signed and kept, or null (review BF-R1): its model build would cost
 * more than any real league's (modelWorkOf over uploadShapeLimits.modelWork). The import route answers BAD_UPLOAD, and the
 * browser asks the server to read the league itself (a real league that big is read and built from the platform's own
 * answers, as before Part B).
 */
export function uploadedImportProblem(snapshot: Pick<LeagueSnapshot, "teams" | "freeAgents" | "settings">): string | null {
  return modelWorkOf(snapshot) > uploadShapeLimits.modelWork ? "more players and scoring rules than a league's model can take from a browser" : null;
}

/** A saved import with its signature, posted to a model route (src/lib/api.ts SignedModelBody). */
export interface SignedModelUpload {
  leagueId: string;
  season: number;
  username?: string;
  /** The import as the browser saved it, exactly as parsed (its signature covers this object). */
  import: { snapshot: Record<string, unknown>; modelPart: Record<string, unknown> };
  signed: { issuedAt: number; token: string };
}

const signedImportShape = {
  v: z.literal(UPLOAD_VERSION),
  season,
  import: z.strictObject({ snapshot: z.record(z.string(), z.unknown()), modelPart: z.record(z.string(), z.unknown()) }),
  signed: z.strictObject({ issuedAt: z.number().int(), token: z.string().max(200) }),
};

const espnSignedSchema = z.strictObject({ ...signedImportShape, leagueId: espnLeagueId });
const sleeperSignedSchema = z.strictObject({ ...signedImportShape, leagueId: sleeperLeagueId, username: sleeperUsername.optional() });

/**
 * A model route's gzip body (see the header), within its own caps (signedUploadLimits; final review SEC-1: checking the
 * signature hashes the whole snapshot). The import comes back as it was parsed, not as zod copied it, so its signature is
 * checked on exactly what the browser sent (src/server/importToken.ts).
 */
export async function readSignedModelUpload(request: Request, platform: "espn" | "sleeper"): Promise<UploadRead<SignedModelUpload>> {
  const text = await readGzipText(request, signedUploadLimits);
  if (!text.ok) return text;
  const json = parseJsonText(text.value);
  if (json === undefined) return { ok: false, why: "not JSON" };
  let fields: { leagueId: string; season: number; username?: string | undefined; signed: SignedModelUpload["signed"] };
  if (platform === "espn") {
    const parsed = espnSignedSchema.safeParse(json);
    if (!parsed.success) return { ok: false, why: "not a signed import" };
    fields = parsed.data;
  } else {
    const parsed = sleeperSignedSchema.safeParse(json);
    if (!parsed.success) return { ok: false, why: "not a signed import" };
    fields = parsed.data;
  }
  const original = (json as { import: SignedModelUpload["import"] }).import;
  const { leagueId, season: year, username, signed } = fields;
  return { ok: true, value: { leagueId, season: year, ...(username ? { username } : {}), import: { snapshot: original.snapshot, modelPart: original.modelPart }, signed } };
}
