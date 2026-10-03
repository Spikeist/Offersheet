"use client";
/**
 * localStorage, as the pages read and write it (the per-league settings and the trade feedback, CLAUDE.md
 * §12 and §11; lead decision L12): useLocalValue reads one value as external state (useSyncExternalStore),
 * like useSessionValue does for sessionStorage, so a page re-renders when the value changes in this tab
 * (notifyLocalChange) or in another one (the browser's "storage" event: settings changed in a second tab reach
 * an open League page). On the server, and while the page hydrates, the value is undefined: there's no
 * storage there, and a page must not compute with defaults it would throw away a moment later.
 *
 * A browser that blocks site data throws on any access to localStorage (a private window doesn't: its
 * storage is just emptied when the window closes). Every access is wrapped, so a blocked storage reads as
 * nothing stored and a write reports that it failed.
 */
import { useSyncExternalStore } from "react";

/** Dispatched on window after this tab changes a localStorage value (the "storage" event only fires in other tabs). */
export const LOCAL_STORAGE_CHANGED_EVENT = "offersheet:local-storage-changed";

/** The browser's localStorage, or undefined on the server or when it's blocked. */
export function browserLocalStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** Tell every useLocalValue() in this tab to read again. */
export function notifyLocalChange(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(LOCAL_STORAGE_CHANGED_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(LOCAL_STORAGE_CHANGED_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(LOCAL_STORAGE_CHANGED_EVENT, onChange);
  };
}

/** The stored string; null when absent or blocked; undefined during server rendering and hydration. */
export function useLocalValue(key: string): string | null | undefined {
  return useSyncExternalStore(
    subscribe,
    () => {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    () => undefined,
  );
}
