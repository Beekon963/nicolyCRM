import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

// タップ領域は 44px 以上（要件 §9-9）
// ボタンの下にうっすら縁（内側の影）を付けて、押せるものだと分かるようにし、押すと少し沈む（Phase 6・7）。
// 縁は内側の影なので大きさは変わらない。動きを減らす設定の人には沈む動きを出さない
const RAISED = "shadow-[inset_0_-2px_0_rgb(0_0_0/0.18),0_1px_2px_rgb(16_24_40/0.08)] active:shadow-[inset_0_-1px_0_rgb(0_0_0/0.18)] motion-safe:active:translate-y-px";
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl text-base font-semibold transition-[color,background-color,box-shadow,transform] duration-150 outline-none focus-visible:ring-4 focus-visible:ring-ring/25 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        default: `${RAISED} bg-primary text-primary-foreground hover:bg-brand-700`,
        secondary: "bg-secondary text-secondary-foreground hover:bg-[#e8ebf0] motion-safe:active:translate-y-px",
        outline:
          "border border-input bg-background text-[#344054] shadow-[inset_0_-2px_0_rgb(16_24_40/0.06),0_1px_2px_rgb(16_24_40/0.05)] hover:bg-accent active:shadow-none motion-safe:active:translate-y-px",
        ghost: "text-[#344054] hover:bg-accent",
        destructive: `${RAISED} bg-destructive text-white hover:bg-status-alert-edge`,
        link: "text-primary underline-offset-4 hover:underline",
        line: `${RAISED} bg-[#06C755] text-white hover:bg-[#05b34c]`,
      },
      size: {
        default: "h-11 px-4",
        sm: "h-11 px-3 text-sm",
        lg: "h-12 px-6 text-lg",
        icon: "size-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
