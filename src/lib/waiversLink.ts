/**
 * Where the League page's "Waiver upgrades" section lives (planner reply to Checkpoint 7a, §6.2: "League page, linked from
 * the nav"): its element id and the site header's link to it. Dependency-free, so the header (a server component) and the
 * section (src/components/league/WaiverUpgrades.tsx, via src/lib/waiversView.ts) share it without pulling either's code.
 */
export const WAIVERS_SECTION_ID = "waivers";
export const WAIVERS_HREF = `/league#${WAIVERS_SECTION_ID}`;
