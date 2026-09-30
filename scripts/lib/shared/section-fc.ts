/**
 * FC — FantasyCalc market values (CLAUDE.md §2.9, §9). Eleven formats, each fetched at most once
 * per day (24 h cache + cross-process lock in lib/fantasycalc.ts): the redraft baseline, one
 * parameter varied at a time, and the two dynasty baselines. Plus GET /players, and the API docs and
 * terms, read from the site's JS bundle (they are client-rendered) and quoted verbatim.
 */
import { TTL } from "../cache";
import type { Evidence } from "../checklist";
import { fantasyCalcUrl, getFantasyCalc, type FcEntry, type FcFormat } from "../fantasycalc";
import { getJson, type HttpResult } from "../http";
import type { ProbeContext } from "../probe";
import { addTeamCodes, errMsg, ev, freshness, note, saveFixture, saveRawSafe, type FcPlayerRecord, type FcResult, type SharedState } from "./context";
import { belowFloor, compareFormats, compareNameSets, countsByPosition, fieldPresence, idCoverage, isPickId, pickKeyForms, pickRows, redraftGap, topEntry, valueRelations } from "./fc";
import { documentedEndpoints, findLiteral, mainScriptSrc, routeChunk, stringLiterals, textBetween } from "./fc-docs";
import { fetchFantasyCalcSite, FANTASYCALC_SITE } from "./fetch";
import { fixtureLabels } from "./labels";
import { countBy, pct, sortCounts } from "./util";

const BASE: FcFormat = { isDynasty: false, numQbs: 1, numTeams: 12, ppr: 1 };
const DYNASTY: FcFormat = { isDynasty: true, numQbs: 1, numTeams: 12, ppr: 1 };

/**
 * The daily format budget: 11 formats, each fetched at most once per day. numTeams=16 was dropped:
 * it returns the 12-team values (see the decision below), so fetching it re-fetched the 12-team format.
 */
export const FC_FORMATS: Array<{ name: string; format: FcFormat }> = [
  { name: "redraft", format: BASE },
  { name: "redraft-2qb", format: { ...BASE, numQbs: 2 } },
  { name: "redraft-10team", format: { ...BASE, numTeams: 10 } },
  { name: "redraft-14team", format: { ...BASE, numTeams: 14 } },
  { name: "redraft-8team", format: { ...BASE, numTeams: 8 } },
  { name: "redraft-ppr0", format: { ...BASE, ppr: 0 } },
  { name: "redraft-ppr0.5", format: { ...BASE, ppr: 0.5 } },
  { name: "redraft-te+", format: { ...BASE, extra: { tep: "te+" } } },
  { name: "redraft-te++", format: { ...BASE, extra: { tep: "te++" } } },
  { name: "dynasty", format: DYNASTY },
  { name: "dynasty-2qb", format: { ...DYNASTY, numQbs: 2 } },
];

export const FC_PLAYERS_URL = "https://api.fantasycalc.com/players";
export const fcQuery = (f: FcFormat) => fantasyCalcUrl(f).split("?")[1] ?? "";

/** Trimmed copy for committed fixtures: top entries, plus every pick and (optionally) every TE. */
function trimFc(data: FcEntry[], top: number, keepTe: boolean): FcEntry[] {
  return data.filter((e, i) => i < top || e.player.position === "PICK" || (keepTe && e.player.position === "TE"));
}

// ---------------------------------------------------------------- docs and terms

interface DocQuote {
  doc: "terms" | "api-docs";
  label: string;
  phrase: string;
  quote: string | null;
  url?: string;
}

const TERMS_PHRASES: Array<[string, string]> = [
  ["effective date", "Effective Date:"],
  ["a. non-commercial", "Non-commercial Use:"],
  ["b. permissible use", "material substitute"],
  ["c. attribution", "Attribution:"],
  ["d. website reference", "Website Reference:"],
  ["e. caching", "Caching of API Calls:"],
  ["f. endpoints", "may be called programmatically"],
];
const DOCS_PHRASES: Array<[string, string]> = [
  ["documented endpoints only", "Only the endpoints documented on this page"],
  ["other endpoints", "may result in permanent IP bans"],
  ["public launch (1)", "publicly facing website or application"],
  ["public launch (2)", "before launch so we can review"],
  ["attribution", "prominent, visible attribution"],
  ["/values/current refresh", "refreshed at most once per hour"],
  ["/players refresh", "refreshed at most once per day"],
];

interface FcDocs {
  quotes: DocQuote[];
  endpoints: string[];
  params: string | null;
  fetched: string;
  errors: string[];
  res: HttpResult[];
}

async function readFcDocs(p: ProbeContext): Promise<FcDocs> {
  const out: FcDocs = { quotes: [], endpoints: [], params: null, fetched: "", errors: [], res: [] };
  const get = async (pathName: string, immutable: boolean): Promise<HttpResult | null> => {
    try {
      const r = await p.timed("fantasycalc-docs", () => fetchFantasyCalcSite(pathName, immutable));
      out.res.push(r);
      if (r.status !== 200) {
        out.errors.push(`${pathName}: HTTP ${r.status}`);
        return null;
      }
      return r;
    } catch (err) {
      out.errors.push(`${pathName}: ${errMsg(err)}`);
      return null;
    }
  };
  const page = await get("terms-of-usage", false);
  const main = page ? mainScriptSrc(page.text) : null;
  if (page && !main) out.errors.push("terms-of-usage: no main-*.js script tag");
  const mainJs = main ? await get(main, true) : null;
  out.fetched = freshness(page ?? undefined, "1-day");
  const chunks: Array<["terms" | "api-docs", string, Array<[string, string]>]> = [
    ["terms", "terms-of-usage", TERMS_PHRASES],
    ["api-docs", "api-docs", DOCS_PHRASES],
  ];
  for (const [doc, route, phrases] of chunks) {
    const chunk = mainJs ? routeChunk(mainJs.text, route) : null;
    if (mainJs && !chunk) out.errors.push(`${main}: no route chunk for /${route}`);
    const js = chunk ? await get(chunk, true) : null;
    const literals = js ? stringLiterals(js.text) : [];
    for (const [label, phrase] of phrases) out.quotes.push({ doc, label, phrase, quote: js ? findLiteral(literals, phrase) : null, url: chunk ? `${FANTASYCALC_SITE}/${chunk}` : undefined });
    if (doc === "api-docs" && js) {
      out.endpoints = documentedEndpoints(literals);
      out.params = textBetween(literals, "Query parameters", "Example request");
    }
  }
  return out;
}

// ---------------------------------------------------------------- section

export async function runFantasyCalc(p: ProbeContext, state: SharedState): Promise<void> {
  const { cl } = p;

  // ---- fetch the formats (sequential; the HTTP client also serializes per host)
  for (const { name, format } of FC_FORMATS) {
    const r: FcResult = { name, format, data: null };
    try {
      const { data, res } = await p.timed("fantasycalc", () => getFantasyCalc(format));
      r.data = data;
      r.res = res;
      await saveRawSafe(p, `fantasycalc:values:${fcQuery(format)}`, data, res);
      const tep = Boolean(format.extra?.tep);
      await saveFixture(p, fixtureLabels.fcValues(fcQuery(format)), trimFc(data, 50, tep || name === "redraft"), res);
    } catch (err) {
      r.error = errMsg(err);
    }
    state.fc.push(r);
  }
  const get = (name: string) => state.fc.find((r) => r.name === name);
  const ok = state.fc.filter((r) => r.data);
  const fmtEvidence = state.fc.map((r) =>
    r.data ? ev(p, r.res, "[]", { entries: r.data.length, top: `${r.data[0]?.player.name}: ${r.data[0]?.value}` }, freshness(r.res, "24 h")) : note(undefined, undefined, `${r.name}: ${r.error}`, fantasyCalcUrl(r.format)),
  );
  (ok.length === FC_FORMATS.length ? cl.ok : ok.length ? cl.warn : cl.fail).call(cl, "FC", "FC.formats", "Formats fetched", `${ok.length}/${FC_FORMATS.length} formats returned JSON (each format at most once per day: 24 h cache)`, ...fmtEvidence);

  const redraft = get("redraft")?.data;
  const dynasty = get("dynasty")?.data;
  if (!redraft || !dynasty) {
    cl.fail("FC", "FC.baseline", "Baseline formats", "redraft or dynasty baseline missing; later FC checks skipped");
    return;
  }
  const redraftRes = get("redraft")?.res;
  const dynastyRes = get("dynasty")?.res;
  const redraftFormats = state.fc.filter((r) => !r.format.isDynasty && r.data);

  // ---- fields
  const fp = fieldPresence([...redraft, ...dynasty]);
  const missing = [...fp.player, ...fp.entry].filter((f) => f.present < f.total);
  const fieldSample = Object.fromEntries([...fp.player, ...fp.entry].map((f) => [f.field, f.nonNull === f.total ? "all" : `${f.nonNull}/${f.total} non-null`]));
  (missing.length ? cl.warn : cl.ok).call(
    cl,
    "FC",
    "FC.fields",
    "Fields present",
    missing.length ? `missing on some entries: ${missing.map((f) => `${f.field} (${f.present}/${f.total})`).join(", ")}` : `all ${fp.player.length} player fields and ${fp.entry.length} value fields from §2.9 present on every entry (redraft + dynasty, ${redraft.length + dynasty.length} entries)`,
    ev(p, redraftRes, "[].player.{id,name,position,sleeperId,espnId,mflId,fleaflickerId,ffpcId,maybeTeam,maybeAge}", fieldSample),
    note("[] extra fields", { entry: fp.extraEntryKeys, player: fp.extraPlayerKeys }, "not in the spec"),
  );
  const allKeys = new Set([...redraft, ...dynasty].flatMap((e) => Object.keys(e.player)));
  const yahooKeys = [...allKeys].filter((k) => /yahoo/i.test(k));
  (yahooKeys.length ? cl.warn : cl.ok).call(cl, "FC", "FC.noYahoo", "No Yahoo ID", yahooKeys.length ? `unexpected Yahoo field(s): ${yahooKeys.join(", ")}` : `no Yahoo ID field among the ${allKeys.size} player keys; Yahoo players must go through the DynastyProcess map`, ev(p, redraftRes, "[].player (keys)", [...allKeys].sort()));

  // ---- positions, K/DEF/IDP, depth
  const posR = countsByPosition(redraft);
  const posD = countsByPosition(dynasty);
  cl.ok("FC", "FC.positions", "Counts by position", `redraft ${redraft.length} entries, dynasty ${dynasty.length} entries`, ev(p, redraftRes, "[].player.position (redraft)", sortCounts(posR)), ev(p, dynastyRes, "[].player.position (dynasty)", sortCounts(posD)));
  const allFormatPositions = new Set(ok.flatMap((r) => (r.data ?? []).map((e) => e.player.position)));
  const nonSkill = [...allFormatPositions].filter((x) => !["QB", "RB", "WR", "TE", "PICK"].includes(x));
  (nonSkill.length ? cl.warn : cl.ok).call(
    cl,
    "FC",
    "FC.kdefidp",
    "K/DEF/IDP coverage",
    nonSkill.length ? `other positions present: ${nonSkill.join(", ")}` : `no K, DEF or IDP entry in any of the ${ok.length} formats (positions: ${[...allFormatPositions].sort().join(", ")}), so they get config.valueFloor as §9 says`,
    ev(p, dynastyRes, "[].player.position (union over formats)", [...allFormatPositions].sort()),
  );

  const top = topEntry(redraft);
  const topValue = top?.value ?? 0;
  const floor = topValue * 0.01;
  const bf = belowFloor(redraft, floor);
  const dynastyPlayers = dynasty.filter((e) => e.player.position !== "PICK").length;
  cl.warn(
    "FC",
    "FC.redraftDepth",
    "Redraft pool depth",
    `redraft values list only ${redraft.length} QB/RB/WR/TE (~${Math.round(redraft.length / 12)} per team in a 12-team league); ${bf.atOrBelow} of them are at or below 1% of the top value (${Math.round(floor)}), the lowest ${bf.min ? `${bf.min.player.name} ${bf.min.player.position}: ${bf.min.value}` : "?"}. Deeper rostered players have no redraft value (valueFloor). Dynasty lists ${dynastyPlayers} players`,
    ev(p, redraftRes, "[].value (tail)", { min: bf.min ? `${bf.min.player.name}: ${bf.min.value}` : null, top: topValue, onePercent: Math.round(floor), belowOnePercent: bf.below }),
  );

  // ---- draft picks (dynasty)
  const picks = pickRows(dynasty);
  const picksSf = pickRows(get("dynasty-2qb")?.data ?? []);
  const unparsed = picks.filter((x) => !x.parsed);
  const seasons = [...new Set(picks.map((x) => x.season))].sort();
  const tieredSeasons = [...new Set(picks.filter((x) => x.tier).map((x) => x.season))].sort();
  const tiers = sortCounts(countBy(picks, (x) => `${x.season} ${x.tier ?? "generic"}`));
  const keys = pickKeyForms(picks);
  const fpFields = Object.entries(keys.byField).filter(([, k]) => (k["FP_ key"] ?? 0) === picks.length).map(([f]) => f);
  const nullFields = Object.entries(keys.byField).filter(([, k]) => (k.null ?? 0) === picks.length).map(([f]) => f);
  const oddFields = Object.entries(keys.byField).filter(([f]) => !fpFields.includes(f) && !nullFields.includes(f));
  const zeroRedraft = picks.filter((x) => x.redraftValue === 0).length;
  const redraftPicks = redraftFormats.reduce((n, r) => n + (r.data ?? []).filter((e) => e.player.position === "PICK").length, 0);
  const sfNames = compareNameSets(
    picks.map((x) => x.name),
    picksSf.map((x) => x.name),
  );
  const offsetText = (o: Record<string, number>) =>
    Object.entries(o)
      .map(([k, n]) => `${k === "0" ? "rounds counted from 1" : k === "-1" ? "rounds counted from 0" : `offset ${k}`} ×${n}`)
      .join(", ") || "none";
  const picksOk = picks.length > 0 && !unparsed.length && sfNames.same && !oddFields.length && keys.seasonMismatches === 0 && keys.sameKeyAcrossFields === picks.length;
  (picksOk ? cl.ok : picks.length ? cl.warn : cl.fail).call(
    cl,
    "FC",
    "FC.picks",
    "Dynasty rookie picks",
    picks.length
      ? `${picks.length} PICK rows (seasons ${seasons.join(", ")}; rounds 1–${Math.max(...picks.map((x) => x.round ?? 0))}); ${picks.length - unparsed.length}/${picks.length} names parse as "YYYY Nth"${tieredSeasons.length ? `, with an (Early)/(Mid)/(Late) split for ${tieredSeasons.join(", ")}` : ""}. Pick keys: ${fpFields.join("/") || "none"} hold "FP_…" strings on every pick (the same key in each field on ${keys.sameKeyAcrossFields}/${picks.length}), ${nullFields.join("/") || "none"} are null${oddFields.length ? `; mixed: ${oddFields.map(([f, k]) => `${f} ${JSON.stringify(k)}`).join(", ")}` : ""}. Key numbering per pick: generic keys (FP_YYYY_N) ${offsetText(keys.roundOffset.generic)}; tiered keys (FP_YYYY_tier_N) ${offsetText(keys.roundOffset.tiered)}${keys.seasonMismatches ? `; ${keys.seasonMismatches} keys name another season` : ""}. redraftValue is 0 on ${zeroRedraft}/${picks.length}. The ${redraftFormats.length} redraft responses carry ${redraftPicks} PICK rows. Superflex dynasty: ${sfNames.same ? `the same ${picksSf.length} pick names` : `different names (only 1QB: ${sfNames.onlyA.join(", ") || "—"}; only SF: ${sfNames.onlyB.join(", ") || "—"})`}`
      : "no PICK rows in the dynasty response",
    ev(p, dynastyRes, "[].player.name where position=PICK", picks.slice(0, 6).map((x) => `${x.name}: ${x.value}`)),
    note("[].player.{sleeperId,espnId,mflId,fleaflickerId,ffpcId} on PICK rows", keys.byField, `per season/tier: ${JSON.stringify(tiers)}`),
    note("key number − round from the name", keys.roundOffset, "e.g. FP_2027_1 = 2027 1st (offset 0); FP_2027_early_0 = 2027 1st (Early) (offset −1)"),
  );

  // ---- value vs redraftValue vs combinedValue
  const relR = valueRelations(redraft);
  const relD = valueRelations(dynasty);
  const combined = relD.combinedIsSum + relR.combinedIsSum;
  const withCombined = relD.withCombined + relR.withCombined;
  (relR.valueEqualsRedraft === relR.total && combined === withCombined ? cl.ok : cl.warn).call(
    cl,
    "FC",
    "FC.valueFields",
    "value vs redraftValue",
    `redraft: value = redraftValue on ${relR.valueEqualsRedraft}/${relR.total}; dynasty: value differs from redraftValue on ${relD.total - relD.valueEqualsRedraft}/${relD.total}; combinedValue = value + redraftValue on ${combined}/${withCombined}. So one dynasty response carries both numbers a keeper league needs (value = future term, redraftValue = perception) (inferred from these equalities)`,
    ev(p, dynastyRes, "[].{value,redraftValue,combinedValue}", dynasty.slice(0, 3).map((e) => `${e.player.name}: ${e.value}/${e.redraftValue}/${String(e.combinedValue)}`)),
  );

  // ---- top value (valueFloor / waiverCreditMin = 1% of it)
  const tops = ["redraft", "redraft-2qb", "dynasty", "dynasty-2qb"].map((n) => {
    const t = topEntry(get(n)?.data ?? []);
    return { format: n, top: t ? `${t.player.name} (${t.player.position}) ${t.value}` : null, onePercent: t ? Math.round(t.value / 100) : null };
  });
  cl.ok("FC", "FC.topValue", "Top value (floor = 1%)", `top redraft value ${topValue} → valueFloor = waiverCreditMin = ${Math.round(floor)}; top values by format in the evidence`, ev(p, redraftRes, "max([].value)", tops));

  // ---- parameter effects
  const cmp = (name: string) => {
    const other = get(name);
    return other?.data ? { r: compareFormats(redraft, other.data), res: other.res } : null;
  };
  const qb2 = cmp("redraft-2qb");
  if (qb2) {
    const qbRatio = qb2.r.medianRatioByPos.QB ?? 0;
    (qbRatio > 1.5 ? cl.ok : cl.warn).call(cl, "FC", "FC.numQbs", "numQbs=2 changes values", `${qb2.r.changed}/${qb2.r.changed + qb2.r.same} values change; QB median ×${qbRatio}`, ev(p, qb2.res, "[].value vs redraft baseline (median ratio by position)", qb2.r.medianRatioByPos));
  }
  const teamRows = ["redraft-8team", "redraft-10team", "redraft-14team"].map((n) => ({ n, c: cmp(n) }));
  const teamsChanged = teamRows.filter((t) => t.c && t.c.r.changed > 0);
  (teamsChanged.length === teamRows.length ? cl.ok : cl.warn).call(
    cl,
    "FC",
    "FC.numTeams",
    "numTeams 8/10/14 change values",
    teamRows.map((t) => `${t.n.replace("redraft-", "")}: ${t.c ? `${t.c.r.changed} changed, ${t.c.r.onlyInBase} dropped, ${t.c.r.onlyInOther} added` : "not fetched"}`).join("; "),
    ...teamRows.filter((t) => t.c).map((t) => ev(p, t.c?.res, "[].value vs 12-team baseline (median ratio)", t.c?.r.medianRatioByPos)),
  );
  const pprRows = ["redraft-ppr0", "redraft-ppr0.5"].map((n) => ({ n, c: cmp(n) }));
  (pprRows.every((t) => t.c && t.c.r.changed > 0) ? cl.ok : cl.warn).call(
    cl,
    "FC",
    "FC.ppr",
    "ppr 0 / 0.5 change values",
    pprRows.map((t) => `${t.n.replace("redraft-", "")}: ${t.c ? `${t.c.r.changed} changed` : "not fetched"}`).join("; "),
    ...pprRows.filter((t) => t.c).map((t) => ev(p, t.c?.res, "[].value vs ppr=1 baseline (median ratio)", t.c?.r.medianRatioByPos)),
  );

  // ---- docs and terms (read before tep, whose documented values come from the docs)
  const docs = await readFcDocs(p);
  const found = (label: string) => docs.quotes.find((q) => q.label === label)?.quote ?? null;

  const tepRows = ["redraft-te+", "redraft-te++"].map((n) => ({ n, c: cmp(n) }));
  const tepOnlyTe = tepRows.every((t) => t.c && t.c.r.changed > 0 && t.c.r.changedPositions.join() === "TE");
  const teSample = (name: string) => {
    const d = new Map((get(name)?.data ?? []).map((e) => [e.player.id, e.value]));
    return redraft
      .filter((e) => e.player.position === "TE")
      .slice(0, 3)
      .map((e) => `${e.player.name}: ${e.value}→${d.get(e.player.id) ?? "?"}`);
  };
  const tepDoc = docs.params ? /tep\b.*?Default none/i.exec(docs.params)?.[0] : undefined;
  (tepOnlyTe ? cl.ok : cl.warn).call(
    cl,
    "FC",
    "FC.tep",
    "TE premium (tep)",
    tepOnlyTe
      ? `tep changes TE values only: te+ median ×${tepRows[0]?.c?.r.medianRatioByPos.TE}, te++ median ×${tepRows[1]?.c?.r.medianRatioByPos.TE}; every other position unchanged. Sent percent-encoded (tep=te%2B, as URLSearchParams writes it); a literal "+" would decode as a space under form encoding (inferred, not tested)${tepDoc ? `. Docs: "${tepDoc}"` : ""}`
      : `unexpected: ${tepRows.map((t) => `${t.n}: ${t.c ? `${t.c.r.changed} changed at ${t.c.r.changedPositions.join("/")}` : "not fetched"}`).join("; ")}`,
    ...tepRows.map((t) => ev(p, t.c?.res, "[].value (TE) vs baseline", teSample(t.n))),
    note(undefined, undefined, "tested in redraft only (format budget); dynasty + tep not verified"),
  );

  // ---- GET /players (documented; at most once per day)
  try {
    const { data, res } = await p.timed("fantasycalc", () =>
      getJson<FcPlayerRecord[]>(FC_PLAYERS_URL, { cache: { key: `fantasycalc:${FC_PLAYERS_URL}`, ttlMs: TTL.fantasyCalc, namespace: "fantasycalc" }, label: "FantasyCalc /players" }),
    );
    if (!Array.isArray(data)) throw new Error("response is not an array");
    state.fcPlayers = data;
    await saveRawSafe(p, "fantasycalc:players", data, res);
    await saveFixture(p, fixtureLabels.fcPlayers, data.slice(0, 100), res);
    const pos = sortCounts(data.reduce<Record<string, number>>((m, x) => ((m[x.position] = (m[x.position] ?? 0) + 1), m), {}));
    const keysP = [...new Set(data.flatMap((x) => Object.keys(x)))].sort();
    const skill = data.filter((x) => ["QB", "RB", "WR", "TE"].includes(x.position));
    const withSleeper = skill.filter((x) => x.sleeperId && !isPickId(x.sleeperId)).length;
    const valued = new Set([...redraft, ...dynasty].filter((e) => e.player.position !== "PICK").map((e) => e.player.id));
    const inValues = data.filter((x) => valued.has(x.id)).length;
    const pickCount = data.filter((x) => x.position === "PICK").length;
    (inValues === valued.size ? cl.ok : cl.warn).call(
      cl,
      "FC",
      "FC.players",
      "GET /players",
      `HTTP ${res.status}: ${data.length} entries (${skill.length} QB/RB/WR/TE, ${withSleeper} of them with a sleeperId; ${pickCount} PICK rows); ${inValues}/${valued.size} players on the value rows appear here, so it is the widest FantasyCalc ID source (${Math.round(data.length / Math.max(1, valued.size))}× the valued players)`,
      ev(p, res, "[].position", pos, freshness(res, "24 h")),
      ev(p, res, "[] keys", keysP),
    );
    addTeamCodes(state, "FantasyCalc", data.map((x) => ({ code: x.maybeTeam, sleeperId: isPickId(x.sleeperId) ? null : x.sleeperId })));
  } catch (err) {
    cl.fail("FC", "FC.players", "GET /players", `failed: ${errMsg(err)}`, note(undefined, undefined, undefined, FC_PLAYERS_URL));
  }
  addTeamCodes(
    state,
    "FantasyCalc",
    [...redraft, ...dynasty].filter((e) => e.player.position !== "PICK").map((e) => ({ code: e.player.maybeTeam as string | null | undefined, sleeperId: e.player.sleeperId })),
  );

  // ---- ID coverage on value rows
  const covR = idCoverage(redraft);
  const covD = idCoverage(dynasty);
  cl.ok("FC", "FC.ids", "Platform IDs on value rows", `QB/RB/WR/TE with each ID (redraft ${covR.players} / dynasty ${covD.players} players); pick keys excluded`, ev(p, redraftRes, "[].player.<id> (redraft)", covR.byField), ev(p, dynastyRes, "[].player.<id> (dynasty)", covD.byField));

  // ---- docs and terms, quoted
  const missingQuotes = docs.quotes.filter((q) => !q.quote);
  const facts: string[] = [];
  if (docs.endpoints.length) facts.push(`documented endpoints: ${docs.endpoints.join(", ")}`);
  if (found("documented endpoints only") && found("other endpoints")) facts.push("calling any other endpoint \"may result in permanent IP bans\"");
  if (found("/values/current refresh")) facts.push("/values/current at most hourly");
  if (found("/players refresh")) facts.push(`/players at most daily (our 24 h cache: ${TTL.fantasyCalc >= 24 * 3600_000 ? "complies with both" : "too short"})`);
  if (found("a. non-commercial")) facts.push("non-commercial use only");
  if (found("c. attribution")) facts.push("attribution on every page, \"clearly visible and placed in close proximity to the displayed data\"");
  if (found("d. website reference")) facts.push("a visible link to FantasyCalc.com");
  if (found("b. permissible use")) facts.push("no \"material substitute\" for their content");
  if (found("public launch (2)")) facts.push("email FantasyCalc before a public launch");
  const quoteEv: Evidence[] = docs.quotes.filter((q) => q.quote).map((q) => note(`${q.doc}: ${q.label}`, undefined, `"${q.quote}"`, q.url));
  if (docs.params) quoteEv.push(note("api-docs: GET /values/current query parameters", undefined, `"${docs.params}"`, docs.quotes.find((q) => q.doc === "api-docs")?.url));
  (docs.errors.length || !docs.quotes.length ? cl.warn : missingQuotes.length ? cl.warn : cl.ok).call(
    cl,
    "FC",
    "FC.terms",
    "Docs and terms of use",
    docs.quotes.length && !docs.errors.length
      ? `read from the site's JS bundle (route chunks behind /terms-of-usage and /api-docs; ${docs.fetched}); ${docs.quotes.length - missingQuotes.length}/${docs.quotes.length} expected clauses found verbatim${missingQuotes.length ? ` (not found: ${missingQuotes.map((q) => `${q.doc} "${q.phrase}"`).join(", ")} — the text changed)` : ""}. ${facts.join("; ")}`
      : `could not read the docs/terms: ${docs.errors.join("; ") || "no text"}; nothing verified this run`,
    note(undefined, undefined, `pages are client-rendered; text taken from the lazy route chunks (${docs.fetched})`, `${FANTASYCALC_SITE}/terms-of-usage`),
    ...quoteEv,
  );

  // ---- decisions, issues, questions (numbers computed above)
  cl.decision(`FantasyCalc: send tep only for TE-premium leagues (te+ or te++), percent-encoded (URLSearchParams does this); omit it otherwise${tepDoc ? ' ("Default none" per the docs, FC.tep)' : ""}.`);
  cl.decision(
    "FantasyCalc: always send the nearest supported numTeams (8/10/12/14) ourselves, and don't fetch unsupported sizes: in the Phase 0 run of 2026-09-29, numTeams=16 returned HTTP 200 with values identical to the 12-team default (198/198 players; only maybeTier differed), i.e. a silent fallback. The format was then dropped from the daily set, since fetching it fetched the 12-team values a second time.",
  );
  const numberingDiffers = Object.keys(keys.roundOffset.generic).sort().join() !== Object.keys(keys.roundOffset.tiered).sort().join();
  cl.decision(
    `FantasyCalc picks: "FP_…" keys in ${fpFields.join("/") || "the ID fields"} belong to PICK rows and are never matched as player IDs; league picks map by name ("YYYY Nth", plus "(Early|Mid|Late)" for ${tieredSeasons.join(", ") || "none"}), not by key${numberingDiffers ? ", because generic and tiered keys number rounds differently (FC.picks)" : ""}.`,
  );
  cl.decision("FantasyCalc fixtures are trimmed (top 50 per format + picks + TEs where relevant), because the terms forbid reproducing substantial portions of their data.");
  if (found("c. attribution"))
    cl.issue(
      `FantasyCalc attribution: the terms (clause c, quoted in FC.terms) want "FantasyCalc" shown "in close proximity to the displayed data" on every page, not only in a footer (§14 specifies a footer link) — evidence: ${docs.quotes.find((q) => q.label === "c. attribution")?.url ?? "terms chunk"} — options: add a small "Values: FantasyCalc" link on each trade card and League table, or keep the footer only.`,
    );
  const gap = redraftGap(redraft, dynasty);
  cl.issue(
    `FantasyCalc redraft values stop at ${redraft.length} players; rostered bench players in deep leagues get no redraft value — evidence: /values/current?isDynasty=false&numQbs=1&numTeams=12&ppr=1 HTTP 200, ${redraft.length} entries. The dynasty response can't fill the gap: ${gap.missingWithRedraftValue}/${gap.missingFromRedraft} of its players missing from the redraft list have a non-zero redraftValue (for the ${gap.inBoth} in both, dynasty.redraftValue = the redraft value on ${gap.redraftValueMatches}) — options: use valueFloor as §9 says (default), or derive a redraft proxy from dynasty value for the missing players.`,
  );
  cl.issue("FantasyCalc TE premium was verified in redraft only (the daily format budget). Options: test dynasty + tep=te+ on another day, or assume it behaves the same.");
  if (bf.below > 0)
    cl.question(
      `§9: valueFloor (1% of the top value = ${Math.round(floor)}) is above ${bf.below} players who do have a redraft value (${pct(bf.below, redraft.length)}; lowest ${bf.min ? `${bf.min.player.name} at ${bf.min.value}` : "?"}), so an uncovered player would outrank covered ones. Use min(valueFloor, the lowest covered value) instead?`,
    );
  if (found("public launch (2)")) cl.question("FantasyCalc's API docs ask apps to email them before a public launch (quoted in FC.terms). Add that to the Phase 7 checklist?");
  cl.question("For item M in redraft leagues, should a player count as matched when he has an ID match in FantasyCalc at all (/players), or only when he has a redraft value?");
}
