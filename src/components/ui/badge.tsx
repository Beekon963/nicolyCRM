import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

// 色で状態が分かる: 赤 = 要対応 / 黄 = 待ち / 緑 = 完了 / 灰 = 対象外（要件 §9-5）
const badgeVariants = cva(
  "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-sm font-medium",
  {
    variants: {
      tone: {
        alert: "border-status-alert/30 bg-status-alert-bg text-status-alert",
        waiting: "border-status-waiting/30 bg-status-waiting-bg text-status-waiting",
        done: "border-status-done/30 bg-status-done-bg text-status-done",
        muted: "border-border bg-muted text-muted-foreground",
        brand: "border-primary/30 bg-primary/5 text-primary",
      },
    },
    defaultVariants: { tone: "muted" },
  },
);

function Badge({ className, tone, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export { Badge, badgeVariants };
export type Tone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;
