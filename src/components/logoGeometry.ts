/**
 * The Offer Sheet mark, a navy football on a gold tile, in a 32-unit box: drawn once, here, for the site header's
 * LogoMark (LogoMark.tsx, in the theme's colors: CSS variables, so dark mode follows), the app icons
 * (scripts/make-icons.ts: src/app/icon.svg, favicon.ico, apple-icon.png and the install icons in public/icons/) and the
 * sharing image (src/app/opengraph-image.tsx). An icon file can't read the page's CSS variables, so those use the light
 * theme's colors written in (LOGO_GOLD and LOGO_NAVY: globals.css --accent and --navy; pages.test.ts checks they match).
 *
 * Planner reply to Checkpoint 4c, B3 ("Installable: a PWA manifest and icons"). ⚠️ Which mark is a question for Parker
 * (Checkpoint 7a): the app's football on gold (this one) or the old landing page's green lines.
 */

/** The mark's box: every coordinate below is in these units. */
export const LOGO_BOX = 32;

/** The light theme's --accent (gold) and --navy (src/app/globals.css). */
export const LOGO_GOLD = "#f2b705";
export const LOGO_NAVY = "#0b1f33";

/** The tile's corner radius (the header's mark and the "any" install icons; the iOS and maskable icons are square). */
export const LOGO_TILE_RADIUS = 8;

/** The football: an ellipse turned 35° counter-clockwise about the box's center. */
export const FOOTBALL = { cx: 16, cy: 16, rx: 11, ry: 7, rotate: -35 } as const;

/** The seam along the football and its three laces, drawn in the tile's gold. */
export const SEAM = { d: "M12.5 19.5l7-7", width: 1.6 } as const;
export const LACES = { d: "M14 15.4l1.6 1.6M15.7 13.7l1.6 1.6M17.4 12l1.6 1.6", width: 1.3 } as const;

/** The ellipse's transform attribute. */
export const FOOTBALL_TRANSFORM = `rotate(${FOOTBALL.rotate} ${FOOTBALL.cx} ${FOOTBALL.cy})`;

export interface LogoSvgOptions {
  /** Width and height in px written on the <svg> (absent: the viewBox alone, for a file that scales). */
  size?: number;
  /**
   * "rounded": the header's tile, its corners see-through (the favicon and the "any" install icons). "square": the tile
   * fills the whole image, for icons the system cuts its own shape from (iOS's home screen, Android's maskable icon).
   */
  tile?: "rounded" | "square";
}

/**
 * The mark as a standalone SVG document with its colors written in (pure). The football's tips reach 11 units from the
 * center: inside a maskable icon's safe zone (a centered circle of radius 40% of the width, 12.8 units) and clear of
 * iOS's rounded corners, so one drawing serves every icon.
 */
export function logoSvg(opts: LogoSvgOptions = {}): string {
  const tile = opts.tile ?? "rounded";
  const dims = opts.size !== undefined ? ` width="${opts.size}" height="${opts.size}"` : "";
  const corner = tile === "rounded" ? ` rx="${LOGO_TILE_RADIUS}"` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LOGO_BOX} ${LOGO_BOX}"${dims}>` +
    `<rect width="${LOGO_BOX}" height="${LOGO_BOX}"${corner} fill="${LOGO_GOLD}"/>` +
    `<ellipse cx="${FOOTBALL.cx}" cy="${FOOTBALL.cy}" rx="${FOOTBALL.rx}" ry="${FOOTBALL.ry}" transform="${FOOTBALL_TRANSFORM}" fill="${LOGO_NAVY}"/>` +
    `<path d="${SEAM.d}" fill="none" stroke="${LOGO_GOLD}" stroke-width="${SEAM.width}" stroke-linecap="round"/>` +
    `<path d="${LACES.d}" fill="none" stroke="${LOGO_GOLD}" stroke-width="${LACES.width}" stroke-linecap="round"/>` +
    `</svg>`
  );
}
