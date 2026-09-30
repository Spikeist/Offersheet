"use client";
/**
 * Hands a successful import to the Import Report: sessionStorage only (never localStorage, never
 * credentials). A team hint from a pasted ESPN team link is kept in the browser as a pick for the
 * user to confirm (lib/importStore recordImport), never sent to the server as "my team".
 */
import type { ImportResponse } from "@/lib/api";
import { recordImport, type ImportRequestSummary, type SaveResult } from "@/lib/importStore";
import { browserSessionStorage, notifySessionChange } from "@/lib/useSessionValue";

export function finishImport(request: ImportRequestSummary, response: ImportResponse, teamHint?: string): SaveResult {
  const storage = browserSessionStorage();
  if (!storage) return { ok: false, message: "Your browser is blocking site storage, so we can't show the report. Allow site data for this page and try again." };
  const saved = recordImport(storage, { request, response, savedAt: new Date().toISOString(), ...(teamHint ? { teamHint } : {}) });
  if (saved.ok) notifySessionChange();
  return saved;
}
