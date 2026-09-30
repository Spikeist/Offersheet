import { describe, expect, it } from "vitest";
import { cleanQuote, documentedEndpoints, findLiteral, mainScriptSrc, routeChunk, stringLiterals, textBetween } from "./fc-docs";

describe("FantasyCalc docs reader", () => {
  it("finds the main bundle and a route's lazy chunk", () => {
    expect(mainScriptSrc('<script src="polyfills-AB12.js" type="module"></script><script src="main-QU22HJEG.js" type="module"></script>')).toBe("main-QU22HJEG.js");
    expect(mainScriptSrc("<html></html>")).toBeNull();
    const main = '{path:"old-draft-aid",loadChildren:()=>import("./chunk-5DC2NXVX.js")},{path:"terms-of-usage",pathMatch:"full",loadChildren:()=>import("./chunk-4Z7NMOIA.js").then(r=>r.X)},{path:"api-docs",loadComponent:()=>import("./chunk-UPDBX5JH.js")}';
    expect(routeChunk(main, "terms-of-usage")).toBe("chunk-4Z7NMOIA.js");
    expect(routeChunk(main, "api-docs")).toBe("chunk-UPDBX5JH.js");
    expect(routeChunk(main, "blog")).toBeNull();
  });

  it("decodes string literals, including unicode escapes", () => {
    const js = `a("Non-commercial Use: FantasyCalc\\u2019s data"),b('it\\'s'),c(\`tpl \${x} rest\`),d("x")`;
    expect(stringLiterals(js, 2)).toEqual(["Non-commercial Use: FantasyCalc’s data", "it's", "tpl "]);
  });

  it("quotes the literal holding a phrase, masking e-mail addresses", () => {
    const lits = ["a", " If you plan to publish, please email us at someone@example.com before launch ", "Attribution: shown   close to the data."];
    expect(findLiteral(lits, "before launch")).toBe("If you plan to publish, please email us at [e-mail] before launch");
    expect(findLiteral(lits, "Attribution:")).toBe("Attribution: shown close to the data.");
    expect(findLiteral(lits, "missing phrase")).toBeNull();
    expect(cleanQuote("  x\n y ")).toBe("x y");
  });

  it("joins template text between two markers and lists documented endpoints", () => {
    const lits = ["h2", "GET /values/current", "h3", "Query parameters", "tr", "td", "code", "numTeams", "td", "No", "Number of teams (", "code", "8, 10, 12, 14", "). Default 12.", "h3", "Example request", "GET /players"];
    expect(textBetween(lits, "Query parameters", "Example request")).toBe("numTeams No Number of teams ( 8, 10, 12, 14 ). Default 12.");
    expect(textBetween(lits, "Nope", "Example request")).toBeNull();
    expect(documentedEndpoints(lits)).toEqual(["GET /values/current", "GET /players"]);
  });
});
