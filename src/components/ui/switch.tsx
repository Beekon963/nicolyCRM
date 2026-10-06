"use client";

import { Switch as SwitchPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 border-transparent bg-input transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-50 data-[state=checked]:bg-primary",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-6 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-5" />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
