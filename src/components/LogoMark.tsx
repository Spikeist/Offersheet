import { FOOTBALL, FOOTBALL_TRANSFORM, LACES, LOGO_BOX, LOGO_TILE_RADIUS, SEAM } from "./logoGeometry";

/**
 * The Offer Sheet mark, a football on a gold tile (src/components/logoGeometry.ts), in the theme's colors (CSS
 * variables, so dark mode follows). Decorative: whatever it sits in carries the name. No state, so the site header and
 * the error pages (src/app/global-error.tsx, a client component) both use it.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox={`0 0 ${LOGO_BOX} ${LOGO_BOX}`} aria-hidden className={className}>
      <rect width={LOGO_BOX} height={LOGO_BOX} rx={LOGO_TILE_RADIUS} fill="var(--accent)" />
      <ellipse cx={FOOTBALL.cx} cy={FOOTBALL.cy} rx={FOOTBALL.rx} ry={FOOTBALL.ry} transform={FOOTBALL_TRANSFORM} fill="var(--navy)" />
      <path d={SEAM.d} fill="none" stroke="var(--accent)" strokeWidth={SEAM.width} strokeLinecap="round" />
      <path d={LACES.d} fill="none" stroke="var(--accent)" strokeWidth={LACES.width} strokeLinecap="round" />
    </svg>
  );
}
