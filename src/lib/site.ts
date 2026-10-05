/**
 * Offer Sheet's site-wide words and its address (planner reply to Checkpoint 4c, B3: "Home: carry over the landing
 * page's wording"; "Sharing: an SEO title and description, and an Open Graph image").
 *
 * - The title and descriptions are the live placeholder landing page's (offersheet.vercel.app, read on 2026-10-04: its
 *   <title>, meta description, og:title and og:description), carried over word for word.
 * - siteUrl: where the site lives, for metadataBase (absolute og:image URLs), the sitemap and robots.txt. On Vercel,
 *   VERCEL_PROJECT_PRODUCTION_URL ("the shortest production custom domain, or vercel.app domain", set in preview
 *   deployments too, without a protocol); elsewhere the stable copy's address (Part A: http://127.0.0.1:3000). Read at
 *   build time (the pages and these files are static). Never a page's own URL: metadata merging is shallow, so a
 *   canonical or og:url set in the root layout would make every page claim the home page's address.
 * - The contact line of the privacy policy, the terms and the feedback page: CONTACT_EMAIL, null until Parker picks an
 *   address (a Checkpoint 7a question; the 7b go/no-go list carries it). Until then the pages say so visibly
 *   (src/components/ContactLine.tsx).
 * - POLICY_FEATURES: which of Part B's wave-2 features (browser reading, anonymous feedback) those three pages describe;
 *   each page's words follow them, so the pages say what the app does today, whichever have landed.
 */

export const SITE_NAME = "Offer Sheet";

/** The landing page's <title>, word for word: the home page's title, and og:title. */
export const SITE_TITLE = "Offer Sheet — fantasy football trade finder";

/** The landing page's meta description, word for word. */
export const SITE_DESCRIPTION =
  "Offer Sheet reads your fantasy football league and ranks trade ideas by how much they raise your playoff and title odds, and how likely the other manager is to say yes. Free.";

/** The landing page's og:description, word for word. */
export const SHARE_DESCRIPTION = "Trades that help your team, and that your leaguemates will actually accept. Free.";

/** The sharing image's bottom line (src/app/opengraph-image.tsx). */
export const SHARE_IMAGE_TAGLINE = "Free · ESPN and Sleeper · Beta";

/** The sharing image's alt text (og:image:alt): what it shows, in words. */
export const SHARE_IMAGE_ALT = `${SITE_NAME}: trades that help your team, and that your leaguemates will actually accept. Free, for ESPN and Sleeper leagues. Beta.`;

/**
 * The browser's theme color: the site header's navy (globals.css --navy, light and dark), for the viewport's
 * theme-color and the installed app's colors (the manifest takes the light one).
 */
export const THEME_COLOR = "#0b1f33";
export const THEME_COLOR_DARK = "#060d18";

/** The installed app's description (the web app manifest; Chrome shows up to 300 characters on its install screen). */
export const APP_DESCRIPTION = "Trade ideas for your ESPN or Sleeper fantasy football league, ranked by how much they raise your playoff and title odds and how likely the other manager is to say yes. Free and read-only.";

/** Parker's contact address for the privacy policy, the terms and the feedback page; null until he picks one. */
export const CONTACT_EMAIL: string | null = null;

/** What the contact line says until there's an address. */
export const CONTACT_PENDING = "to be added before launch";

/** Part B's features that change what the privacy policy, the terms and the feedback page say (POLICY_FEATURES). */
export interface PolicyFeatures {
  /**
   * Track BF: the browser reads public ESPN leagues (no ESPN cookies connected) and Sleeper leagues itself and sends the
   * server only the parts the adapters keep; the League page sends the saved import back (signed when imported).
   */
  browserReads: boolean;
  /** Track FB: the outcome and Report buttons also send an anonymous copy, unless "Share anonymous feedback" is off. */
  anonymousFeedback: boolean;
}

/**
 * Which of those features the public pages describe as working (review PG-1: a policy must never describe what isn't
 * built). Off until the change that builds each one turns it on; src/app/pages.test.ts fails while a flag and the code
 * disagree (the code each page's sentences rest on), and pins the pages' words both ways. Turning one on changes the
 * privacy policy and the terms: set their LAST_UPDATED to that day. Once both are on for good, the words for "off" (and
 * these flags) can go.
 */
export const POLICY_FEATURES: Readonly<PolicyFeatures> = { browserReads: true, anonymousFeedback: true };

/** The address the site falls back to off Vercel: the stable copy's (Part A, `npm run stable`, port 3000). */
export const LOCAL_SITE_URL = "http://127.0.0.1:3000";

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The site's origin (pure but for the default `env`): https:// plus VERCEL_PROJECT_PRODUCTION_URL when it holds a host
 * name (a value that already starts with http:// or https:// is taken as it is), else LOCAL_SITE_URL. Only the origin
 * is kept: a path or query in the variable is dropped.
 */
export function siteUrl(env: Env = process.env): URL {
  const host = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (host) {
    try {
      const url = new URL(/^https?:\/\//i.test(host) ? host : `https://${host}`);
      if (url.hostname && !url.username && !url.password) return new URL(url.origin);
    } catch {
      // Not a host name: the local address below.
    }
  }
  return new URL(LOCAL_SITE_URL);
}

/** An absolute address on the site, for the sitemap and robots.txt. */
export function siteHref(pathname: string, env: Env = process.env): string {
  return new URL(pathname, siteUrl(env)).href;
}
