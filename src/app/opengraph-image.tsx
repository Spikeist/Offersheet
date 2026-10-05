import { ImageResponse } from "next/og";
import { LOGO_GOLD, LOGO_NAVY, logoSvg } from "@/components/logoGeometry";
import { SHARE_IMAGE_ALT, SHARE_IMAGE_TAGLINE, SITE_NAME } from "@/lib/site";

/**
 * The sharing image (planner reply to Checkpoint 4c, B3: "Sharing: an SEO title and description, and an Open Graph
 * image"): 1200 × 630, the navy of the site header, the gold mark, the home page's headline (its last two words in
 * gold, as on the page) and "Free · ESPN and Sleeper · Beta". Next makes it once, at build time (no request-time API),
 * and links it from every page as og:image, and as twitter:image too (Next copies the Open Graph image into the Twitter
 * card and sets summary_large_image).
 *
 * The only font next/og carries is Geist Regular, and there's no other font in the project to give it (nothing is
 * downloaded at build), so the headline is drawn in it with a thin outline of its own color to read heavier.
 */

export const alt = SHARE_IMAGE_ALT;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The home page's h1, word by word; the last two in gold (src/app/page.tsx: "actually accept" in text-accent). */
const HEADLINE = "Trades that help your team, and that your leaguemates will actually accept.".split(" ");
const GOLD_FROM = HEADLINE.length - 2;

/** The light theme's --navy-contrast (globals.css): the header's text color. */
const INK = "#f4f7fb";

const MARK_SRC = `data:image/svg+xml;base64,${Buffer.from(logoSvg({ size: 112 })).toString("base64")}`;

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: LOGO_NAVY, color: INK, padding: "64px 72px" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- next/og draws plain <img> elements (no next/image here). */}
          <img src={MARK_SRC} width={112} height={112} alt="" />
          <div style={{ display: "flex", marginLeft: 28, fontSize: 56, letterSpacing: -1, WebkitTextStroke: `1.5px ${INK}` }}>{SITE_NAME}</div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", maxWidth: 1040, fontSize: 68, lineHeight: 1.12, letterSpacing: -1.5, WebkitTextStroke: `2px ${INK}` }}>
          {HEADLINE.map((word, i) => (
            <span key={i} style={{ marginRight: 18, ...(i >= GOLD_FROM ? { color: LOGO_GOLD, WebkitTextStroke: `2px ${LOGO_GOLD}` } : {}) }}>
              {word}
            </span>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", fontSize: 36, color: LOGO_GOLD }}>{SHARE_IMAGE_TAGLINE}</div>
      </div>
    ),
    { ...size },
  );
}
