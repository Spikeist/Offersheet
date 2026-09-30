/**
 * Cleans up the two ESPN cookie values a user pastes on the Connect page (pure, client-safe; the
 * server runs the same checks). Accepts what people actually copy: surrounding quotes or spaces, a
 * leading "espn_s2=" / "SWID=", a trailing ";", and a SWID without its curly braces.
 *
 * The values work like a password (CLAUDE.md §0.5): messages never echo them back.
 */

export interface EspnCredentialsInput {
  espnS2: string;
  swid: string;
}

export type EspnCredentialsCheck =
  | { ok: true; value: EspnCredentialsInput }
  | { ok: false; field: "espnS2" | "swid"; message: string };

/** espn_s2 is a long URL-encoded token; allow the characters it (or its decoded form) can contain. */
const ESPN_S2_CHARS = /^[A-Za-z0-9%+/=_.\-]+$/;
export const ESPN_S2_MIN_LENGTH = 40;
export const ESPN_S2_MAX_LENGTH = 4000;
const GUID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

function tidy(raw: string, cookieName: string): string {
  let v = raw.trim();
  const prefix = new RegExp(`^${cookieName}\\s*=\\s*`, "i");
  v = v.replace(prefix, "");
  v = v.replace(/;+\s*$/, "").trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) v = v.slice(1, -1).trim();
  return v;
}

export function normalizeEspnS2(raw: string): string | undefined {
  const v = tidy(raw, "espn_s2");
  if (v.length < ESPN_S2_MIN_LENGTH || v.length > ESPN_S2_MAX_LENGTH) return undefined;
  return ESPN_S2_CHARS.test(v) ? v : undefined;
}

/** Returns the SWID with its curly braces ("{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}"). */
export function normalizeSwid(raw: string): string | undefined {
  const v = tidy(raw, "SWID");
  const inner = v.startsWith("{") && v.endsWith("}") ? v.slice(1, -1) : v;
  return GUID.test(inner) ? `{${inner}}` : undefined;
}

export function checkEspnCredentials(input: { espnS2?: unknown; swid?: unknown }): EspnCredentialsCheck {
  const espnS2 = typeof input.espnS2 === "string" ? normalizeEspnS2(input.espnS2) : undefined;
  if (!espnS2) {
    return {
      ok: false,
      field: "espnS2",
      message: "That espn_s2 value doesn't look right. Copy the whole Value of the espn_s2 cookie: it's a long string of letters, numbers and % signs.",
    };
  }
  const swid = typeof input.swid === "string" ? normalizeSwid(input.swid) : undefined;
  if (!swid) {
    return {
      ok: false,
      field: "swid",
      message: "That SWID doesn't look right. It should look like {XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}, curly braces included.",
    };
  }
  return { ok: true, value: { espnS2, swid } };
}
