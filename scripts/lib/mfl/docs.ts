/**
 * MFL API documentation (public pages, cached 7 days). CLAUDE.md §2.6 says to read api_info
 * ourselves before writing code; the probe also re-reads it to record what the docs say.
 *
 *   npx tsx scripts/lib/mfl/docs.ts --live <url> <out.txt>     (dumps the page as plain text; only with --live)
 */
import { writeFile } from "node:fs/promises";
import { TTL } from "../cache";
import { request, type HttpResult, type RequestOptions } from "../http";
import { LIVE_FLAG, isMainModule, requireLive } from "../runMode";

/** The docs are HTML pages: cache a 200 page even though it is HTML (the default refuses HTML). */
export const cacheDocPage: NonNullable<RequestOptions["cacheIf"]> = (res) => res.status === 200 && res.text.length > 0;

export function docRequestOptions(url: string): RequestOptions {
  return { retries: 0, cacheIf: cacheDocPage, cache: { key: `mfl-docs:${url}`, ttlMs: TTL.docs, namespace: "docs" }, label: `MFL docs ${new URL(url).pathname}${new URL(url).search}` };
}

export async function fetchDoc(url: string): Promise<HttpResult> {
  return request(url, docRequestOptions(url));
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

/** Crude HTML → text: keeps table rows and list items on their own lines. Good enough for reading docs. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d|\/dt|\/dd|\/table)\b[^>]*>/gi, "\n")
    .replace(/<(td|th)\b[^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e.toLowerCase()] ?? (e.startsWith("#") ? String.fromCharCode(Number(e.slice(1))) : m))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

const norm = (s: string) => s.replace(/\\'/g, "'").replace(/\s+/g, " ").toLowerCase();

/** True when the docs text contains the phrase (whitespace and case insensitive). */
export function docHas(docText: string, phrase: string): boolean {
  return norm(docText).includes(norm(phrase));
}

/**
 * "no access note" means the reference row carries no restriction line. It does NOT mean the TYPE is
 * public for private leagues: the general page says "Data from leagues that are marked as PRIVATE are
 * no longer accessible by users not in the league" (review F13).
 */
export type Access = "no access note" | "private leagues: owners only" | "owners only" | "not documented";

/** The Request Reference text of one export TYPE: its description row up to its argument table. */
export function typeBlock(detailsText: string, type: string, withArgs = false): string | undefined {
  const t = detailsText.replace(/\r/g, "");
  const start = t.indexOf(`| ${type} |`);
  if (start < 0) return undefined;
  const rest = t.slice(start + type.length + 4);
  // Argument rows are " | | L | …" then " | W | …" (UPPER case); the next TYPE row starts lower case.
  const end = rest.search(withArgs ? /\n \| [a-z][A-Za-z_]* \| / : /\n \| \| |\n \| [A-Za-z_]+ \| /);
  return end >= 0 ? rest.slice(0, end) : rest.slice(0, 1500);
}

/**
 * Access note for an export TYPE on the Request Reference page (text from htmlToText): the row reads
 * " | <type> | <description> Test it!" followed by an optional "…access restricted to league owners."
 */
export function typeAccess(detailsText: string, type: string): Access {
  const block = typeBlock(detailsText, type);
  if (block === undefined) return "not documented";
  if (/Private league access restricted to league owners/i.test(block)) return "private leagues: owners only";
  if (/Access restricted to league owners/i.test(block)) return "owners only";
  return "no access note";
}

/** Transaction types listed for TYPE=transactions ("Types are: WAIVER, BBID_WAIVER, … POOL_PICK."). */
export function documentedTransTypes(detailsText: string): string[] {
  const block = typeBlock(detailsText, "transactions", true) ?? "";
  const m = /Types are:\s*([A-Z_,\s]+?)\./.exec(block);
  return m?.[1] ? m[1].split(/[,\s]+/).filter(Boolean) : [];
}

// Run only as a script (an exact path: ../runMode.ts isMainModule), and only with --live.
if (isMainModule(import.meta.url)) {
  requireLive({ script: "scripts/lib/mfl/docs.ts", what: "fetches an MFL docs page", command: "npx tsx scripts/lib/mfl/docs.ts --live <url> <out.txt>" });
  const [url, out] = process.argv.slice(2).filter((a) => a !== LIVE_FLAG);
  if (!url || !out) {
    console.error("usage: npx tsx scripts/lib/mfl/docs.ts --live <url> <out.txt>");
    process.exit(1);
  }
  void (async () => {
    const res = await fetchDoc(url);
    await writeFile(out, `HTTP ${res.status} ${res.contentType} final=${res.finalUrl}\n\n${htmlToText(res.text)}\n`, "utf8");
    console.log(`HTTP ${res.status} ${res.text.length} chars → ${out} (fromCache=${res.fromCache})`);
  })();
}
