"use client";

import { useSyncExternalStore } from "react";

/**
 * この端末に覚えておく見せ方の設定（絞り込み・リストか表か など）。
 * サーバーで描くときと、端末に何も入っていないときは fallback。読めない環境（プライベートブラウズなど）でも動く
 */
const listeners = new Map<string, Set<() => void>>();

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function useLocalPref<T>(key: string, parse: (raw: string | null) => T): [T, (next: T) => void] {
  const raw = useSyncExternalStore(
    (fn) => {
      const set = listeners.get(key) ?? new Set();
      set.add(fn);
      listeners.set(key, set);
      window.addEventListener("storage", fn);
      return () => {
        set.delete(fn);
        window.removeEventListener("storage", fn);
      };
    },
    () => read(key),
    () => null,
  );
  const set = (next: T) => {
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {}
    for (const fn of listeners.get(key) ?? []) fn();
  };
  return [parse(raw), set];
}

/** 画面の幅がスマホか（サーバーで描くときは分からないので null） */
export function useIsPhone(): boolean | null {
  return useSyncExternalStore(
    (fn) => {
      const mq = window.matchMedia("(max-width: 767px)");
      mq.addEventListener("change", fn);
      return () => mq.removeEventListener("change", fn);
    },
    () => window.matchMedia("(max-width: 767px)").matches,
    () => null,
  );
}
