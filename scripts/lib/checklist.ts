/**
 * Data Checklist results (CLAUDE.md §17 Phase 0 step 4): each check prints ✅ / ⚠️ / ❌ (➖ = not
 * applicable on this platform) with the JSON path and a sample value, and is saved (scrubbed) to
 * reports/probe-output/<platform>.json and .md for the data-access matrix.
 */
import path from "node:path";
import { writeFileAtomic } from "./cache";
import { ROOT } from "./env";
import { requestLog } from "./http";
import { scrubEverything } from "./redact";

export type Status = "ok" | "warn" | "fail" | "na";
export const ICON: Record<Status, string> = { ok: "✅", warn: "⚠️", fail: "❌", na: "➖" };

export const ITEMS = {
  A: "League basics",
  B: "Lineup",
  C: "Scoring",
  D: "Teams",
  E: "Rosters",
  F: "Schedule",
  G: "Transactions",
  H: "Free agents",
  I: "Draft picks",
  J: "Projections",
  K: "Completed weeks",
  L: "NFL schedule",
  M: "FantasyCalc match rate",
} as const;
export type ItemId = keyof typeof ITEMS;

export interface Evidence {
  /** URL with secrets/IDs removed (e.g. .../leagues/{leagueId}?view=mSettings). */
  url?: string;
  status?: number;
  /** JSON path, e.g. settings.scoringSettings.scoringItems[].points */
  path?: string;
  /** A sample value (sanitized). Long values are truncated when printed. */
  sample?: unknown;
  note?: string;
}

export interface Check {
  /** A–M for the Data Checklist; other ids (e.g. "FC", "IDMAP") for shared data sources. */
  item: string;
  /** Stable sub-check id, e.g. "A.tradeDeadline". */
  key: string;
  title: string;
  status: Status;
  summary: string;
  evidence: Evidence[];
}

export interface ProbeMeta {
  /** Placeholder-only description of the league(s) used, e.g. "Parker's league (private, cookies)". */
  leagues?: Array<{ label: string; access: string; source: string; notes?: string }>;
  [key: string]: unknown;
}

const STATUS_RANK: Record<Status, number> = { na: 0, ok: 1, warn: 2, fail: 3 };

/** Item-level status: the worst sub-check status; "na" only when every sub-check is n/a. */
export function rollup(statuses: Status[]): Status {
  if (!statuses.length) return "na";
  return statuses.reduce<Status>((worst, s) => (STATUS_RANK[s] > STATUS_RANK[worst] ? s : worst), "na");
}

export function formatSample(sample: unknown, max = 160): string {
  if (sample === undefined) return "";
  const s = typeof sample === "string" ? JSON.stringify(sample) : JSON.stringify(sample);
  if (s === undefined) return String(sample);
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export class Checklist {
  readonly checks: Check[] = [];
  readonly issues: string[] = [];
  readonly decisions: string[] = [];
  readonly questions: string[] = [];
  readonly meta: ProbeMeta = {};
  private readonly startedAt = Date.now();

  constructor(
    readonly platform: string,
    /** Extra text scrubber (e.g. the platform Redactor) applied on top of the .env.local scrubber. */
    private readonly scrub: (text: string) => string = (t) => t,
  ) {}

  add(item: string, key: string, title: string, status: Status, summary: string, ...evidence: Evidence[]): Check {
    const check: Check = { item, key, title, status, summary, evidence };
    this.checks.push(check);
    console.log(this.formatLine(check));
    return check;
  }
  ok(item: string, key: string, title: string, summary: string, ...evidence: Evidence[]) {
    return this.add(item, key, title, "ok", summary, ...evidence);
  }
  warn(item: string, key: string, title: string, summary: string, ...evidence: Evidence[]) {
    return this.add(item, key, title, "warn", summary, ...evidence);
  }
  fail(item: string, key: string, title: string, summary: string, ...evidence: Evidence[]) {
    return this.add(item, key, title, "fail", summary, ...evidence);
  }
  na(item: string, key: string, title: string, summary: string, ...evidence: Evidence[]) {
    return this.add(item, key, title, "na", summary, ...evidence);
  }
  issue(text: string) {
    this.issues.push(text);
  }
  decision(text: string) {
    this.decisions.push(text);
  }
  question(text: string) {
    this.questions.push(text);
  }

  private clean(text: string): string {
    return this.scrub(scrubEverything(text));
  }

  formatLine(c: Check): string {
    const ev = c.evidence
      .map((e) => {
        const parts: string[] = [];
        if (e.path) parts.push(`path=${e.path}`);
        if (e.sample !== undefined) parts.push(`sample=${formatSample(e.sample)}`);
        if (e.status !== undefined) parts.push(`HTTP ${e.status}`);
        if (e.url) parts.push(`url=${e.url}`);
        if (e.note) parts.push(e.note);
        return parts.join("  ");
      })
      .filter(Boolean);
    return this.clean(`${ICON[c.status]} ${c.key}  ${c.title}: ${c.summary}${ev.length ? "\n      " + ev.join("\n      ") : ""}`);
  }

  itemStatuses(): Record<string, Status> {
    const byItem = new Map<string, Status[]>();
    for (const c of this.checks) byItem.set(c.item, [...(byItem.get(c.item) ?? []), c.status]);
    return Object.fromEntries([...byItem].map(([k, v]) => [k, rollup(v)]));
  }

  counts(): Record<Status, number> {
    const out: Record<Status, number> = { ok: 0, warn: 0, fail: 0, na: 0 };
    for (const c of this.checks) out[c.status]++;
    return out;
  }

  printSummary(): void {
    const items = this.itemStatuses();
    const c = this.counts();
    console.log(`\n=== ${this.platform}: ${Object.entries(items).map(([k, s]) => `${k}${ICON[s]}`).join(" ")}`);
    console.log(`    checks: ✅ ${c.ok}  ⚠️ ${c.warn}  ❌ ${c.fail}  ➖ ${c.na}   requests: ${requestLog.length}   ${((Date.now() - this.startedAt) / 1000).toFixed(1)}s`);
    if (this.issues.length) console.log(this.clean(`    issues:\n${this.issues.map((i) => `      - ${i}`).join("\n")}`));
  }

  toJSON() {
    const deep = (v: unknown): unknown => {
      if (typeof v === "string") return this.clean(v);
      if (Array.isArray(v)) return v.map(deep);
      if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [this.clean(k), deep(x)]));
      return v;
    };
    return deep({
      platform: this.platform,
      generatedAt: new Date().toISOString(),
      runtimeSeconds: Math.round((Date.now() - this.startedAt) / 100) / 10,
      meta: this.meta,
      itemStatus: this.itemStatuses(),
      counts: this.counts(),
      checks: this.checks,
      issues: this.issues,
      decisions: this.decisions,
      questions: this.questions,
      requests: {
        total: requestLog.length,
        live: requestLog.filter((r) => !r.fromCache).length,
        fromCache: requestLog.filter((r) => r.fromCache).length,
        retried: requestLog.filter((r) => r.attempts > 1).length,
        slowestMs: requestLog.reduce((m, r) => Math.max(m, r.ms), 0),
      },
    });
  }

  toMarkdown(): string {
    const items = this.itemStatuses();
    const lines = [`# Probe output: ${this.platform}`, "", `Generated by \`npm run probe:${this.platform.split("/")[0]}\`. Placeholders only; no secrets.`, ""];
    if (this.meta.leagues?.length) {
      lines.push("## Leagues used", "");
      for (const l of this.meta.leagues) lines.push(`- ${l.label}: ${l.access}; source: ${l.source}${l.notes ? `; ${l.notes}` : ""}`);
      lines.push("");
    }
    lines.push("## Checks", "", "| | Key | Check | Result | Evidence |", "|---|---|---|---|---|");
    const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
    for (const c of this.checks) {
      const ev = c.evidence
        .map((e) => [e.path && `\`${e.path}\``, e.sample !== undefined && `= \`${formatSample(e.sample, 120)}\``, e.status !== undefined && `HTTP ${e.status}`, e.url && `\`${e.url}\``, e.note].filter(Boolean).join(" "))
        .join("<br>");
      lines.push(`| ${ICON[c.status]} | ${c.key} | ${cell(c.title)} | ${cell(c.summary)} | ${cell(ev)} |`);
    }
    lines.push("", "## Item status", "", Object.entries(items).map(([k, s]) => `${k} ${ICON[s]}`).join(" · "), "");
    for (const [title, list] of [
      ["Open issues", this.issues],
      ["Decisions", this.decisions],
      ["Questions", this.questions],
    ] as const) {
      if (!list.length) continue;
      lines.push(`## ${title}`, "", ...list.map((x) => `- ${x}`), "");
    }
    return this.clean(lines.join("\n"));
  }

  async save(): Promise<{ json: string; md: string }> {
    const dir = path.join(ROOT, "reports", "probe-output");
    const base = this.platform.replace(/[\\/]/g, "-");
    const json = path.join(dir, `${base}.json`);
    const md = path.join(dir, `${base}.md`);
    await writeFileAtomic(json, JSON.stringify(this.toJSON(), null, 2) + "\n");
    await writeFileAtomic(md, this.toMarkdown());
    return { json, md };
  }
}
