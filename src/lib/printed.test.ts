/**
 * How a trade card prints its numbers (src/lib/printed.ts; Checkpoint 7d: moved out of tradeView.ts so the feedback export
 * prints a record's own numbers as its card did, planner reply to Checkpoint 7c, answer 1). The chance's words are tested at
 * length with the card (tradeView.test.ts "small words"); here, the score's, and that the view re-exports these very functions.
 */
import { describe, expect, it } from "vitest";
import { config } from "@/engine/config";
import { acceptSrText, acceptText, printedScore, throughText, underStep } from "./printed";
import * as view from "./tradeView";

describe("printed numbers", () => {
  it("prints a 0–100 score: its number; 0 for a trade that doesn't help (B ≤ 0); — when it wasn't scored", () => {
    expect(printedScore(57, 4.2)).toBe("57");
    expect(printedScore(0, 0.01)).toBe("0");
    expect(printedScore(null, -0.4)).toBe("0");
    expect(printedScore(null, 0)).toBe("0");
    expect(printedScore(null, null)).toBe("—");
    expect(printedScore(Number.NaN, 2)).toBe("—");
  });

  it("prints the chance as §11 shows it: the nearest 5%, “<5%” under 5%, and the chance it goes through only when that prints differently", () => {
    const step = Math.round(config.acceptance.displayStep * 100);
    expect([acceptText(0.42), acceptText(0.049), acceptText(0.05), acceptText(0.851)]).toEqual(["40%", `<${step}%`, "5%", "85%"]);
    expect([acceptSrText(0.03), acceptSrText(0.42)]).toEqual([`under ${step}%`, "40%"]);
    expect([throughText(0.4, 0.2), throughText(0.4, 0.4), throughText(0.08, 0.04), throughText(0.03, 0.02)]).toEqual(["about 20%", null, `under ${step}%`, null]);
    expect([underStep(0.049), underStep(0.05), underStep(Number.NaN)]).toEqual([true, false, false]);
  });

  it("is what the Trade Finder's view prints with (tradeView.ts re-exports the same functions)", () => {
    expect(view.acceptText).toBe(acceptText);
    expect(view.acceptSrText).toBe(acceptSrText);
    expect(view.throughText).toBe(throughText);
  });
});
