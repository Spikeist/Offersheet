/**
 * Yahoo's OAuth 2.0 authorization-code guide (public page, 7-day docs cache): pure parsers so the
 * probe can cite what the guide says (CLAUDE.md §2.4) instead of hard-coding it.
 */

export const YAHOO_AUTH_GUIDE_URL = "https://developer.yahoo.com/oauth2/guide/flows_authcode/";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

/** Crude HTML → text that keeps table cells as " | cell" lines. Good enough for reading docs. */
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

export interface AuthGuideFacts {
  /** Parameter names in "Table 1 Request Authorization URL (/request_auth) Call Request". */
  requestAuthParams: string[];
  /** Step 1 (creating the app project) lists scopes, i.e. permissions are chosen on the app. */
  scopesChosenAtAppCreation: boolean;
  /** The guide says the old refresh token is revoked once a new one is issued. */
  rotationRevokesOld: boolean;
}

/** Null when the page no longer has the request_auth parameter table (layout changed). */
export function parseAuthGuide(text: string): AuthGuideFacts | null {
  const start = text.search(/Table 1 Request Authorization URL/i);
  if (start < 0) return null;
  const rest = text.slice(start);
  const end = rest.search(/Sample URL|Table 2/i);
  const block = end > 0 ? rest.slice(0, end) : rest.slice(0, 2000);
  // Table cells come out as " | cell" (one per line or several per row); parameter names are the
  // cells that are a single snake_case word ("client_id"), never a description sentence.
  const requestAuthParams = [
    ...new Set(
      block
        .split(/\n|\|/)
        .map((c) => c.trim())
        .filter((c) => /^[a-z][a-z_]*$/.test(c)),
    ),
  ];
  const s1 = text.search(/Step 1\b/);
  const s2 = text.search(/Step 2\b/);
  const step1 = s1 >= 0 ? text.slice(s1, s2 > s1 ? s2 : s1 + 1500) : "";
  return {
    requestAuthParams,
    scopesChosenAtAppCreation: /\bscopes?\b/i.test(step1),
    rotationRevokesOld: /revoke\s+the\s+old\s+refresh\s+token/i.test(text),
  };
}
