import { describe, expect, it } from "vitest";
import { ESPN_S2_MAX_LENGTH, checkEspnCredentials, normalizeEspnS2, normalizeSwid } from "./espnCredentials";

// Obviously fake values: an all-zero GUID and a made-up token.
const FAKE_SWID = "{00000000-0000-4000-8000-000000000000}";
const FAKE_S2 = `AEBfakeTOKEN${"x".repeat(60)}%2Bfake%3D`;

describe("normalizeEspnS2", () => {
  it("keeps a clean value", () => {
    expect(normalizeEspnS2(FAKE_S2)).toBe(FAKE_S2);
  });

  it("strips what people copy around it", () => {
    expect(normalizeEspnS2(`  "${FAKE_S2}"  `)).toBe(FAKE_S2);
    expect(normalizeEspnS2(`espn_s2=${FAKE_S2};`)).toBe(FAKE_S2);
    expect(normalizeEspnS2(`ESPN_S2 = ${FAKE_S2}`)).toBe(FAKE_S2);
  });

  it("rejects short values and cookie-breaking characters", () => {
    expect(normalizeEspnS2("tooShort")).toBeUndefined();
    expect(normalizeEspnS2(`${FAKE_S2}; SWID=${FAKE_SWID}`)).toBeUndefined();
    expect(normalizeEspnS2(`${FAKE_S2} extra`)).toBeUndefined();
  });

  it("accepts nothing longer than the sealed session cookie can hold (B4 security review: 2,000, not 4,000)", () => {
    expect(ESPN_S2_MAX_LENGTH).toBe(2_000);
    const longest = `AEB${"x".repeat(ESPN_S2_MAX_LENGTH - 3)}`;
    expect(normalizeEspnS2(longest)).toBe(longest);
    expect(normalizeEspnS2(`${longest}x`)).toBeUndefined();
    // What a value too long used to reach (a 500 on save): now the same "doesn't look right" as any other bad value.
    expect(checkEspnCredentials({ espnS2: "A".repeat(3_000), swid: FAKE_SWID })).toMatchObject({ ok: false, field: "espnS2" });
  });
});

describe("normalizeSwid", () => {
  it("adds missing curly braces and strips a prefix", () => {
    expect(normalizeSwid(FAKE_SWID)).toBe(FAKE_SWID);
    expect(normalizeSwid(FAKE_SWID.slice(1, -1))).toBe(FAKE_SWID);
    expect(normalizeSwid(`SWID=${FAKE_SWID};`)).toBe(FAKE_SWID);
    expect(normalizeSwid(` '${FAKE_SWID}' `)).toBe(FAKE_SWID);
  });

  it("rejects anything that isn't a GUID", () => {
    expect(normalizeSwid("{not-a-guid}")).toBeUndefined();
    expect(normalizeSwid("")).toBeUndefined();
    expect(normalizeSwid("{00000000-0000-4000-8000-00000000000Z}")).toBeUndefined();
  });
});

describe("checkEspnCredentials", () => {
  it("returns the cleaned pair", () => {
    expect(checkEspnCredentials({ espnS2: ` ${FAKE_S2} `, swid: FAKE_SWID.slice(1, -1) })).toEqual({ ok: true, value: { espnS2: FAKE_S2, swid: FAKE_SWID } });
  });

  it("names the bad field without echoing either value", () => {
    const badS2 = checkEspnCredentials({ espnS2: "abc", swid: FAKE_SWID });
    expect(badS2).toMatchObject({ ok: false, field: "espnS2" });
    if (!badS2.ok) expect(badS2.message).not.toContain(FAKE_SWID);

    const badSwid = checkEspnCredentials({ espnS2: FAKE_S2, swid: "nope" });
    expect(badSwid).toMatchObject({ ok: false, field: "swid" });
    if (!badSwid.ok) expect(badSwid.message).not.toContain(FAKE_S2);

    expect(checkEspnCredentials({})).toMatchObject({ ok: false, field: "espnS2" });
    expect(checkEspnCredentials({ espnS2: 42, swid: {} })).toMatchObject({ ok: false, field: "espnS2" });
  });
});
