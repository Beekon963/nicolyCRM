import { GraduationCapIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { AcademyBadge } from "@/lib/academy";
import { ACADEMY_DECISION } from "@/lib/labels";
import { cn } from "@/lib/utils";

/**
 * NICOLY アカデミーの札（Phase 14）: 帽子の印 ＋ 称号・稼働判断。色は稼働判断（稼働可 = 緑・保留 = 黄・未判定 = 灰）。
 * 候補の「○ 稼働できる」（その日に稼働できるか）とまぎれないよう、帽子の印と称号をいっしょに出す。
 * 称号が長いときは札の中で折り返す（はみ出さないように）
 */
export function AcademyPill({ badge, className }: { badge: AcademyBadge; className?: string }) {
  const d = ACADEMY_DECISION[badge.decision];
  return (
    <Badge tone={d.tone} className={cn("min-w-0 shrink whitespace-normal", className)}>
      <GraduationCapIcon aria-hidden className="size-4 shrink-0" />
      <span className="sr-only">アカデミー:</span>
      <span className="min-w-0 break-words">
        {badge.title || "称号なし"}・{d.label}
      </span>
    </Badge>
  );
}
