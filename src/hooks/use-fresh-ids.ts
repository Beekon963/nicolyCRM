"use client";

import { useState } from "react";

/**
 * 前の描画になかった id（新しく出てきたもの）。チップが新しく出たときだけ動きを付けるのに使う（Phase 22-6）。
 * 最初の描画ではすべて「前からあった」扱い（開いたときに全部が動かないように）。
 * データが変わった直後の描画から、次にデータが変わるまで同じ答えを返す（動きの途中でクラスが外れないように）
 */
export function useFreshIds(ids: string[]): Set<string> {
  const key = ids.join("\n");
  const [hist, setHist] = useState<{ prev: string | null; cur: string }>({ prev: null, cur: key });
  // 前の描画の id を覚える（値が変わったときに描画中に setState する、React の決まった書き方。すぐ描き直される）
  if (hist.cur !== key) setHist({ prev: hist.cur, cur: key });
  const baseKey = hist.cur === key ? hist.prev : hist.cur;
  if (baseKey == null) return new Set();
  const base = new Set(baseKey ? baseKey.split("\n") : []);
  return new Set(ids.filter((id) => !base.has(id)));
}
