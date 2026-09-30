"use client";
/**
 * Reads a sessionStorage value as external state (useSyncExternalStore), so components re-render
 * when this tab changes it and render a neutral placeholder on the server, where there's no storage.
 */
import { useSyncExternalStore } from "react";
import { STORAGE_CHANGED_EVENT } from "./importStore";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(STORAGE_CHANGED_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(STORAGE_CHANGED_EVENT, onChange);
  };
}

/** The browser's sessionStorage, or undefined when it's blocked. */
export function browserSessionStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

/** Tell every useSessionValue() in this tab to re-read. */
export function notifySessionChange(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(STORAGE_CHANGED_EVENT));
}

/** The stored string; null when absent or blocked; undefined during server rendering and hydration. */
export function useSessionValue(key: string): string | null | undefined {
  return useSyncExternalStore(
    subscribe,
    () => {
      try {
        return window.sessionStorage.getItem(key);
      } catch {
        return null;
      }
    },
    () => undefined,
  );
}
