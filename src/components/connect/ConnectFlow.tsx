"use client";
import { useState } from "react";
import { Badge, cx } from "../ui";
import { EspnConnect } from "./EspnConnect";
import { SleeperConnect } from "./SleeperConnect";

type Choice = "espn" | "sleeper";

const OPTIONS: { id: string; name: string; note: string; enabled: boolean; badge?: string }[] = [
  { id: "espn", name: "ESPN", note: "League link or ID", enabled: true },
  { id: "sleeper", name: "Sleeper", note: "Username or league ID", enabled: true },
  { id: "yahoo", name: "Yahoo", note: "Waiting on Yahoo's approval", enabled: false, badge: "Coming soon" },
  { id: "other", name: "Fleaflicker, MFL, Fantrax", note: "Fantrax: public leagues", enabled: false, badge: "Later" },
  { id: "manual", name: "Manual entry", note: "NFL.com, CBS and others", enabled: false, badge: "Later" },
];

/** Platform picker plus the form for the chosen platform (CLAUDE.md §14 item 1). */
export function ConnectFlow() {
  const [platform, setPlatform] = useState<Choice>("espn");

  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="mb-2 text-sm font-bold text-muted">Platform</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {OPTIONS.map((o) => {
            const selected = o.id === platform;
            return (
              <label
                key={o.id}
                className={cx(
                  "relative flex min-h-20 flex-col justify-between rounded-2xl border p-3 transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
                  o.enabled ? "cursor-pointer" : "cursor-not-allowed opacity-60",
                  selected ? "border-brand bg-brand-soft ring-2 ring-brand" : "border-line bg-surface hover:bg-surface-muted",
                )}
              >
                <input
                  type="radio"
                  name="platform"
                  value={o.id}
                  checked={selected}
                  disabled={!o.enabled}
                  onChange={() => o.enabled && setPlatform(o.id as Choice)}
                  className="sr-only"
                />
                <span className="font-extrabold leading-tight">{o.name}</span>
                <span className="mt-1 text-xs text-muted">{o.note}</span>
                {o.badge ? (
                  <Badge tone={o.id === "yahoo" ? "warn" : "muted"} className="mt-2 self-start">
                    {o.badge}
                  </Badge>
                ) : null}
              </label>
            );
          })}
        </div>
      </fieldset>

      {platform === "espn" ? <EspnConnect /> : <SleeperConnect />}
    </div>
  );
}
