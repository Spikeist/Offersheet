/**
 * ESPN SWIDs (CLAUDE.md §0.5: a SWID is a secret everywhere) and their one-way pseudonyms (review PRIV-1). Every SWID in
 * an ESPN body (members[].id, teams[].owners, primaryOwner, transaction memberIds) is replaced by its pseudonym BEFORE the
 * body is parsed or cached, so no SWID reaches the server cache or a snapshot; "my team" is found by the pseudonym of the
 * cookie's SWID.
 *
 * Browser-safe (track BF: the browser reads public ESPN leagues itself and pseudonymizes each body before sending it to
 * the server, which pseudonymizes again on arrival): the hash is src/lib/sha256.ts, the same on both sides, so a league
 * read by the browser carries exactly the pseudonyms the server's own read would (sha256.test.ts checks it against
 * node:crypto; the pseudonyms are the ones the server cache has always held).
 */
import { sha256Hex } from "@/lib/sha256";

/** "{guid}" in any case, with or without braces → "{GUID}" for comparison (also a pseudonym's form). */
export function normalizeSwid(swid: string): string {
  const inner = swid.trim().replace(/^\{/, "").replace(/\}$/, "");
  return `{${inner.toUpperCase()}}`;
}

const GUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** A SWID as ESPN writes it: a braced GUID, literally or %-encoded ({…} / %7B…%7D). */
const BRACED_GUID = new RegExp(`(?:\\{|%7B)(${GUID})(?:\\}|%7D)`, "gi");
const BARE_GUID = new RegExp(`\\b${GUID}\\b`, "gi");
const GUID_ONLY = new RegExp(`^${GUID}$`, "i");

/**
 * A SWID's one-way pseudonym, "{pseudo:<24 hex>}": the same SWID in any case or form always gives the
 * same pseudonym, which can't be mistaken for a SWID (it isn't GUID-shaped) or turned back into one.
 */
export function swidPseudonym(swid: string): string {
  return `{pseudo:${sha256Hex(`espn-swid:${normalizeSwid(swid)}`).slice(0, 24)}}`;
}

/**
 * Replace every SWID in an ESPN body with its pseudonym: braced GUIDs (how ESPN writes SWIDs in
 * members[].id, teams[].owners, primaryOwner and transaction memberIds), %7B…%7D-encoded ones, and
 * any bare copy of a GUID that appears braced in the same body or is one of `known` (the cookie
 * holder's SWID). Other bare GUIDs, such as transaction ids, are left alone. A body already pseudonymized comes back
 * unchanged (its pseudonyms aren't GUID-shaped).
 */
export function pseudonymizeSwids(text: string, known: readonly string[] = []): string {
  const swids = new Set<string>();
  for (const k of known) {
    const guid = normalizeSwid(k).slice(1, -1);
    if (GUID_ONLY.test(guid)) swids.add(guid);
  }
  let out = text.replace(BRACED_GUID, (_m, guid: string) => {
    swids.add(guid.toUpperCase());
    return swidPseudonym(guid);
  });
  if (swids.size) out = out.replace(BARE_GUID, (m) => (swids.has(m.toUpperCase()) ? swidPseudonym(m).slice(1, -1) : m));
  return out;
}
