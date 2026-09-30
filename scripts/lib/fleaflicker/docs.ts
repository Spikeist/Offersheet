/**
 * Facts from Fleaflicker's public API docs page (https://www.fleaflicker.com/api-docs/index.html),
 * so the probe's statements about the docs are checked each run (cached for 7 days):
 * documented paths, schema definitions, property-name style, and the enum values the docs mark as
 * defaults (the value proto3 omits). Pure parsing: no I/O.
 */
export const DOCS_URL = "https://www.fleaflicker.com/api-docs/index.html";

export interface DocsFacts {
  /** Documented request paths (e.g. FetchLeagueRules). */
  paths: string[];
  /** Response/definition schema names (e.g. FetchScoringBreakdownResponse). */
  definitions: string[];
  /** Property names shown in the docs. */
  properties: Set<string>;
  /** Enum values marked as the default (first) value. */
  enumDefaults: Set<string>;
  /** Per schema (ws.flea.api.<Name>): its property names and enum values, in page order. */
  schemas: Record<string, { properties: string[]; enumValues: string[] }>;
  /** Per documented path: its query parameter names. */
  pathParams: Record<string, string[]>;
}

export function parseDocs(html: string): DocsFacts {
  const paths = [...new Set([...html.matchAll(/href="#path--([A-Za-z]+)"/g)].map((m) => m[1] ?? ""))].filter(Boolean).sort();
  const definitions = [...new Set([...html.matchAll(/href="#definition-ws\.flea\.api\.([A-Za-z]+)"/g)].map((m) => m[1] ?? ""))].filter(Boolean).sort();
  const properties = new Set([...html.matchAll(/data-property-name="([A-Za-z0-9_]+)"/g)].map((m) => m[1] ?? ""));
  const enumDefaults = new Set([...html.matchAll(/json-property-enum-default-value">\s*([A-Z0-9_]+)\s*</g)].map((m) => m[1] ?? ""));
  // Each schema is a section starting at id="definition-ws.flea.api.<Name>" and running to the next one.
  const schemas: DocsFacts["schemas"] = {};
  for (const part of html.split(/id="definition-ws\.flea\.api\./).slice(1)) {
    const name = /^([A-Za-z]+)"/.exec(part)?.[1];
    if (!name) continue;
    schemas[name] = {
      properties: [...new Set([...part.matchAll(/data-property-name="([A-Za-z0-9_]+)"/g)].map((m) => m[1] ?? ""))],
      enumValues: [...new Set([...part.matchAll(/json-property-enum-item[^"]*">\s*([A-Z0-9_]+)\s*</g)].map((m) => m[1] ?? ""))],
    };
  }
  // Each path is a section starting at id="path--<Name>"; parameters read "name: type … in query".
  const pathParams: DocsFacts["pathParams"] = {};
  for (const part of html.split(/id="path--/).slice(1)) {
    const name = /^([A-Za-z]+)"/.exec(part)?.[1];
    if (!name) continue;
    const text = part.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const head = text.split(/\b200 OK\b/)[0] ?? text;
    pathParams[name] = [...new Set([...head.matchAll(/([A-Za-z_.]+):\s*(?:string|integer|boolean|number|array)\b[^:]*?\bin query\b/g)].map((m) => m[1] ?? ""))];
  }
  return { paths, definitions, properties, enumDefaults, schemas, pathParams };
}

/** camelCase → snake_case (maxKeepers → max_keepers). */
export function snakeOf(camel: string): string {
  return camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** snake_case → camelCase (max_keepers → maxKeepers). */
export function camelOf(snake: string): string {
  return snake.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}
