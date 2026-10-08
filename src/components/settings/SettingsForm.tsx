"use client";
/**
 * The Settings page's form for one league (CLAUDE.md §14 item 6, §12 "User settings", §7 "Streaming
 * positions"): lays out the view model (settingsView.ts), mobile-first (375 px): the league's card (saved or
 * defaults, Reset to defaults, and the Trade Finder's minimum chance when the saved one isn't the default), then your
 * lineup (streamed positions; the playoff weight, read-only since the planner's reply to Checkpoint 7a, §6.1), how trade
 * ideas are scored (Phase 4c: What does your league reward?, each option with its line of help; under "Several prizes" the
 * league's prizes in a group of their own, Checkpoint 7c; Win now ↔ Future in dynasty and keeper leagues,
 * followed by why there's no Protect my trade value there, or Protect my trade value in redraft ones, with a note while the
 * league's values are our own estimates), what a trade
 * idea can be (players per side, what else to include), players (untouchables, must-include) and positions (target,
 * avoid). Every word comes from the view model; each change is one SettingsEdit that the page saves at once
 * (there's no Save button), but for a prize's amount, saved when its field loses focus or on Enter (PrizesGroup).
 *
 * "Your league's prizes" (Checkpoint 7c; planner reply to Checkpoint 7b, §6; SettingsView.prizes): a fieldset of its own
 * after the goal's (a sibling, so the goal's group keeps exactly its three labeled choices: check:browser counts them), the
 * planner's helper line linked as its description, one labeled text field a prize (44 px, a decimal keyboard on phones), the
 * split line under them, or the warning while nothing adds up. A field keeps what's typed as a draft and saves it on blur or
 * Enter, read leniently (settingsView.ts parsePrizeText: "$2,000", "60%", blank for not paid), so typing "2000" saves once,
 * not four times (each saved change rebuilds the League model for the playoff weight); text it can't read isn't saved, and
 * the field says why (aria-invalid, the message linked by aria-describedby, in a polite live region that stays mounted, so
 * it's announced although the focus has left the field on blur) until it's fixed. A saved change shows the amount as saved;
 * a draft goes once it's saved, or when the saved amount changes under it (Reset to defaults).
 *
 * Accessibility: each group is a fieldset whose legend names it, with its help text linked by
 * aria-describedby; checkboxes and radios are native (the radios of a segmented control are visually hidden,
 * so their label shows the keyboard focus ring and the chosen one is marked by a ring, not color alone); every
 * target is at least 44 px tall. What a change did is announced by one status line that stays mounted
 * (SaveStatus), and a failed save is an alert. A button that goes away once its change is saved would drop
 * keyboard focus to the page, so focus moves to what took its place: after "Reset to defaults", to the line
 * saying the league uses the defaults; after a list's Remove, to the Remove button now in that row's place
 * (the next row's, else the new last row's), or to the group's legend once the list is empty
 * (focusAfterRemoval). When a save fails nothing moves: the button is still there, under the alert.
 */
import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from "react";
import type { Pos } from "@/engine/model";
import { revealResult } from "../reveal";
import { Badge, Callout, Card, CardTitle, FOCUS_TARGET, buttonClass, cx, inputClass } from "../ui";
import { prizeCommit, type Choice, type PlayersView, type PrizeFieldView, type SettingsEdit, type SettingsView } from "./settingsView";

export interface SettingsStatus {
  tone: "ok" | "error";
  text: string;
}

/** `onEdit` saves one change and says whether it was saved (false: the browser refused; the page shows why). */
type EditProps = { view: SettingsView; onEdit: (edit: SettingsEdit) => boolean };

/** `onReset` goes back to the defaults and says whether that was saved. */
export function SettingsForm({ view, onEdit, onReset, status }: EditProps & { onReset: () => boolean; status: SettingsStatus | null }) {
  return (
    <div className="space-y-6">
      <LeagueCard view={view} onReset={onReset} status={status} />
      <LineupCard view={view} onEdit={onEdit} />
      <ScoringCard view={view} onEdit={onEdit} />
      <TradeIdeasCard view={view} onEdit={onEdit} />
      <PlayersCard view={view} onEdit={onEdit} />
      <PositionsCard view={view} onEdit={onEdit} />
      <SaveStatus status={status} />
    </div>
  );
}

function LeagueCard({ view, onReset, status }: { view: SettingsView; onReset: () => boolean; status: SettingsStatus | null }) {
  const l = view.league;
  // "Reset to defaults" goes away with the saved settings: focus moves to the line that now says the league
  // uses the defaults (it's always there, so it's in place whichever render brings the reset).
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const [resets, setResets] = useState(0);
  useEffect(() => {
    if (resets) revealResult(summaryRef.current);
  }, [resets]);
  return (
    <Card>
      <CardTitle eyebrow="League">{l.name}</CardTitle>
      <div className="flex flex-wrap gap-2">
        <Badge tone="brand">{l.platformLabel}</Badge>
        <Badge>{l.season} season</Badge>
        <Badge>{l.typeLabel}</Badge>
      </div>
      <p ref={summaryRef} tabIndex={FOCUS_TARGET.tabIndex} className={cx("mt-3 text-sm text-muted", FOCUS_TARGET.className)}>
        {view.stored
          ? "These are your settings for this league, saved in this browser. The League page and trade ideas use them."
          : "This league uses the defaults. Change anything below and it's saved in this browser for this league."}
      </p>
      {view.finderMinimum ? <p className="mt-2 text-sm text-muted">{view.finderMinimum}</p> : null}
      {status?.tone === "error" ? (
        <div className="mt-3">
          <Callout tone="danger" role="alert" title="That change wasn't saved">
            {status.text}
          </Callout>
        </div>
      ) : null}
      {view.stored ? (
        <button
          type="button"
          onClick={() => {
            if (onReset()) setResets((n) => n + 1);
          }}
          className={cx(buttonClass("secondary", "sm"), "mt-3 min-h-11")}
        >
          Reset to defaults
        </button>
      ) : null}
    </Card>
  );
}

/**
 * The status line for every change ("Saved."), at the bottom of the screen where it's seen wherever the
 * change was made. It stays mounted (role="status"), so each new text is announced; it never takes taps.
 */
export function SaveStatus({ status }: { status: SettingsStatus | null }) {
  const text = status?.tone === "ok" ? status.text : "";
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <p role="status" className={cx("max-w-md rounded-full bg-navy px-4 py-2 text-sm font-bold text-navy-contrast shadow-lg transition-opacity", text ? "opacity-100" : "opacity-0")}>
        {text}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Building blocks

/** A fieldset with its legend and help. With `legendRef`, the legend can take focus from script (a list in it emptied). */
function Group({
  legend,
  help,
  children,
  className,
  legendRef,
}: {
  legend: string;
  help?: string | null | undefined;
  children: ReactNode;
  className?: string;
  legendRef?: Ref<HTMLLegendElement> | undefined;
}) {
  const helpId = useId();
  return (
    <fieldset className={className} aria-describedby={help ? helpId : undefined}>
      <legend ref={legendRef} tabIndex={legendRef ? FOCUS_TARGET.tabIndex : undefined} className={cx("text-base font-extrabold tracking-tight", FOCUS_TARGET.className)}>
        {legend}
      </legend>
      {help ? (
        <p id={helpId} className="mt-1 text-sm leading-relaxed text-muted">
          {help}
        </p>
      ) : null}
      <div className="mt-2">{children}</div>
    </fieldset>
  );
}

/**
 * A checkbox and its label (a 44 px row). `detail` is short and part of its name ("QB · BUF"); `description` is
 * longer help under it, linked by aria-describedby rather than read as part of the name.
 */
function CheckRow({
  label,
  detail,
  description,
  checked,
  onChange,
}: {
  label: string;
  detail?: string | undefined;
  description?: string | undefined;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  const descriptionId = useId();
  const row = (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 py-1 hover:bg-surface-muted">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={description ? descriptionId : undefined}
        className="size-5 shrink-0 accent-brand"
      />
      <span className="min-w-0">
        <span className="font-semibold break-words">{label}</span>
        {detail ? <span className="block text-xs text-muted">{detail}</span> : null}
      </span>
    </label>
  );
  if (!description) return row;
  return (
    <div>
      {row}
      <p id={descriptionId} className="pl-10 text-sm text-muted">
        {description}
      </p>
    </div>
  );
}

/**
 * A radio and its label (a 44 px row) for a choice that needs a line of help (What does your league reward?): `detail` is short and part
 * of its name ("default"); `description` is the line under it, linked by aria-describedby. The native radio shows which one
 * is chosen (its dot), so it never rests on color.
 */
function RadioRow<T extends string>({
  name,
  value,
  label,
  detail,
  description,
  checked,
  onChange,
}: {
  name: string;
  value: T;
  label: string;
  detail?: string | undefined;
  description: string;
  checked: boolean;
  onChange: (value: T) => void;
}) {
  const descriptionId = useId();
  return (
    <div>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 py-1 hover:bg-surface-muted">
        <input type="radio" name={name} value={value} checked={checked} onChange={() => onChange(value)} aria-describedby={descriptionId} className="size-5 shrink-0 accent-brand" />
        <span className="min-w-0">
          <span className="font-semibold break-words">{label}</span>
          {/* A real space before the detail, so its accessible name reads "Only the champion default" (final review of Phase 4c, finding PAGES-4). */}
          {detail ? (
            <>
              {" "}
              <span className="ml-1 text-xs text-muted">{detail}</span>
            </>
          ) : null}
        </span>
      </label>
      <p id={descriptionId} className="pl-10 text-sm text-muted">
        {description}
      </p>
    </div>
  );
}

/** Same look as the Connect page's platform picker: the radio is visually hidden, its label shows focus. */
const OPTION =
  "relative flex min-h-11 min-w-11 cursor-pointer flex-col items-center justify-center rounded-lg px-3 text-center transition-[color,background-color] has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus";
/** Chosen: tinted, with a ring (a shape, not only a color change). */
const SELECTED = "bg-brand-soft ring-2 ring-brand";
const UNSELECTED = "text-muted hover:text-foreground";

function Segmented<T extends string | number>({ name, choices, onChange }: { name: string; choices: Choice<T>[]; onChange: (value: T) => void }) {
  return (
    <div className="inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-line bg-surface-muted p-1">
      {choices.map((c) => (
        <label key={String(c.value)} className={cx(OPTION, c.checked ? SELECTED : UNSELECTED)}>
          <input type="radio" name={name} value={String(c.value)} checked={c.checked} onChange={() => onChange(c.value)} className="sr-only" />
          <span className="leading-tight font-extrabold tabular-nums">{c.label}</span>
          {c.detail ? <span className="text-xs leading-tight text-muted">{c.detail}</span> : null}
        </label>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Cards

function LineupCard({ view, onEdit }: EditProps) {
  return (
    <Card>
      <CardTitle eyebrow="Your lineup">How your lineup is valued</CardTitle>
      <div className="space-y-6">
        {view.stream ? (
          <Group legend="Positions I stream weekly" help={view.stream.help}>
            <div className="grid gap-1 sm:grid-cols-2">
              {view.stream.choices.map((c) => (
                <CheckRow key={c.value} label={c.label} checked={c.checked} onChange={(on) => onEdit({ kind: "stream", pos: c.value, on })} />
              ))}
            </div>
          </Group>
        ) : null}
        {/* Read-only (planner reply to Checkpoint 7a, §6.1): the League model sets it from your odds. */}
        <p className="text-sm leading-relaxed">
          <span className="text-base font-extrabold tracking-tight">{view.playoffWeight.label}:</span> <span className="font-semibold">{view.playoffWeight.value}</span>{" "}
          <span className="text-muted">{view.playoffWeight.help}</span>
        </p>
      </div>
    </Card>
  );
}

/**
 * How trade ideas are scored for me (Phase 4c): What does your league reward? (planner reply to Checkpoint 4b, change 8; 7a, 5.2), then
 * under "Several prizes" the league's prizes (Checkpoint 7c: PrizesGroup), then Win now
 * ↔ Future (dynasty and keeper leagues) or Protect my trade value (redraft), each with its note while the league's values
 * are our own estimates. In dynasty and keeper leagues a line after Win now ↔ Future says why Protect my trade value isn't
 * there (planner reply to Checkpoint 7b, Q3: SettingsView.tradeValueNote).
 */
function ScoringCard({ view, onEdit }: EditProps) {
  return (
    <Card>
      <CardTitle eyebrow="Scoring">How trade ideas are scored</CardTitle>
      <div className="space-y-6">
        <Group legend={view.goal.legend} help={view.goal.help}>
          <div className="space-y-1">
            {view.goal.choices.map((c) => (
              <RadioRow key={c.value} name="goal" value={c.value} label={c.label} detail={c.detail} description={c.help} checked={c.checked} onChange={(value) => onEdit({ kind: "goal", value })} />
            ))}
          </div>
        </Group>
        {view.prizes ? <PrizesGroup prizes={view.prizes} onEdit={onEdit} /> : null}
        {view.lambda ? <LambdaGroup lambda={view.lambda} onEdit={onEdit} /> : null}
        {view.tradeValueNote ? <p className="text-sm leading-relaxed text-muted">{view.tradeValueNote}</p> : null}
        {view.protectValue ? (
          <Group legend="Protect my trade value" help={view.protectValue.help}>
            <Segmented name="protect-value" choices={view.protectValue.choices} onChange={(value) => onEdit({ kind: "protectValue", value })} />
            {view.protectValue.note ? (
              <div className="mt-3">
                <Callout tone="warn">{view.protectValue.note}</Callout>
              </div>
            ) : null}
          </Group>
        ) : null}
      </div>
    </Card>
  );
}

/**
 * "Your league's prizes" (the file header; SettingsView.prizes): the planner's helper line, a field a prize, then the split
 * line, or the warning while the amounts add up to nothing.
 */
function PrizesGroup({ prizes, onEdit }: { prizes: NonNullable<SettingsView["prizes"]>; onEdit: (edit: SettingsEdit) => boolean }) {
  return (
    <Group legend={prizes.legend} help={prizes.help}>
      <div className="space-y-1">
        {prizes.fields.map((f) => (
          <PrizeField key={f.key} field={f} onEdit={onEdit} />
        ))}
      </div>
      {prizes.split ? <p className="mt-3 text-sm font-semibold">{prizes.split}</p> : null}
      {prizes.warning ? (
        <div className="mt-3">
          <Callout tone="warn">{prizes.warning}</Callout>
        </div>
      ) : null}
    </Group>
  );
}

/**
 * One prize's field (the file header): what's typed stays a draft until blur or Enter (Escape drops it), read by
 * parsePrizeText. Text it can read and that differs from the saved amount is saved (the draft goes once the save shows);
 * text it can't stays, with why, until it's typed again. A draft belongs to the saved amount it was typed over (`over`), so
 * when that amount changes under it (Reset to defaults) the field shows the new one: no effect needed to drop it.
 */
function PrizeField({ field, onEdit }: { field: PrizeFieldView; onEdit: (edit: SettingsEdit) => boolean }) {
  const id = useId();
  const errorId = useId();
  const [draft, setDraft] = useState<{ text: string; over: string; error: string | null } | null>(null);
  const live = draft && draft.over === field.value ? draft : null;
  function commit() {
    if (!live) return;
    const c = prizeCommit(live.text, field.value);
    if (c.kind === "error") {
      setDraft({ ...live, error: c.message });
      return;
    }
    // Unchanged ("60%" over 60): nothing to save. A refused save keeps the draft (the page's alert says why).
    if (c.kind === "same" || onEdit({ kind: "prize", key: field.key, value: c.value })) setDraft(null);
  }
  return (
    <div>
      <div className="flex min-h-11 items-center justify-between gap-3 px-2">
        <label htmlFor={id} className="min-w-0 font-semibold break-words">
          {field.label}
        </label>
        <div className="w-28 shrink-0">
          <input
            id={id}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={live ? live.text : field.value}
            aria-invalid={live?.error ? true : undefined}
            aria-describedby={live?.error ? errorId : undefined}
            onChange={(e) => setDraft({ text: e.target.value, over: field.value, error: null })}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape" && live) {
                setDraft(null);
              }
            }}
            className={cx(inputClass, "text-right tabular-nums")}
          />
        </div>
      </div>
      {/* Always mounted, so why the field can't read what's typed is announced as it shows: on blur that's after focus
          has moved on, where aria-describedby alone says nothing (review of the prizes UI, prizes-ui-3). */}
      <div aria-live="polite">
        {live?.error ? (
          <p id={errorId} className="px-2 text-sm font-semibold text-danger-fg">
            {live.error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function TradeIdeasCard({ view, onEdit }: EditProps) {
  return (
    <Card>
      <CardTitle eyebrow="Trade ideas">What a trade idea can be</CardTitle>
      <div className="space-y-6">
        <Group legend="Most players per side" help={view.maxPerSide.help}>
          <Segmented name="max-per-side" choices={view.maxPerSide.choices} onChange={(value) => onEdit({ kind: "maxPerSide", value })} />
        </Group>
        {view.kDefIdp || view.picks ? (
          <Group legend="Also include">
            <div className="space-y-3">
              {view.kDefIdp ? (
                <CheckRow label={view.kDefIdp.label} description={view.kDefIdp.help} checked={view.kDefIdp.checked} onChange={(on) => onEdit({ kind: "includeKDefIdp", on })} />
              ) : null}
              {view.picks ? (
                <CheckRow label="Include draft picks" description={view.picks.help} checked={view.picks.checked} onChange={(on) => onEdit({ kind: "includePicks", on })} />
              ) : null}
            </div>
          </Group>
        ) : null}
      </div>
    </Card>
  );
}

/** Win now ↔ Future: "Automatic", or a slider whose value is read out in words (aria-valuetext) and shown under it. */
function LambdaGroup({ lambda, onEdit }: { lambda: NonNullable<SettingsView["lambda"]>; onEdit: (edit: SettingsEdit) => void }) {
  const sliderId = useId();
  return (
    <Group legend="Win now or build for the future" help={lambda.help}>
      <CheckRow label="Automatic" description={lambda.automaticText} checked={lambda.automatic} onChange={(on) => onEdit({ kind: "lambda", value: on ? null : lambda.value })} />
      {lambda.automatic ? null : (
        <div className="mt-3 px-2">
          <label htmlFor={sliderId} className="sr-only">
            How much later seasons count
          </label>
          <input
            id={sliderId}
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={lambda.value}
            aria-valuetext={lambda.valueText}
            onChange={(e) => onEdit({ kind: "lambda", value: Number(e.target.value) })}
            className="h-11 w-full accent-brand"
          />
          <div className="flex justify-between text-xs font-bold text-muted" aria-hidden>
            <span>Win now</span>
            <span>Future</span>
          </div>
          {/* The same words the slider reads out, for sighted users: hidden from screen readers so they aren't read twice. */}
          <p className="mt-1 text-sm font-semibold" aria-hidden>
            {lambda.valueText}
          </p>
        </div>
      )}
      {lambda.keeperNote ? <p className="mt-2 text-sm text-muted">{lambda.keeperNote}</p> : null}
      {lambda.estimatedNote ? (
        <div className="mt-3">
          <Callout tone="warn">{lambda.estimatedNote}</Callout>
        </div>
      ) : null}
    </Group>
  );
}

function PlayersCard({ view, onEdit }: EditProps) {
  const p = view.players;
  return (
    <Card>
      <CardTitle eyebrow="Players">Untouchables and must-include players</CardTitle>
      {p.kind === "noTeam" ? (
        <Callout tone="warn" title="Which team is yours?">
          <p>{p.text}</p>
          <Link href="/import#your-team" className="mt-1 inline-flex min-h-11 items-center font-bold underline underline-offset-2">
            Pick your team
          </Link>
        </Callout>
      ) : (
        <div className="space-y-6">
          <Untouchables players={p} onEdit={onEdit} />
          <MustInclude players={p} onEdit={onEdit} />
        </div>
      )}
    </Card>
  );
}

type PlayersOk = Extract<PlayersView, { kind: "ok" }>;

function RemoveButton({ name, onClick, ref }: { name: string; onClick: () => void; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button ref={ref} type="button" onClick={onClick} className={cx(buttonClass("ghost", "sm"), "min-h-11")}>
      Remove<span className="sr-only"> {name}</span>
    </button>
  );
}

/**
 * Where focus goes once a list row whose Remove button was pressed (`removed`: its id, and its index then) is
 * gone from `ids` (the list now): the row now at its index (the next one), else the new last row, else null
 * (the list is empty: the group's legend). undefined while the row is still there (not saved yet).
 */
export function focusAfterRemoval(ids: readonly string[], removed: { id: string; index: number }): string | null | undefined {
  if (ids.includes(removed.id)) return undefined;
  if (!ids.length) return null;
  return ids[Math.min(Math.max(0, removed.index), ids.length - 1)] ?? null;
}

const ID_SEPARATOR = "\u0000";

/**
 * Keeps keyboard focus in a list of rows with Remove buttons (focusAfterRemoval): `remove` saves through
 * `save` and, when that worked, focus moves once the row is gone. Put `buttonRef(id)` on each row's Remove
 * button and `legend` on the group's legend.
 */
function useRemoveFocus(ids: readonly string[]) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const legend = useRef<HTMLLegendElement>(null);
  const pending = useRef<{ id: string; index: number } | null>(null);
  const key = ids.join(ID_SEPARATOR);
  useEffect(() => {
    const removed = pending.current;
    if (!removed) return;
    const next = focusAfterRemoval(key ? key.split(ID_SEPARATOR) : [], removed);
    if (next === undefined) return;
    pending.current = null;
    revealResult(next === null ? legend.current : buttons.current.get(next));
  }, [key]);
  return {
    legend,
    buttonRef: (id: string) => (el: HTMLButtonElement | null) => {
      if (el) buttons.current.set(id, el);
      else buttons.current.delete(id);
    },
    remove: (id: string, index: number, save: () => boolean) => {
      // Marked before saving (the list may render again before `save` returns), unmarked if it failed.
      pending.current = { id, index };
      if (!save()) pending.current = null;
    },
  };
}

function Untouchables({ players, onEdit }: { players: PlayersOk; onEdit: (edit: SettingsEdit) => boolean }) {
  const u = players.untouchables;
  const removal = useRemoveFocus(u.stale.map((s) => s.id));
  return (
    <Group legend="Untouchables" help="Trade ideas never offer these players of yours." legendRef={removal.legend}>
      <div className="grid gap-1 sm:grid-cols-2">
        {u.choices.map((c) => (
          <CheckRow key={c.value} label={c.label} detail={c.detail} checked={c.checked} onChange={(on) => onEdit({ kind: "untouchable", id: c.value, on })} />
        ))}
      </div>
      {u.stale.length ? (
        <div className="mt-3">
          <p className="text-sm font-bold">Saved, but no longer on your team</p>
          <ul className="mt-1 divide-y divide-line">
            {u.stale.map((s, i) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-1">
                <span className="min-w-0 text-sm">
                  <span className="font-semibold">{s.name}</span>
                  {s.detail ? <span className="text-muted"> · {s.detail}</span> : null}
                </span>
                <RemoveButton ref={removal.buttonRef(s.id)} name={s.name} onClick={() => removal.remove(s.id, i, () => onEdit({ kind: "untouchable", id: s.id, on: false }))} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Group>
  );
}

function MustInclude({ players, onEdit }: { players: PlayersOk; onEdit: (edit: SettingsEdit) => boolean }) {
  const m = players.mustInclude;
  const selectId = useId();
  const [picked, setPicked] = useState("");
  const removal = useRemoveFocus(m.chosen.map((c) => c.id));
  const available = m.groups.some((g) => g.options.length > 0);
  const add = () => {
    if (!picked) return;
    onEdit({ kind: "mustInclude", id: picked, on: true });
    setPicked("");
  };
  return (
    <Group legend="Must include" help="Every trade idea includes these players: yours to move, or one other team's to get." legendRef={removal.legend}>
      {m.chosen.length ? (
        <ul className="mb-3 divide-y divide-line rounded-xl border border-line px-3" aria-label="Must-include players">
          {m.chosen.map((c, i) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-1">
              <span className="min-w-0 text-sm">
                <span className="font-semibold">{c.name}</span>
                {c.detail ? <span className="text-muted"> · {c.detail}</span> : null}
                <span className="block text-xs text-muted">{c.team}</span>
              </span>
              <RemoveButton ref={removal.buttonRef(c.id)} name={c.name} onClick={() => removal.remove(c.id, i, () => onEdit({ kind: "mustInclude", id: c.id, on: false }))} />
            </li>
          ))}
        </ul>
      ) : null}
      {available ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor={selectId} className="sr-only">
            Player to include
          </label>
          <select id={selectId} value={picked} onChange={(e) => setPicked(e.target.value)} className={cx(inputClass, "sm:max-w-md")}>
            <option value="">Choose a player…</option>
            {m.groups.map((g) =>
              g.options.length ? (
                <optgroup key={g.teamId} label={g.label}>
                  {g.options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              ) : null,
            )}
          </select>
          <button type="button" onClick={add} aria-disabled={!picked} className={cx(buttonClass("secondary"), !picked && "opacity-60")}>
            Add
          </button>
        </div>
      ) : null}
      {m.warnings.length ? (
        <div className="mt-3">
          <Callout tone="warn" title="These can't all work">
            <ul className="list-disc space-y-0.5 pl-5">
              {m.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </Callout>
        </div>
      ) : null}
    </Group>
  );
}

function PositionsCard({ view, onEdit }: EditProps) {
  const p = view.positions;
  if (!p.target.length) return null;
  const row = (choices: Choice<Pos>[], kind: "target" | "avoid") => (
    <div className="flex flex-wrap gap-x-2">
      {choices.map((c) => (
        <CheckRow key={c.value} label={c.label} checked={c.checked} onChange={(on) => onEdit({ kind, pos: c.value, on })} />
      ))}
    </div>
  );
  return (
    <Card>
      <CardTitle eyebrow="Positions">Positions you get</CardTitle>
      <div className="space-y-6">
        <Group legend="Only get these positions" help="Trade ideas bring you players at these positions only. Leave them all unchecked for any position.">
          {row(p.target, "target")}
        </Group>
        <Group legend="Never get these positions" help="Trade ideas never bring you players at these positions.">
          {row(p.avoid, "avoid")}
        </Group>
        {p.note ? <Callout tone="warn">{p.note}</Callout> : null}
      </div>
    </Card>
  );
}
