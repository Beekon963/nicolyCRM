"use client";

import { ShareButtons } from "@/components/app/share-buttons";

/** できあがった日報の文章と「LINEで送る」「コピー」 */
export function ReportText({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-bold text-muted-foreground">{title}</p>
      <pre className="rounded-md bg-[#8cabd8]/20 p-3 font-sans text-base break-words whitespace-pre-wrap">{text}</pre>
      <ShareButtons text={text} size="sm" />
    </div>
  );
}
