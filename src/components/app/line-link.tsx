"use client";

import { CheckCircle2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { LineIcon } from "./share-buttons";

export type LineLinkStart = { ok: true; code: string; addFriendUrl: string; sendCodeUrl: string } | { ok: false; message: string };

/**
 * 自分の LINE と CRM をつなぐ（Phase 5）。マイページ（スタッフ）と「LINE の通知」（オーナー・管理者）で使う。
 * ① 公式アカウントを友だち追加 → ② コードを送る → ③ 確かめる
 */
export function LineLink({
  linked,
  botName,
  what,
  start,
  unlink,
}: {
  linked: boolean;
  botName: string;
  /** 届くお知らせの説明 */
  what: string;
  start: () => Promise<LineLinkStart>;
  unlink: () => Promise<{ ok: boolean; message?: string }>;
}) {
  const router = useRouter();
  const [steps, setSteps] = useState<Extract<LineLinkStart, { ok: true }> | null>(null);
  const [pending, run] = useTransition();

  if (linked)
    return (
      <div className="flex flex-col gap-2">
        <p className="flex items-center gap-2 font-bold text-status-done">
          <CheckCircle2Icon className="size-5" />
          LINE とつながっています
        </p>
        <p className="text-muted-foreground">{what}</p>
        <Button
          variant="ghost"
          size="sm"
          className="self-start text-muted-foreground"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const r = await unlink();
              if (!r.ok) return void toast.error(r.message ?? "できませんでした");
              toast.success("LINE とのつながりを外しました（もう一度つなげます）");
              setSteps(null);
              router.refresh();
            })
          }
        >
          つなぐのをやめる
        </Button>
      </div>
    );

  if (!steps)
    return (
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground">LINE とつなぐと、{what}</p>
        <p className="text-sm text-muted-foreground">お知らせは、公式アカウント「{botName}」から届きます。</p>
        <Button
          variant="line"
          size="lg"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const r = await start();
              if (!r.ok) return void toast.error(r.message);
              setSteps(r);
            })
          }
        >
          <LineIcon />
          LINE とつなぐ
        </Button>
      </div>
    );

  return (
    <ol className="flex flex-col gap-3">
      <li className="flex flex-col gap-1">
        <span className="font-bold">① 公式アカウントを友だち追加する</span>
        <Button asChild variant="line">
          <a href={steps.addFriendUrl} target="_blank" rel="noreferrer">
            <LineIcon />「{botName}」を友だち追加
          </a>
        </Button>
        <span className="text-sm text-muted-foreground">もう友だちなら、次へ進んでください。</span>
      </li>
      <li className="flex flex-col gap-1">
        <span className="font-bold">② コードを送る</span>
        <Button asChild variant="line">
          <a href={steps.sendCodeUrl} target="_blank" rel="noreferrer">
            <LineIcon />
            コードを送る（LINE が開きます）
          </a>
        </Button>
        <span className="text-sm text-muted-foreground">
          LINE が開いたら、そのまま「送信」を押してください。開かないときは、公式アカウントのトークにこのコードを送ってください:{" "}
          <b className="font-mono text-base tracking-widest text-foreground" data-testid="line-code">
            {steps.code}
          </b>
          （30分有効）
        </span>
      </li>
      <li className="flex flex-col gap-1">
        <span className="font-bold">③ 確かめる</span>
        <Button variant="outline" onClick={() => router.refresh()}>
          送ったので確かめる
        </Button>
        <span className="text-sm text-muted-foreground">LINE に「つながりました」と届いていれば完了です。</span>
      </li>
    </ol>
  );
}
