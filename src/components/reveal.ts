/**
 * Brings a result the user just caused (an error, the private-league options, a list of leagues)
 * into view and moves keyboard focus to it (CLAUDE.md §14: mobile-first at 375 px). On a phone the
 * result lands below the fold, under the button, and otherwise nothing on screen changes but the
 * spinner stopping.
 *
 * "nearest" scrolls as little as possible: a short result ends at the bottom of the screen with the
 * form still above it; a tall one (the private-league options) starts at the top. Focus moves
 * without a second scroll, to `focusTarget` (a heading or callout inside the result) when given.
 */
export interface RevealTarget {
  scrollIntoView?: (arg?: ScrollIntoViewOptions) => void;
  focus?: (options?: FocusOptions) => void;
}

export function revealResult(scrollTarget: RevealTarget | null | undefined, focusTarget?: RevealTarget | null): void {
  if (!scrollTarget) return;
  scrollTarget.scrollIntoView?.({ block: "nearest" });
  (focusTarget ?? scrollTarget).focus?.({ preventScroll: true });
}
