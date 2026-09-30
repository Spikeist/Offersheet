import { describe, expect, it } from "vitest";
import { revealResult, type RevealTarget } from "./reveal";

function fakeElement(log: string[], name: string): RevealTarget {
  return {
    scrollIntoView: (arg) => log.push(`${name}.scrollIntoView(${JSON.stringify(arg)})`),
    focus: (opts) => log.push(`${name}.focus(${JSON.stringify(opts)})`),
  };
}

describe("revealResult", () => {
  it("scrolls the result into view as little as possible, then focuses it without a second scroll", () => {
    const log: string[] = [];
    revealResult(fakeElement(log, "result"));
    expect(log).toEqual(['result.scrollIntoView({"block":"nearest"})', 'result.focus({"preventScroll":true})']);
  });

  it("can focus a heading or callout inside a bigger result", () => {
    const log: string[] = [];
    revealResult(fakeElement(log, "panel"), fakeElement(log, "alert"));
    expect(log).toEqual(['panel.scrollIntoView({"block":"nearest"})', 'alert.focus({"preventScroll":true})']);
  });

  it("does nothing when the result isn't there", () => {
    expect(() => revealResult(null)).not.toThrow();
    expect(() => revealResult(undefined, null)).not.toThrow();
    const log: string[] = [];
    revealResult(fakeElement(log, "panel"), null);
    expect(log).toEqual(['panel.scrollIntoView({"block":"nearest"})', 'panel.focus({"preventScroll":true})']);
  });
});
