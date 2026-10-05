import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { deploymentUrl, isAllowlist, jsonOf, looksProtected, MAX_FILES, parseDeployArgs, protectionOn, ROOT, uploadProblems } from "./preview-deploy";

describe("preview:deploy never deploys production", () => {
  it("takes only --live, and refuses anything that could reach production", () => {
    expect(parseDeployArgs([])).toEqual({ ok: true });
    expect(parseDeployArgs(["--live"])).toEqual({ ok: true });
    for (const a of ["--prod", "--target=production", "--target", "production", "promote", "--public"]) {
      const r = parseDeployArgs(["--live", a]);
      expect(r.ok).toBe(false);
    }
    expect(parseDeployArgs(["--force"])).toMatchObject({ ok: false, error: expect.stringContaining("Unknown option") });
  });
});

describe("the upload checks", () => {
  it("the project's .vercelignore is the allowlist", () => {
    expect(isAllowlist(readFileSync(path.join(ROOT, ".vercelignore"), "utf8"))).toBe(true);
    expect(isAllowlist("# comment\n/*\n!/src\n")).toBe(true);
    expect(isAllowlist("fixtures/raw\n")).toBe(false);
    expect(isAllowlist("/*\n!/src\nfoo\n")).toBe(false);
    expect(isAllowlist("")).toBe(false);
  });

  it("a dry run with only the build's files passes; anything private, too many files or another framework fails", () => {
    const ok = { fileCount: 3, totalSize: 1_000, framework: { slug: "nextjs" }, files: [{ path: "src/app/page.tsx", size: 900 }, { path: "package.json", size: 50 }, "public/icons/icon-192.png"] };
    expect(uploadProblems(ok)).toEqual([]);
    for (const bad of ["fixtures/raw/espn/league.json", "data-local/parker-league-4c/meta.json", "reports/STATUS.md", ".env.local", "src/.env.production", "CLAUDE.md", ".cache/app/x.json", "scripts/stable.ts", ".vercel/project.json"]) {
      expect(uploadProblems({ ...ok, files: [...ok.files, bad] }).join(" ")).toContain("must never upload");
    }
    expect(uploadProblems({ ...ok, fileCount: MAX_FILES + 1 }).join(" ")).toContain("files");
    expect(uploadProblems({ ...ok, framework: { slug: "other" } }).join(" ")).toContain("framework");
    expect(uploadProblems({ framework: { slug: "nextjs" } }).join(" ")).toContain("no files");
  });
});

describe("reading the CLI's answers", () => {
  it("protection is on only when Vercel Authentication covers deployments", () => {
    expect(protectionOn({ name: "offersheet", ssoProtection: { deploymentType: "all_except_custom_domains" } })).toBe(true);
    expect(protectionOn({ name: "offersheet", ssoProtection: null })).toBe(false);
    expect(protectionOn({})).toBe(false);
    expect(protectionOn(null)).toBe(false);
  });

  it("finds the deployment's address, and the JSON among the CLI's lines", () => {
    expect(deploymentUrl('{"deployment":{"url":"https://offersheet-abc123-someone.vercel.app"}}')).toBe("https://offersheet-abc123-someone.vercel.app");
    expect(deploymentUrl("Preview: https://offersheet-x9.vercel.app [2s]")).toBe("https://offersheet-x9.vercel.app");
    expect(deploymentUrl("no address here")).toBeNull();
    expect(jsonOf('Vercel CLI 62.2.0\n{"a":1}\n')).toEqual({ a: 1 });
    expect(jsonOf("nothing")).toBeNull();
  });

  it("a preview is protected when it refuses or redirects to Vercel's login; a 200 is not", () => {
    expect(looksProtected(401, null)).toBe(true);
    expect(looksProtected(302, "https://vercel.com/sso-api?url=…")).toBe(true);
    expect(looksProtected(200, null)).toBe(false);
    expect(looksProtected(302, "https://example.com/")).toBe(false);
    expect(looksProtected(0, null)).toBe(false);
  });
});
