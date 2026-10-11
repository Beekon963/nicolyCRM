import * as React from "react";
import { cn } from "@/lib/utils";

/** 右端の下向きの矢印（端末ごとに形がちがう標準の矢印の代わり） */
const CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%23667085' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m4 6 4 4 4-4'/%3E%3C/svg%3E\")";

/** スマホでは端末標準の選択画面が出るので、選択肢の少ない項目はこれを使う */
function NativeSelect({ className, style, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "h-11 w-full appearance-none truncate rounded-xl border border-input bg-background bg-no-repeat pr-9 pl-3 text-base shadow-[0_1px_2px_rgb(16_24_40/0.05)] outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 disabled:opacity-50",
        className,
      )}
      style={{ backgroundImage: CHEVRON, backgroundPosition: "right 0.75rem center", backgroundSize: "16px", ...style }}
      {...props}
    />
  );
}

export { NativeSelect };
