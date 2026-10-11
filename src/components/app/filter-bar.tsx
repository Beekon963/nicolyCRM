"use client";

import { SearchIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

export type FilterOption = { value: string; label: string };
export type FilterDef = { name: string; label: string; options: FilterOption[]; allLabel?: string; defaultValue?: string };

/** 一覧の検索・絞り込み。選んだらすぐ反映（URL の検索条件に入る） */
export function FilterBar({
  filters,
  searchPlaceholder,
  basePath,
  className,
}: {
  filters: FilterDef[];
  searchPlaceholder?: string;
  basePath?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  function apply(name: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    start(() => router.replace(`${basePath ?? pathname}?${next.toString()}`));
  }

  return (
    // 置かれた幅で並べ方を変える（PC で一覧と詳細を左右に並べたときの細い一覧でも、2列できれいにそろう）
    <div className={cn("@container flex flex-col gap-2 px-4 pb-3", pending && "opacity-70", className)}>
      {searchPlaceholder && (
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            apply("q", String(new FormData(e.currentTarget).get("q") ?? "").trim());
          }}
        >
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" />
          <input
            name="q"
            type="search"
            defaultValue={params.get("q") ?? ""}
            placeholder={searchPlaceholder}
            aria-label="絞り込み検索"
            className="h-11 w-full rounded-xl border border-input bg-background pr-3 pl-10 text-base shadow-[0_1px_2px_rgb(16_24_40/0.05)] outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15"
          />
        </form>
      )}
      {filters.length > 0 && (
        <div className="grid grid-cols-2 gap-2 @2xl:flex @2xl:flex-wrap">
          {filters.map((f) => (
            <NativeSelect
              key={f.name}
              aria-label={f.label}
              className="@2xl:w-auto @2xl:min-w-32"
              value={params.get(f.name) ?? f.defaultValue ?? ""}
              onChange={(e) => apply(f.name, e.target.value)}
            >
              <option value="">{f.allLabel ?? `${f.label}: すべて`}</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          ))}
        </div>
      )}
    </div>
  );
}
