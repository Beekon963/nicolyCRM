"use client";

import { CheckCircle2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { Proposal, ProposalUndo } from "@/lib/ai/proposals";
import { cn } from "@/lib/utils";

/** 確認カードの状態（AI アシスタントと「LINE の文を貼るだけ」で共通） */
export type CardState = Proposal & { state: "open" | "running" | "done" | "cancelled" | "undone"; message?: string; undo?: ProposalUndo };

/**
 * 登録の確認カード。「登録する」を押すまで何も登録しない（AI や読み取りが直接書き込むことはない）。
 * 登録したあとは「元に戻す」が出るものもある（営業の記録・打診）。
 */
export function ProposalCard({ card, onRun, onCancel, onUndo }: { card: CardState; onRun: (c: CardState) => Promise<void>; onCancel: (c: CardState) => void; onUndo: (c: CardState) => Promise<void> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<void>) =>
    start(async () => {
      await fn();
      router.refresh();
    });
  return (
    <div className={cn("flex flex-col gap-3 rounded-lg border p-3", card.state === "open" || card.state === "running" ? "border-primary/50" : "bg-muted/40")} data-testid="ai-card">
      <p className="font-bold">{card.title}</p>
      <ul className="flex flex-col gap-2">
        {card.rows.map((r, i) => (
          <li key={i} className={cn("flex flex-col", r.skip && "text-muted-foreground line-through decoration-1")}>
            <span className="text-sm text-muted-foreground no-underline">{r.label}</span>
            <span className="break-words">{r.detail}</span>
            {r.skip && <span className="text-sm text-status-waiting no-underline">入れません: {r.skip}</span>}
          </li>
        ))}
      </ul>
      {card.warnings.length > 0 && (
        <ul className="rounded-md bg-status-waiting-bg p-2 text-sm text-status-waiting">
          {card.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      {card.state === "open" || card.state === "running" ? (
        <div className="flex gap-2">
          <Button disabled={pending || card.state === "running"} onClick={() => run(() => onRun(card))}>
            {card.state === "running" ? "登録しています…" : "登録する"}
          </Button>
          <Button variant="ghost" disabled={pending || card.state === "running"} onClick={() => onCancel(card)}>
            やめる
          </Button>
        </div>
      ) : card.state === "done" ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex items-center gap-1 text-status-done">
            <CheckCircle2Icon className="size-5 shrink-0" />
            {card.message ?? "登録しました"}
          </p>
          {card.undo && (
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => onUndo(card))}>
              元に戻す
            </Button>
          )}
        </div>
      ) : (
        <p className="text-muted-foreground">{card.state === "undone" ? (card.message ?? "元に戻しました") : "やめました"}</p>
      )}
    </div>
  );
}
