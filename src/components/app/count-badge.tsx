import { Badge } from "@/components/ui/badge";

/** メニューの横の「待っている件数」。締切を過ぎたものは赤、それ以外は黄（薄い地に濃い文字） */
export function CountBadge({ count, late, label }: { count: number; late: boolean; label: string }) {
  if (count <= 0) return null;
  return (
    <Badge tone={late ? "alert" : "waiting"} className="ml-auto min-w-7 justify-center tabular-nums" aria-label={`${label} ${count}件${late ? "（締切を過ぎています）" : ""}`}>
      {count}
    </Badge>
  );
}
