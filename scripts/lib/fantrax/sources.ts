/**
 * Cached loaders the Fantrax probe needs. The DynastyProcess ID map uses the same cache key and
 * namespace as scripts/lib/shared/fetch.ts ("idmap:<url>"), so every probe shares one download per
 * day (§2.10). Fantrax's league-independent lists get the 24 h players-DB TTL.
 */
import { parse } from "csv-parse/sync";
import { TTL } from "../cache";
import { request, type HttpResult } from "../http";

export const DP_IDMAP_URL = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv";

export async function fetchDpIdMap(): Promise<{ rows: Array<Record<string, string>>; res: HttpResult }> {
  const res = await request(DP_IDMAP_URL, { cache: { key: `idmap:${DP_IDMAP_URL}`, ttlMs: TTL.idMap, namespace: "idmap" }, timeoutMs: 180_000, label: "DynastyProcess db_playerids.csv" });
  if (!res.ok || res.isHtml) return { rows: [], res };
  const rows = parse<Record<string, string>>(res.text, { columns: true, skip_empty_lines: true, bom: true });
  return { rows, res };
}

/** Cache options for Fantrax's public, league-independent endpoints (getPlayerIds, getAdp). */
export function fantraxPublicCache(url: string) {
  return { key: `fantrax:public:${url}`, ttlMs: TTL.sleeperPlayers, namespace: "fantrax-public" };
}
