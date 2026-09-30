import { describe, expect, it } from "vitest";
import { agreement, buildEspnMap, classifyEspnDisagreements, columnStats, duplicateSamples, groupBy, idColumns, indexBy, parseCsv, type CsvRow } from "./idmap";
import { countBy, isBlankId, median, pct, toCsv } from "./util";

const csv = [
  "sleeper_id,espn_id,yahoo_id,name,position",
  "100,5000,NA,Alpha One,QB",
  "101,5001,777,Beta Two,RB",
  "NA,5001,,Gamma Three,RB",
  '102,NA,778,"Delta, Jr.",WR',
].join("\n");

describe("DynastyProcess CSV helpers", () => {
  const rows = parseCsv(csv);

  it("parses quoted fields and keeps NA as text", () => {
    expect(rows).toHaveLength(4);
    expect(rows[3]?.name).toBe("Delta, Jr.");
    expect(idColumns(Object.keys(rows[0] ?? {}))).toEqual(["sleeper_id", "espn_id", "yahoo_id"]);
  });

  it("counts non-empty values and duplicates, treating NA and blanks as empty", () => {
    expect(columnStats(rows, "espn_id")).toEqual({ column: "espn_id", nonEmpty: 3, duplicateValues: 1, duplicateRows: 2 });
    expect(columnStats(rows, "yahoo_id")).toMatchObject({ nonEmpty: 2, duplicateValues: 0 });
    expect(duplicateSamples(rows, "espn_id")).toEqual([{ value: "5001", names: ["Beta Two (RB)", "Gamma Three (RB)"] }]);
    expect([...indexBy(rows, "sleeper_id").keys()]).toEqual(["100", "101", "102"]);
  });

  it("measures agreement between two sources", () => {
    const items = [
      { k: "1", l: "5000", r: "5000" },
      { k: "2", l: "5001", r: "9999" },
      { k: "3", l: null, r: "1" },
      { k: "4", l: "UNK", r: "NA" },
      { k: "5", l: 7, r: "7" },
    ];
    const a = agreement(items, (x) => x.l, (x) => x.r, (x) => x.k);
    expect(a).toMatchObject({ compared: 3, agree: 2, disagree: 1, onlyLeft: 0, onlyRight: 1, neither: 1 });
    expect(a.samples).toEqual([{ key: "2", left: "5001", right: "9999", name: undefined }]);
  });
});

describe("ESPN id crosswalk", () => {
  // DynastyProcess rows (all names fictional): two players whose ids the Sleeper DB swapped, an older
  // namesake, another player, a duplicated id, and players whose birthdates settle who is right.
  const dp: CsvRow[] = [
    { sleeper_id: "100", espn_id: "E-A", name: "Zorblax Quintavious", position: "TE", birthdate: "1998-01-01" },
    { sleeper_id: "200", espn_id: "E-B", name: "Quillon Vandersnoot", position: "TE", birthdate: "1995-01-01" },
    { sleeper_id: "300", espn_id: "E-C", name: "Brannoch Tellwright", position: "WR", birthdate: "2001-01-01" },
    { sleeper_id: "NA", espn_id: "E-OLD", name: "Brannoch Tellwright", position: "S", birthdate: "1984-01-01" },
    { sleeper_id: "500", espn_id: "E-F", name: "Other Person", position: "WR", birthdate: "1990-01-01" },
    { sleeper_id: "600", espn_id: "E-G", name: "Grimbleton Oakhurst", position: "QB", birthdate: "1999-01-01" },
    { sleeper_id: "801", espn_id: "E-DUP", name: "Someone Else", position: "TE", birthdate: "1992-12-17" },
    { sleeper_id: "800", espn_id: "E-DUP", name: "Morrow Plinth", position: "TE", birthdate: "1993-05-19" },
    { sleeper_id: "900", espn_id: "E-S", name: "Vexley Barrow", position: "QB", birthdate: "1988-03-13" },
  ];
  const sleeper: Record<string, { espnId?: string; birthDate?: string }> = {
    "100": { espnId: "E-B", birthDate: "1998-01-01" },
    "200": { espnId: "E-A", birthDate: "1995-01-01" },
    "300": { espnId: "E-C", birthDate: "2001-01-01" },
    "400": { espnId: "E-D", birthDate: "2000-01-01" },
    "600": { espnId: "E-G", birthDate: "1999-01-01" },
    "700": { espnId: "E-Y" },
    "800": { espnId: "E-Z", birthDate: "1993-05-19" },
    "900": { espnId: "E-T", birthDate: "1988-03-13" },
  };

  it("classifies FantasyCalc-vs-Sleeper espn_id disagreements by DynastyProcess owner and birthdate", () => {
    const out = classifyEspnDisagreements(
      [
        { sleeperId: "100", name: "Zorblax Quintavious", fcEspnId: "E-A", sleeperEspnId: "E-B" },
        { sleeperId: "300", name: "Brannoch Tellwright", fcEspnId: "E-OLD", sleeperEspnId: "E-C" },
        { sleeperId: "400", name: "Pelliquor Ashgrove", fcEspnId: "E-F", sleeperEspnId: "E-D" },
        { sleeperId: "600", name: "Grimbleton Oakhurst", fcEspnId: "E-NEW", sleeperEspnId: "E-G" },
        { sleeperId: "800", name: "Morrow Plinth", fcEspnId: "E-DUP", sleeperEspnId: "E-Z" },
        { sleeperId: "900", name: "Vexley Barrow", fcEspnId: "E-S", sleeperEspnId: "E-T" },
        { sleeperId: "700", name: "Nobody Known", fcEspnId: "E-X", sleeperEspnId: "E-Y" },
      ],
      groupBy(dp, "espn_id"),
      (sid) => sleeper[sid],
    );
    expect(out.map((d) => [d.cls, d.wrong])).toEqual([
      ["Sleeper DB swapped ids with another player", "Sleeper DB"],
      ["FantasyCalc has a namesake's id (different birthdate)", "FantasyCalc"],
      ["FantasyCalc has another player's id", "FantasyCalc"],
      ["FantasyCalc id unknown to DynastyProcess, which gives this player the Sleeper DB's id", "FantasyCalc"],
      ["unresolved", "unknown"],
      ["Sleeper DB differs: DynastyProcess gives this player FantasyCalc's id (same birthdate)", "Sleeper DB"],
      ["unresolved", "unknown"],
    ]);
    expect(out[1]?.detail).toBe("Brannoch Tellwright (S, b. 1984 vs 2001)");
    expect(out[4]?.detail).toBe("DynastyProcess has FantasyCalc's id on 2 rows");
  });

  it("builds the ESPN map: agreement, within-source duplicates, between-source conflicts, active preference", () => {
    const { map, conflicts } = buildEspnMap(
      [
        { espnId: "1", sleeperId: "10", source: "DynastyProcess" },
        { espnId: "1", sleeperId: "10", source: "FantasyCalc" },
        { espnId: "2", sleeperId: "20", source: "DynastyProcess" },
        { espnId: "2", sleeperId: "21", source: "DynastyProcess" },
        { espnId: "3", sleeperId: "30", source: "DynastyProcess" },
        { espnId: "3", sleeperId: "31", source: "Sleeper DB" },
        { espnId: "NA", sleeperId: "40", source: "FantasyCalc" },
      ],
      (sid) => sid === "21" || sid === "30",
    );
    expect(Object.fromEntries(map)).toEqual({ "1": { sleeperId: "10", source: "DynastyProcess" }, "2": { sleeperId: "21", source: "DynastyProcess" }, "3": { sleeperId: "30", source: "DynastyProcess" } });
    expect(conflicts.map((c) => [c.espnId, c.pair, c.within, c.chosen, c.resolvedBy])).toEqual([
      ["2", "within DynastyProcess", true, "21", "active player"],
      ["3", "DynastyProcess vs Sleeper DB", false, "30", "active player"],
    ]);
  });
});

describe("util", () => {
  it("treats null, blank, NA and UNK as blank IDs", () => {
    expect([null, undefined, "", " ", "NA", "UNK", "null"].every(isBlankId)).toBe(true);
    expect([0, "0", "123", 5].some(isBlankId)).toBe(false);
  });

  it("writes CSV that round-trips through the parser", () => {
    const out = toCsv([{ a: "x,y", b: 'say "hi"', c: null }], ["a", "b", "c"]);
    expect(out).toBe('a,b,c\n"x,y","say ""hi""",\n');
    expect(parseCsv(out)).toEqual([{ a: "x,y", b: 'say "hi"', c: "" }]);
  });

  it("median, pct and countBy", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(pct(1, 3)).toBe("33.3%");
    expect(pct(1, 0)).toBe("n/a");
    expect(countBy(["a", "b", "a"], (x) => x)).toEqual({ a: 2, b: 1 });
  });
});
