import Link from "next/link";
import { Badge, Card, buttonClass } from "@/components/ui";

/**
 * Home page. CLAUDE.md §14: carries over the wording of the live Offer Sheet landing page
 * (offersheet.vercel.app, as of 2026-09-29): what the app does, how it works and the platforms it
 * supports. Changes on purpose: the "Trade Score" became the three numbers of the planner's
 * Checkpoint 0 decision A (Helps you, Chance they accept, Overall); every feature and platform says
 * honestly whether it's available yet (a "Coming soon" badge on what later phases build); and Fantrax
 * (public leagues, a Phase 5 stretch goal) is listed like on the Connect page and in the footer.
 * Phase 4: trade ideas (the Trade Finder) and the Trade Analyzer are available, so "Get ranked trade
 * ideas" is badged available and the two features they deliver (the season played out with and without
 * each trade; the other manager's side) describe how Offer Sheet works today, without a badge.
 */

type Status = "now" | "soon" | "later";

const STATUS_BADGE = {
  now: { label: "Available now", tone: "brand" },
  soon: { label: "Coming soon", tone: "warn" },
  later: { label: "Later", tone: "muted" },
} as const;

const STEPS: { title: string; body: string; status: Status }[] = [
  {
    title: "Connect your league",
    body: "Pick your site and your league. Offer Sheet only reads your league. It never proposes trades, changes lineups or posts anything for you.",
    status: "now",
  },
  {
    title: "It learns your league",
    body: "Your exact scoring, lineup slots, rosters, schedule and playoff format, so every number fits the league you actually play in. You can check all of it in the Import Report.",
    status: "now",
  },
  {
    title: "Get ranked trade ideas",
    body: "Each idea comes with how much it helps you, an estimated chance the other manager accepts, an Overall score that combines the two, and a ready-to-send message. Or build your own trade and check it the same way.",
    status: "now",
  },
];

/** A card without a status describes how Offer Sheet works today; one that needs a later phase says so. */
const WHY: { title: string; body: string; status?: Status }[] = [
  {
    title: "Built on your season",
    body: "It plays out the rest of your season thousands of times, with and without each trade, to see how much the trade really moves your playoff and title odds.",
  },
  {
    title: "Offers people say yes to",
    body: "It looks at the deal from the other manager's side too: trade value, holes in their lineup, and how active a trader they are.",
  },
  { title: "Your league's rules", body: "PPR, TE premium, superflex and scoring bonuses are all counted the way your league counts them." },
  { title: "Free and private", body: "No ads and nothing sold. Your league logins are never stored on our servers." },
];

const PLATFORMS: { name: string; note: string; status: Status }[] = [
  { name: "ESPN", note: "Paste your league link. Private league? Ask your commissioner to make it viewable to the public, or connect with your ESPN cookies on a computer.", status: "now" },
  { name: "Sleeper", note: "Your username or a league ID.", status: "now" },
  { name: "Yahoo", note: "Waiting on Yahoo's approval.", status: "soon" },
  { name: "Fleaflicker", note: "League ID.", status: "later" },
  { name: "MyFantasyLeague", note: "League ID.", status: "later" },
  { name: "Fantrax", note: "Public leagues only.", status: "later" },
  { name: "Manual entry for other sites", note: "Pick your scoring and paste your rosters.", status: "later" },
];

export default function Home() {
  return (
    <div className="space-y-10 sm:space-y-14">
      <section className="relative overflow-hidden rounded-3xl bg-navy px-5 py-8 text-navy-contrast shadow-lg sm:px-10 sm:py-12">
        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 hidden w-1/3 bg-[repeating-linear-gradient(90deg,transparent_0,transparent_38px,rgba(255,255,255,0.06)_38px,rgba(255,255,255,0.06)_40px)] sm:block" />
        <p className="text-xs font-bold tracking-widest text-accent uppercase">Fantasy football trade finder · Free beta</p>
        <h1 className="mt-3 max-w-2xl text-3xl leading-tight font-black tracking-tight sm:text-5xl">
          Trades that help your team, and that your leaguemates will <em className="text-accent not-italic">actually accept</em>.
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-navy-contrast/85 sm:text-lg">
          Offer Sheet reads your fantasy football league, works out what your team needs, and ranks trade ideas by how much they raise your playoff and title odds and how
          likely the other manager is to say yes.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link href="/connect" className={buttonClass("primary")}>
            Connect your league
          </Link>
          <a href="#how" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/25 px-5 font-bold hover:bg-white/10">
            How it works
          </a>
        </div>
        <ul className="mt-5 flex flex-wrap gap-2" aria-label="The basics">
          {["Free", "No account needed", "Read-only", "No ads"].map((x) => (
            <li key={x}>
              <Badge tone="onNavy">{x}</Badge>
            </li>
          ))}
        </ul>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-navy-contrast/85">
          Available now: connect an ESPN or Sleeper league, check what Offer Sheet understood about it, see every team&apos;s playoff and title odds, needs, trade
          chips and rest-of-season projections on the League page, and get ranked trade ideas on the Trade Finder, or check your own in the Trade Analyzer.
        </p>
      </section>

      <section aria-labelledby="how-title" id="how" className="scroll-mt-6">
        <h2 id="how-title" className="text-2xl font-extrabold tracking-tight">
          How it works
        </h2>
        <ol className="mt-4 grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-4 rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand text-lg font-black text-brand-contrast">{i + 1}</span>
              <div className="min-w-0">
                <h3 className="font-extrabold tracking-tight">{s.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">{s.body}</p>
                <Badge tone={STATUS_BADGE[s.status].tone} className="mt-2">
                  {STATUS_BADGE[s.status].label}
                </Badge>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="example">
        <h2 id="example" className="text-2xl font-extrabold tracking-tight">
          What a suggestion looks like
        </h2>
        <Card className="mt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-bold tracking-wider text-muted uppercase">You give</p>
              <p className="mt-1 font-extrabold">Your WR3 + a bench RB</p>
            </div>
            <div>
              <p className="text-xs font-bold tracking-wider text-muted uppercase">You get</p>
              <p className="mt-1 font-extrabold">Their RB1, who fills your weakest starting spot</p>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
            {[
              { label: "Helps you", value: "72" },
              { label: "Chance they accept", value: "~45%", note: "Est." },
              { label: "Overall", value: "44" },
            ].map((n) => (
              <div key={n.label} className="flex flex-col-reverse rounded-xl bg-surface-muted px-2 py-3">
                <dt className="mt-0.5 text-xs font-semibold text-muted">
                  {n.label}
                  {n.note ? ` (${n.note})` : ""}
                </dt>
                <dd className="text-2xl font-black tracking-tight sm:text-3xl">{n.value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-muted">Illustration only. Real suggestions use your league&apos;s players and numbers.</p>
        </Card>
      </section>

      <section aria-labelledby="why">
        <h2 id="why" className="text-2xl font-extrabold tracking-tight">
          Why it&apos;s different
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {WHY.map((w) => (
            <Card key={w.title}>
              <h3 className="text-lg font-extrabold tracking-tight">{w.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{w.body}</p>
              {w.status ? (
                <Badge tone={STATUS_BADGE[w.status].tone} className="mt-2">
                  {STATUS_BADGE[w.status].label}
                </Badge>
              ) : null}
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="platforms">
        <h2 id="platforms" className="text-2xl font-extrabold tracking-tight">
          Works with
        </h2>
        <ul className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
          {PLATFORMS.map((p) => (
            <li key={p.name} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div>
                <p className="font-extrabold">{p.name}</p>
                <p className="text-sm text-muted">{p.note}</p>
              </div>
              <Badge tone={STATUS_BADGE[p.status].tone} className="self-start sm:self-center">
                {p.status === "now" ? "Available" : STATUS_BADGE[p.status].label}
              </Badge>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-muted">
          Read-only, always: Offer Sheet never proposes trades, changes lineups or posts anything for you. See the{" "}
          <Link href="/privacy" className="font-semibold underline underline-offset-2">
            privacy page
          </Link>{" "}
          for exactly what we keep.
        </p>
      </section>
    </div>
  );
}
