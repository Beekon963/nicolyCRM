import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

// タップ領域は 44px 以上（要件 §9-9）
// ゲームのボタンのように、下に濃い縁を付けて少し浮かせ、押すと沈む（Phase 6。動きを減らす設定の人には沈む動きを出さない）
const PRESS = "border-b-4 motion-safe:active:translate-y-0.5 active:border-b-2";
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl text-base font-bold transition-[color,background-color,transform] outline-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        default: `${PRESS} border-black/25 bg-primary text-primary-foreground hover:bg-primary/90`,
        secondary: `${PRESS} border-black/10 bg-secondary text-secondary-foreground hover:bg-secondary/80`,
        outline: `${PRESS} border-2 border-input bg-background hover:bg-accent`,
        ghost: "hover:bg-accent",
        destructive: `${PRESS} border-black/25 bg-destructive text-white hover:bg-destructive/90`,
        link: "text-primary underline-offset-4 hover:underline",
        line: `${PRESS} border-black/20 bg-[#06C755] text-white hover:bg-[#06C755]/90`,
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
