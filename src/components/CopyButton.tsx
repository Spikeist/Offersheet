"use client";
import { useState } from "react";
import { buttonClass } from "./ui";

/** Copies text to the clipboard; if the browser refuses, tells the user to copy it by hand. */
export function CopyButton({ text, label = "Copy message" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2500);
  }

  return (
    <button type="button" onClick={copy} className={buttonClass("secondary", "sm")} aria-live="polite">
      {state === "copied" ? "Copied!" : state === "failed" ? "Select the text and copy it" : label}
    </button>
  );
}
