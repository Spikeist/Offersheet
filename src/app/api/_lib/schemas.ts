/**
 * Request bodies the API accepts (zod). Messages are written for users and never echo a value.
 * Unknown fields are ignored.
 */
import { z } from "zod";
import { ESPN_S2_MAX_LENGTH } from "@/lib/espnCredentials";
import { SLEEPER_USERNAME_INVALID, normalizeSleeperUsername, parseSleeperLeagueInput } from "@/lib/sleeperInput";

/** "" → undefined, so an empty form field counts as "not given". */
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const seasonField = z.coerce.number({ error: "Pick a season." }).int("Pick a season.");
/** The Import Report's Refresh button: skip league data cached more than a minute ago (§2.10). */
const refreshField = z.boolean().optional();

export const espnImportBodySchema = z.object({
  leagueId: z.coerce.string().trim().regex(/^\d{1,12}$/, "Enter your ESPN league ID (a number) or paste the league link."),
  season: seasonField,
  myTeamId: z.preprocess(blankToUndefined, z.coerce.string().trim().regex(/^\d{1,4}$/, "That team doesn't look right.").optional()),
  refresh: refreshField,
});

const sleeperUsername = z.string().transform((v, ctx) => {
  const name = normalizeSleeperUsername(v);
  if (!name) ctx.addIssue({ code: "custom", message: SLEEPER_USERNAME_INVALID });
  return name ?? "";
});
/** An optional username (trimmed, without a leading @); a blank one counts as not given. */
const optionalSleeperUsername = z.preprocess(blankToUndefined, sleeperUsername.optional());

const sleeperLeagueId = z.coerce.string().transform((v, ctx) => {
  const parsed = parseSleeperLeagueInput(v);
  if (!parsed.ok) ctx.addIssue({ code: "custom", message: parsed.message });
  return parsed.ok ? parsed.leagueId : "";
});

/** A username finds the user's leagues (and their team); a league ID or link picks one directly. Both together work too. */
export const sleeperImportBodySchema = z
  .object({
    season: seasonField,
    username: optionalSleeperUsername,
    leagueId: z.preprocess(blankToUndefined, sleeperLeagueId.optional()),
    chooseLeagueId: z.preprocess(blankToUndefined, z.coerce.string().trim().regex(/^\d{5,25}$/, "Pick one of your leagues.").optional()),
    refresh: refreshField,
  })
  .refine((b) => Boolean(b.username) || Boolean(b.leagueId), { message: "Enter your Sleeper username or a league ID." });

/**
 * POST /api/model/espn (src/lib/api.ts EspnModelBody): the import's league ID, season and Refresh.
 * The League page never sends a team; a myTeamId in the body is ignored like any unknown field.
 */
export const espnModelBodySchema = espnImportBodySchema.pick({ leagueId: true, season: true, refresh: true });

/**
 * POST /api/model/sleeper (SleeperModelBody): the league ID is required here (the League page sends
 * the imported league's), with the Connect page's checks and messages; a missing one reads as blank.
 * The username the league was imported with is optional, checked as on the import route: with it the
 * re-import finds the user's team, as the import did.
 */
export const sleeperModelBodySchema = z.object({
  season: seasonField,
  leagueId: z.preprocess((v) => blankToUndefined(v) ?? "", sleeperLeagueId),
  username: optionalSleeperUsername,
  refresh: refreshField,
});

/** Raw strings only; src/lib/espnCredentials.ts does the real checks (and the same ones in the browser). */
export const espnSessionBodySchema = z.object({
  espnS2: z.string({ error: "Paste your espn_s2 cookie." }).max(ESPN_S2_MAX_LENGTH + 100, "That espn_s2 value is too long."),
  swid: z.string({ error: "Paste your SWID cookie." }).max(200, "That SWID is too long."),
});
