/**
 * The keyboard focus ring's colors (src/app/globals.css): WCAG asks a focus indicator for 3 : 1 against what's next to
 * it. Review of Phase 4b: the bright gold (--accent, #f2b705) was only 1.8 : 1 on a white card and 1.7 on the page, so
 * light mode's ring is a darker gold (--focus), dark mode's stays the bright one, and on navy panels the bright gold
 * comes back. Read from the stylesheet itself, so a change of either color is checked.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "globals.css"), "utf8");

/** The `:root` block before the dark-mode media query, and the dark one inside it. */
const light = css.slice(css.indexOf(":root {"), css.indexOf("@media (prefers-color-scheme: dark)"));
const dark = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"), css.indexOf("@theme inline"));

function token(block: string, name: string): string {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(block);
  if (!m?.[1]) throw new Error(`--${name} not found`);
  return m[1];
}

/** WCAG relative luminance and contrast ratio. */
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

describe("the keyboard focus ring (review of Phase 4b)", () => {
  it("is at least 3 : 1 against every background it sits on, in light and dark mode", () => {
    for (const [block, mode] of [
      [light, "light"],
      [dark, "dark"],
    ] as const) {
      const focus = token(block, "focus");
      for (const bg of ["background", "surface", "surface-muted", "brand-soft", "warn-bg"]) {
        expect(contrast(focus, token(block, bg)), `${mode}: --focus on --${bg}`).toBeGreaterThanOrEqual(3);
      }
    }
    // The light ring on a navy panel, and the bright gold that navy panels use instead.
    expect(contrast(token(light, "focus"), token(light, "navy"))).toBeGreaterThanOrEqual(3);
    expect(contrast(token(light, "accent"), token(light, "navy"))).toBeGreaterThanOrEqual(3);
    // The old ring for the record: the bright gold on a white card.
    expect(contrast(token(light, "accent"), token(light, "surface"))).toBeLessThan(3);
  });

  it("draws every focus outline in the focus token (navy panels: the bright gold), never --accent on light backgrounds", () => {
    const rules = [...css.matchAll(/:focus-visible\s*\{([^}]*)\}/g)].map((m) => m[1] ?? "");
    expect(rules.length).toBeGreaterThanOrEqual(3);
    for (const r of rules.filter((x) => x.includes("outline:"))) expect(r).toContain("var(--focus)");
    expect(css).toMatch(/\.bg-navy :where\([^)]*\):focus-visible\s*\{\s*outline-color: var\(--accent\);/);
    expect(css).toContain("--color-focus: var(--focus);");
  });
});
