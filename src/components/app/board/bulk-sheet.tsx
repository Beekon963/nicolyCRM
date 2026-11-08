"use client";

import { AlertTriangleIcon, CheckIcon } from "lucide-react";
import { useState } from "react";
import { CompanyName } from "@/components/app/company-name";
import { StatusPill } from "@/components/app/status-pill";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type BoardStaffRow, isDropped } from "@/lib/board";
import {
  type BulkTarget,
  bulkTargets,
  type DaySelection,
} from "@/lib/board/select";
import { chipLabel } from "@/lib/board/short-name";
import type { BoardEventInfo, BoardStaffInfo } from "@/lib/data/board";
import { type DateString, formatShortJa } from "@/lib/date";
import { AVAILABILITY } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { venueStyle } from "@/lib/venue-colors";

/**
 * 選んだ何日かをまとめて（Phase 22-6）: 稼働可能日の ○△× を入れる、または同じ現場に打診・確定で入れる。
 * 保存は呼び出し元（稼働表の画面）が、今までの保存処理（setAvailabilityCells / assignFromBoard）で行う
 */
export function BulkSheet({
  selection,
  row,
  info,
  events,
  pending,
  onClose,
  onAvailability,
  onAssign,
}: {
  selection: DaySelection | null;
  row: BoardStaffRow | undefined;
  info: BoardStaffInfo | undefined;
  events: Record<string, BoardEventInfo>;
  pending: boolean;
  onClose: () => void;
  onAvailability: (status: "ok" | "maybe" | "ng" | null) => void;
  onAssign: (status: "offered" | "confirmed", target: BulkTarget) => void;
}) {
  const dates = selection?.dates ?? [];
  const targets = bulkTargets(events, dates);
  const [venueId, setVenueId] = useState<string | null>(null);
  const target =
    targets.find((t) => t.venueId === venueId) ??
    (targets.length === 1 ? targets[0] : undefined);
  const ngDays = row
    ? dates.filter((d) => row.cells[d]?.availability === "ng")
    : [];

  return (
    <Dialog open={!!selection && !!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        side="bottom"
        className="max-h-[85dvh] overflow-y-auto md:top-1/2 md:bottom-auto md:left-1/2 md:max-w-xl md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg"
      >
        {row && selection && (
          <>
            <DialogHeader>
              <DialogTitle>
                {row.name}・{dates.length}日をまとめて
              </DialogTitle>
              <DialogDescription>
                {dates.map(formatShortJa).join("、")}
              </DialogDescription>
            </DialogHeader>

            <section className="flex flex-col gap-2">
              <h3 className="font-bold">稼働可能日を入れる</h3>
              <div className="grid grid-cols-4 gap-2">
                {(["ok", "maybe", "ng", null] as const).map((v) => {
                  const a = AVAILABILITY[v ?? "none"];
                  return (
                    <Button
                      key={v ?? "none"}
                      type="button"
                      variant="outline"
                      disabled={pending}
                      onClick={() => onAvailability(v)}
                      className="h-auto min-h-12 flex-col gap-0 py-1"
                    >
                      <span className="text-lg font-bold">{a.mark}</span>
                      <span className="text-xs">{v ? a.label : "未入力"}</span>
                    </Button>
                  );
                })}
              </div>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="font-bold">同じ現場に入れる</h3>
              {targets.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  選んだ日に現場はありません。「現場」から現場を作ってください。
                </p>
              ) : (
                <ul
                  className="flex flex-col gap-2"
                  role="radiogroup"
                  aria-label="入れる現場"
                >
                  {targets.map((t) => {
                    const on = target?.venueId === t.venueId;
                    const n = Object.keys(t.events).length;
                    const already = dates.filter((d) =>
                      row.cells[d]?.assignments.some(
                        (a) => a.venueId === t.venueId && !isDropped(a.status),
                      ),
                    );
                    return (
                      <li key={t.venueId}>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => setVenueId(t.venueId)}
                          style={venueStyle(t.venueColor)}
                          className={cn(
                            "flex w-full items-start gap-3 rounded-xl border border-l-4 border-l-(--v-solid) p-3 text-left motion-safe:active:translate-y-px",
                            on
                              ? "border-primary bg-brand-50 ring-2 ring-primary/30"
                              : "hover:bg-accent",
                          )}
                        >
                          <span
                            className={cn(
                              "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border",
                              on
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-input",
                            )}
                          >
                            {on && (
                              <CheckIcon className="size-3.5" strokeWidth={3} />
                            )}
                          </span>
                          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="inline-flex h-6 shrink-0 items-center rounded-md bg-(--v-solid) px-1.5 text-xs font-bold whitespace-nowrap text-(--v-on)">
                                {chipLabel(t)}
                              </span>
                              <span className="min-w-0 truncate font-bold">
                                {t.venueName}
                              </span>
                            </span>
                            <span className="truncate text-sm text-muted-foreground">
                              <CompanyName name={t.clientName} />
                            </span>
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                              <span>
                                {n}日に現場あり
                                {t.missing.length > 0 && (
                                  <span className="text-muted-foreground">
                                    （{t.missing.map(formatShortJa).join("・")}{" "}
                                    はなし）
                                  </span>
                                )}
                              </span>
                              {t.shortage > 0 ? (
                                <StatusPill tone="alert">
                                  欠{t.shortage}
                                </StatusPill>
                              ) : (
                                <StatusPill tone="done">✓</StatusPill>
                              )}
                              {already.length > 0 && (
                                <span className="text-muted-foreground">
                                  {already.map(formatShortJa).join("・")}{" "}
                                  はすでに入っています
                                </span>
                              )}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {target && (
                <>
                  <Warnings
                    dates={dates}
                    ngDays={ngDays}
                    target={target}
                    info={info}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      disabled={pending}
                      onClick={() => onAssign("offered", target)}
                    >
                      打診する（LINE）
                    </Button>
                    <Button
                      disabled={pending}
                      onClick={() => onAssign("confirmed", target)}
                    >
                      確定にする
                    </Button>
                  </div>
                </>
              )}
            </section>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Warnings({
  dates,
  ngDays,
  target,
  info,
}: {
  dates: DateString[];
  ngDays: DateString[];
  target: BulkTarget;
  info: BoardStaffInfo | undefined;
}) {
  const list = [
    ngDays.length > 0 && `${ngDays.map(formatShortJa).join("・")} は × です`,
    info?.ngVenueIds.includes(target.venueId) && "この会場は NG です",
    target.missing.length > 0 &&
      target.missing.length < dates.length &&
      `現場のない日（${target.missing.map(formatShortJa).join("・")}）は飛ばします`,
  ].filter(Boolean) as string[];
  if (list.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-sm text-status-alert">
      {list.map((w) => (
        <li key={w} className="flex items-center gap-1">
          <AlertTriangleIcon className="size-4 shrink-0" />
          {w}
        </li>
      ))}
    </ul>
  );
}
