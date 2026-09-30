import { describe, expect, it } from "vitest";
import { camelOf, parseDocs, snakeOf } from "./docs";

// Synthetic markup in the shape of the API docs page (paths, definitions, schemas, enum defaults).
const DOCS = `<h5>Paths</h5>
<a href="#path--FetchLeagueRules">/FetchLeagueRules</a> <a href="#path--FetchTrades">/FetchTrades</a>
<a href="#definition-ws.flea.api.FetchScoringBreakdownResponse">ws.flea.api.FetchScoringBreakdownResponse</a>
<section id="definition-ws.flea.api.League" class="definition panel">
<dt data-property-name="max_keepers"><span class="json-property-name">max_keepers</span></dt>
<dt data-property-name="has_playoffs"></dt></section>
<section id="definition-ws.flea.api.RosterPositionGroup" class="definition panel">
<span class="json-property-enum-item json-property-enum-default-value">BENCH</span>, <span class="json-property-enum-item">START</span></section>
<section id="definition-ws.flea.api.TransactionType" class="definition panel">
<span class="json-property-enum-item json-property-enum-default-value"> TRANSACTION_ADD </span></section>`;

describe("parseDocs", () => {
  it("reads paths, definitions, property names, enum defaults and per-schema lists", () => {
    const d = parseDocs(DOCS);
    expect(d.paths).toEqual(["FetchLeagueRules", "FetchTrades"]);
    expect(d.definitions).toEqual(["FetchScoringBreakdownResponse"]);
    expect([...d.properties]).toEqual(["max_keepers", "has_playoffs"]);
    expect([...d.enumDefaults]).toEqual(["BENCH", "TRANSACTION_ADD"]);
    expect(d.schemas.League).toEqual({ properties: ["max_keepers", "has_playoffs"], enumValues: [] });
    expect(d.schemas.RosterPositionGroup?.enumValues).toEqual(["BENCH", "START"]);
  });

  it("reads a path's query parameters", () => {
    const html = `<div id="path--FetchUserLeagues"> GET /FetchUserLeagues <td>sport:</td> <td>string</td> NFL in query <td>user_id:</td> <td>integer (int32)</td> in query <td>email:</td> <td>string</td> in query 200 OK <td>leagues:</td> <td>string</td> in query</div>`;
    expect(parseDocs(html).pathParams.FetchUserLeagues).toEqual(["sport", "user_id", "email"]);
  });

  it("converts between snake_case and camelCase", () => {
    expect(camelOf("active_for_current_season")).toBe("activeForCurrentSeason");
    expect(snakeOf("activeForCurrentSeason")).toBe("active_for_current_season");
  });
});
