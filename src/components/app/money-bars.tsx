"use client";

import { useState } from "react";
import { formatYen } from "@/lib/money/format";
import { cn } from "@/lib/utils";

export type MoneyBarPoint = { key: string; label: string; confirmed: number; estimate: number; highlight?: boolean };

/** 目盛りの金額（例: 1,200,000 → 「120万」、250,000,000 → 「2.5億」） */
function compact(n: number) {
  if (n === 0) return "0";
  const sign = n < 0 ? "−" : "";
  const a = Math.abs(n);
  const fmt = (v: number) => (Number.isInteger(v) ? v.toLocaleString("ja-JP") : v.toFixed(1));
  if (a >= 100_000_000) return `${sign}${fmt(a / 100_000_000)}億`;
  if (a >= 10_000) return `${sign}${fmt(a / 10_000)}万`;
  return `${sign}${a.toLocaleString("ja-JP")}`;
}

/** 目盛りをきりのいい数にそろえる */
function niceMax(v: number) {
  if (v <= 0) return 0;
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

/**
 * 月ごとの金額の棒グラフ（確定分の上に見込み分を重ねる。1つの軸）。
 * 棒に触れる・フォーカスすると金額が出る。表でも見られる。
 */
export function MoneyBars({ title, points }: { title: string; points: MoneyBarPoint[] }) {
  const [active, setActive] = useState<number | null>(null);
  const totals = points.map((p) => p.confirmed + p.estimate);
  const top = niceMax(Math.max(0, ...points.map((p) => Math.max(0, p.confirmed) + Math.max(0, p.estimate))));
  const bottom = -niceMax(-Math.min(0, ...points.map((p) => Math.min(0, p.confirmed) + Math.min(0, p.estimate))));
  const span = top - bottom || 1;
  const H = 160;
  const y = (v: number) => (v / span) * H;
  const zero = (top / span) * H;
  const hasEstimate = points.some((p) => p.estimate !== 0);
  const a = active != null ? points[active] : null;

  return (
    <figure className="flex flex-col gap-2" style={{ "--series-1": "#2a78d6" } as React.CSSProperties}>
      <figcaption className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold">{title}</span>
        {hasEstimate && (
          <span className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block size-3 rounded-sm bg-[var(--series-1)]" />
              確定
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block size-3 rounded-sm bg-[repeating-linear-gradient(45deg,var(--series-1)_0_2px,transparent_2px_5px)] ring-1 ring-[var(--series-1)]/50" />
              見込み
            </span>
          </span>
        )}
      </figcaption>
      <div className="relative flex gap-1 pl-14" style={{ height: H + 24 }} onPointerLeave={() => setActive(null)}>
        {/* 目盛り（0 と上下の端） */}
        {[top, top / 2, 0, bottom].filter((v, i, arr) => arr.indexOf(v) === i).map((v) => (
          <div key={v} className="pointer-events-none absolute right-0 left-14 border-t border-border" style={{ top: zero - y(v) }}>
            <span className="absolute -top-2.5 -left-14 w-13 text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums">{compact(v)}</span>
          </div>
        ))}
        {points.map((p, i) => {
          const pos = { c: Math.max(0, p.confirmed), e: Math.max(0, p.estimate) };
          const neg = { c: Math.min(0, p.confirmed), e: Math.min(0, p.estimate) };
          return (
            <button
              key={p.key}
              type="button"
              className="relative flex min-w-0 flex-1 flex-col items-center outline-none focus-visible:bg-accent"
              style={{ height: H + 24 }}
              aria-label={`${p.label} 合計${formatYen(totals[i])}（確定${formatYen(p.confirmed)}・見込み${formatYen(p.estimate)}）`}
              onPointerEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              onClick={() => setActive(i)}
            >
              <span className="relative w-full" style={{ height: H }}>
                {/* 上向き: 確定の上に見込み（2px のすき間） */}
                <span className="absolute left-1/2 flex w-[60%] max-w-6 -translate-x-1/2 flex-col-reverse gap-0.5" style={{ bottom: H - zero }}>
                  {pos.c > 0 && <span className="w-full rounded-t-[4px] bg-[var(--series-1)]" style={{ height: y(pos.c), borderTopLeftRadius: pos.e ? 0 : undefined, borderTopRightRadius: pos.e ? 0 : undefined }} />}
                  {pos.e > 0 && <span className="w-full rounded-t-[4px] bg-[repeating-linear-gradient(45deg,var(--series-1)_0_2px,transparent_2px_5px)] ring-1 ring-[var(--series-1)]/40 ring-inset" style={{ height: y(pos.e) }} />}
                </span>
                {/* 下向き（マイナス） */}
                <span className="absolute left-1/2 flex w-[60%] max-w-6 -translate-x-1/2 flex-col gap-0.5" style={{ top: zero }}>
                  {neg.c < 0 && <span className="w-full rounded-b-[4px] bg-[var(--series-1)]" style={{ height: y(-neg.c) }} />}
                  {neg.e < 0 && <span className="w-full rounded-b-[4px] bg-[repeating-linear-gradient(45deg,var(--series-1)_0_2px,transparent_2px_5px)] ring-1 ring-[var(--series-1)]/40 ring-inset" style={{ height: y(-neg.e) }} />}
                </span>
              </span>
              <span className={cn("mt-1 text-xs whitespace-nowrap", p.highlight ? "font-bold text-foreground" : "text-muted-foreground")}>{p.label}</span>
            </button>
          );
        })}
        {a && active != null && (
          <div
            role="status"
            className="pointer-events-none absolute top-0 z-10 w-max min-w-36 -translate-x-1/2 rounded-md border bg-background p-2 text-sm shadow-md"
            style={{ left: `calc(3.5rem + (100% - 3.5rem) * ${(active + 0.5) / points.length})` }}
          >
            <p className="font-bold">{a.label}</p>
            <p className="tabular-nums">
              <b>{formatYen(totals[active])}</b> 合計
            </p>
            {hasEstimate && (
              <p className="text-muted-foreground tabular-nums">
                確定 {formatYen(a.confirmed)}・見込み {formatYen(a.estimate)}
              </p>
            )}
          </div>
        )}
      </div>
      <details className="text-sm">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-primary">表で見る</summary>
        <table className="w-full text-right tabular-nums">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th scope="col" className="py-1 text-left font-medium">月</th>
              <th scope="col" className="py-1 font-medium">確定</th>
              <th scope="col" className="py-1 font-medium">見込み</th>
              <th scope="col" className="py-1 font-medium">合計</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p, i) => (
              <tr key={p.key} className={cn("border-b", p.highlight && "font-bold")}>
                <td className="py-1 text-left">{p.label}</td>
                <td className="py-1">{formatYen(p.confirmed)}</td>
                <td className="py-1">{formatYen(p.estimate)}</td>
                <td className="py-1">{formatYen(totals[i])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
