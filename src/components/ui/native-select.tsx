import * as React from "react";
import { cn } from "@/lib/utils";

/** スマホでは端末標準の選択画面が出るので、選択肢の少ない項目はこれを使う */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "h-11 w-full rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { NativeSelect };
