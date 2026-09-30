/**
 * Small presentational building blocks (no state, usable from server and client components).
 * Colors come from the theme tokens in src/app/globals.css.
 */
import type { ReactNode, Ref } from "react";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * For an element that receives focus after an action (a result, a status line): focusable from
 * script only (tabIndex -1), with room above and below when scrolled into view. The focus ring
 * (keyboard users only) comes from globals.css.
 */
export const FOCUS_TARGET = { tabIndex: -1, className: "scroll-my-4" } as const;

/** A card. Colors come only from `tone` (extra classes must not set border or background colors). */
export function Card({ children, className, id, tone = "normal" }: { children: ReactNode; className?: string; id?: string; tone?: "normal" | "warn" }) {
  return (
    <section id={id} className={cx("rounded-2xl border bg-surface p-4 shadow-sm sm:p-5", tone === "warn" ? "border-warn-line" : "border-line", className)}>
      {children}
    </section>
  );
}

/** A card heading. With `headingRef`, the heading can take focus from script (to reveal a result). */
export function CardTitle({ children, eyebrow, action, headingRef }: { children: ReactNode; eyebrow?: string; action?: ReactNode; headingRef?: Ref<HTMLHeadingElement> }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        {eyebrow ? <p className="text-xs font-bold tracking-wider text-brand uppercase">{eyebrow}</p> : null}
        <h2 ref={headingRef} tabIndex={headingRef ? FOCUS_TARGET.tabIndex : undefined} className={cx("text-lg leading-tight font-extrabold tracking-tight sm:text-xl", FOCUS_TARGET.className)}>
          {children}
        </h2>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** "onNavy" is for badges on the navy header; "accent" for a gold highlight. */
type BadgeTone = "brand" | "muted" | "warn" | "danger" | "navy" | "onNavy" | "accent";

const BADGE: Record<BadgeTone, string> = {
  brand: "bg-brand-soft text-brand-strong dark:text-brand",
  muted: "bg-surface-muted text-muted",
  warn: "bg-warn-bg text-warn-fg",
  danger: "bg-danger-bg text-danger-fg",
  navy: "bg-navy text-navy-contrast",
  onNavy: "bg-white/10 text-navy-contrast",
  accent: "bg-accent text-navy",
};

/** A pill. Colors come only from `tone` (extra classes are for layout). */
export function Badge({ children, tone = "muted", className }: { children: ReactNode; tone?: BadgeTone; className?: string }) {
  return <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap", BADGE[tone], className)}>{children}</span>;
}

type CalloutTone = "info" | "warn" | "danger" | "ok";

const CALLOUT: Record<CalloutTone, string> = {
  info: "border-line bg-surface-muted text-foreground",
  warn: "border-warn-line bg-warn-bg text-warn-fg",
  danger: "border-danger-line bg-danger-bg text-danger-fg",
  ok: "border-transparent bg-ok-bg text-ok-fg",
};

export function Callout({ tone = "info", title, children, role, id }: { tone?: CalloutTone; title?: string; children?: ReactNode; role?: "alert" | "status"; id?: string }) {
  return (
    <div id={id} role={role} className={cx("rounded-xl border px-4 py-3 text-sm leading-relaxed", CALLOUT[tone])}>
      {title ? <p className="font-bold">{title}</p> : null}
      {children ? <div className={title ? "mt-1" : undefined}>{children}</div> : null}
    </div>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON: Record<ButtonVariant, string> = {
  primary: "bg-brand text-brand-contrast hover:bg-brand-strong shadow-sm",
  secondary: "border border-line bg-surface text-foreground hover:bg-surface-muted",
  ghost: "text-brand-strong hover:bg-brand-soft dark:text-brand",
  danger: "border border-danger-line bg-surface text-danger-fg hover:bg-danger-bg",
};

export function buttonClass(variant: ButtonVariant = "primary", size: "md" | "sm" = "md"): string {
  return cx(
    "inline-flex items-center justify-center gap-2 rounded-xl font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
    size === "md" ? "min-h-11 px-5 text-base" : "min-h-9 px-3 text-sm",
    BUTTON[variant],
  );
}

/** Text field look without a font size (add one: text-base keeps iOS from zooming in on focus). */
export const inputBase = "block w-full min-h-11 rounded-xl border border-line bg-surface px-3 py-2 text-foreground placeholder:text-muted/70 shadow-inner focus:border-brand disabled:opacity-60";
export const inputClass = `${inputBase} text-base`;

export function Spinner({ className }: { className?: string }) {
  return <span aria-hidden className={cx("inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent", className)} />;
}

/** A label/value list that stacks on phones. `tone: "warn"` marks a value to check (e.g. a setting the platform doesn't expose). */
export function Facts({ items }: { items: { label: string; value: ReactNode; tone?: "normal" | "warn" }[] }) {
  return (
    <dl className="divide-y divide-line">
      {items.map((it) => (
        <div key={it.label} className="grid gap-0.5 py-2.5 sm:grid-cols-[minmax(0,14rem)_1fr] sm:gap-4">
          <dt className="text-sm font-semibold text-muted">{it.label}</dt>
          <dd className={cx("text-sm break-words", it.tone === "warn" ? "font-bold text-warn-fg" : "font-medium")}>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
