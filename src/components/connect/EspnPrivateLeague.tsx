"use client";
/**
 * The two ways into a private ESPN league (CLAUDE.md §14): ask the commissioner to make the league
 * viewable, or connect with the ESPN cookies on a computer. The cookie values travel once, in a POST
 * body, into an encrypted session-only cookie; the form clears them right after. We never ask for
 * the ESPN password. "Forget my credentials" is handled by EspnConnect, whose status line outlives
 * this panel.
 */
import { useId, useState, type Ref } from "react";
import { callApi, isApiError, type EspnSessionStatus } from "@/lib/api";
import { commissionerMessage } from "@/lib/commissioner";
import { checkEspnCredentials } from "@/lib/espnCredentials";
import type { AppErrorCode } from "@/lib/errors";
import { CopyButton } from "../CopyButton";
import { Callout, Card, CardTitle, FOCUS_TARGET, Spinner, buttonClass, cx, inputBase } from "../ui";

const IGNORE_PASSWORD_MANAGERS = { "data-1p-ignore": "", "data-lpignore": "true", "data-bwignore": "true" } as const;

export function EspnPrivateLeague({
  error,
  session,
  onSessionChange,
  onCookiesSaved,
  onForget,
  busy,
  alertRef,
}: {
  error: { code: AppErrorCode; message: string } | null;
  session: EspnSessionStatus | null;
  onSessionChange: (s: EspnSessionStatus) => void;
  onCookiesSaved: () => void;
  onForget: () => void;
  busy: boolean;
  /** The "This league is private" callout, which EspnConnect scrolls to and focuses. */
  alertRef?: Ref<HTMLDivElement>;
}) {
  const ids = useId();
  const [espnS2, setEspnS2] = useState("");
  const [swid, setSwid] = useState("");
  const [formError, setFormError] = useState<{ message: string; field?: "espnS2" | "swid" } | null>(null);
  const [saving, setSaving] = useState(false);
  const message = commissionerMessage();
  const errorId = `${ids}-cookie-error`;

  async function saveCookies() {
    const check = checkEspnCredentials({ espnS2, swid });
    if (!check.ok) {
      setFormError({ message: check.message, field: check.field });
      return;
    }
    setSaving(true);
    setFormError(null);
    const res = await callApi<EspnSessionStatus>("/api/session/espn", { method: "POST", body: check.value });
    setSaving(false);
    if (isApiError(res)) {
      setFormError({ message: res.error.message });
      return;
    }
    // Don't keep the values around in the page any longer than needed.
    setEspnS2("");
    setSwid("");
    onSessionChange(res);
    onCookiesSaved();
  }

  const cookiesUnavailable = session?.available === false;
  const invalid = (field: "espnS2" | "swid") => formError?.field === field;

  return (
    <div className="space-y-4">
      {error ? (
        <div ref={alertRef} tabIndex={FOCUS_TARGET.tabIndex} className={cx(FOCUS_TARGET.className, "rounded-xl")}>
          <Callout tone={error.code === "BAD_CREDENTIALS" ? "danger" : "warn"} title={error.code === "BAD_CREDENTIALS" ? "ESPN didn't accept your cookies" : "This league is private"}>
            <p>{error.message}</p>
            <p className="mt-1">
              {error.code === "BAD_CREDENTIALS"
                ? "Paste fresh cookies below, or ask your commissioner to make the league viewable so you won't need them."
                : "ESPN leagues are private unless the league manager makes them viewable. You have two options:"}
            </p>
          </Callout>
        </div>
      ) : null}

      {error ? (
        <Card>
          <CardTitle eyebrow="Option 1 · works on phones">Ask your commissioner</CardTitle>
          <p className="text-sm leading-relaxed">
            The league manager can turn on <strong>Make League Viewable to Public</strong> under League → Settings → Basic Settings. It lets anyone with the league link view league
            pages, but nobody can join or change anything. Once it&apos;s on, everyone in your league can connect with just the link, on phones too.
          </p>
          <blockquote className="mt-3 rounded-xl border border-line bg-surface-muted p-3 text-sm leading-relaxed">{message}</blockquote>
          <div className="mt-3">
            <CopyButton text={message} />
          </div>
        </Card>
      ) : null}

      <Card>
        <CardTitle eyebrow={error ? "Option 2 · on a computer" : "ESPN cookies"}>Connect with ESPN cookies</CardTitle>

        {session?.connected ? (
          <div className="space-y-3">
            <p className="text-sm">
              {error?.code === "BAD_CREDENTIALS"
                ? "ESPN turned down the cookies saved in this session. Forget them, then paste fresh ones."
                : "Your ESPN cookies are saved for this browser session only."}
            </p>
            <button type="button" onClick={onForget} className={cx(buttonClass("danger", "sm"), "min-h-11")}>
              Forget my credentials
            </button>
          </div>
        ) : cookiesUnavailable ? (
          <Callout tone="warn">Connecting with cookies isn&apos;t available on this server right now. Ask your commissioner to make the league viewable instead.</Callout>
        ) : (
          <div className="space-y-4">
            <Callout tone="warn" title="These cookies work like a password">
              They let anyone who has them act as you on ESPN. Offer Sheet keeps them only in an encrypted cookie in this browser session and sends them only to ESPN. Our
              server never stores them. The cookie is deleted when you close your browser, and unusable after 12 hours at most (or right away with &ldquo;Forget my
              credentials&rdquo;). We never ask for your ESPN password.
            </Callout>

            <p className="text-sm text-muted">On a phone you can&apos;t copy these cookies. Use a computer, or ask your commissioner instead.</p>

            <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed">
              <li>On a computer, open fantasy.espn.com in Chrome, Edge or Firefox and sign in if you aren&apos;t already.</li>
              <li>Open your league, so you know you&apos;re signed in to the right account.</li>
              <li>
                Open the developer tools: press <kbd className="rounded border border-line px-1 font-mono">F12</kbd> (or <kbd className="rounded border border-line px-1 font-mono">Ctrl</kbd>+
                <kbd className="rounded border border-line px-1 font-mono">Shift</kbd>+<kbd className="rounded border border-line px-1 font-mono">I</kbd>; on a Mac,{" "}
                <kbd className="rounded border border-line px-1 font-mono">Cmd</kbd>+<kbd className="rounded border border-line px-1 font-mono">Option</kbd>+
                <kbd className="rounded border border-line px-1 font-mono">I</kbd>).
              </li>
              <li>
                <strong>Chrome or Edge:</strong> open the <strong>Application</strong> tab, then Storage → Cookies → https://fantasy.espn.com. <strong>Firefox:</strong> open
                the <strong>Storage</strong> tab, then Cookies → https://fantasy.espn.com.
              </li>
              <li>
                Type <code className="font-mono">espn_s2</code> in the filter box, double-click its <strong>Value</strong>, copy all of it (it&apos;s long) and paste it below.
              </li>
              <li>
                Do the same for <code className="font-mono">SWID</code>. It looks like {"{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}"}; include the curly braces.
              </li>
            </ol>

            <form
              className="space-y-3"
              autoComplete="off"
              onSubmit={(e) => {
                e.preventDefault();
                void saveCookies();
              }}
            >
              <div>
                <label htmlFor={`${ids}-s2`} className="mb-1 block text-sm font-bold">
                  espn_s2
                </label>
                <textarea
                  id={`${ids}-s2`}
                  rows={3}
                  value={espnS2}
                  onChange={(e) => setEspnS2(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={invalid("espnS2")}
                  aria-describedby={invalid("espnS2") ? errorId : undefined}
                  {...IGNORE_PASSWORD_MANAGERS}
                  className={`${inputBase} font-mono text-sm break-all`}
                />
              </div>
              <div>
                <label htmlFor={`${ids}-swid`} className="mb-1 block text-sm font-bold">
                  SWID
                </label>
                <input
                  id={`${ids}-swid`}
                  value={swid}
                  onChange={(e) => setSwid(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}"
                  aria-invalid={invalid("swid")}
                  aria-describedby={invalid("swid") ? errorId : undefined}
                  {...IGNORE_PASSWORD_MANAGERS}
                  className={`${inputBase} font-mono text-sm`}
                />
              </div>
              {formError ? (
                <p id={errorId} className="text-sm font-semibold text-danger-fg" role="alert">
                  {formError.message}
                </p>
              ) : null}
              <button type="submit" className={buttonClass("primary")} disabled={saving || busy}>
                {saving || busy ? <Spinner /> : null}
                Save for this session and import
              </button>
            </form>
          </div>
        )}
      </Card>
    </div>
  );
}
