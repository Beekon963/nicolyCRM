import { memoValueTone, parseStaffMemo } from "@/lib/staff-memo";
import { cn } from "@/lib/utils";

/**
 * スタッフのメモ。備考などの文章は上に、取り込んだ「列名: 値」（キャッチ力・知識・誓約書など）は
 * まとまりごとの表にして出す（1行に詰めたままだと読みにくいため）
 */
export function StaffMemo({ memo }: { memo: string | null | undefined }) {
  const { notes, groups } = parseStaffMemo(memo);
  if (!notes.length && !groups.length) {
    return <p className="text-sm text-muted-foreground">メモはありません。「編集」から入れられます。</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {notes.length > 0 && (
        <div className="flex flex-col gap-1 rounded-md bg-muted/60 p-3">
          {notes.map((n, i) => (
            <p key={i} className="break-words whitespace-pre-wrap">
              {n}
            </p>
          ))}
        </div>
      )}
      {groups.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {groups.map((g) => (
            <section key={g.title} aria-label={g.title} className="min-w-0">
              <h3 className="mb-1 border-b pb-1 text-sm font-bold text-muted-foreground">{g.title}</h3>
              <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-1">
                {g.items.map((it, i) => {
                  const tone = memoValueTone(it.value);
                  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(it.value);
                  // 「人柄・強み: …」のように見出しと同じ項目名は、名前を出さずに文章だけ
                  const same = it.label === g.title;
                  return (
                    <div key={`${it.label}-${i}`} className="contents">
                      <dt className={cn("text-sm text-muted-foreground", same && "sr-only")}>{it.label}</dt>
                      <dd
                        className={cn(
                          "min-w-0 break-words whitespace-pre-wrap",
                          same && "col-span-2",
                          tone === "good" && "font-medium text-status-done",
                          tone === "waiting" && "font-medium text-status-waiting",
                          tone === "muted" && "text-muted-foreground",
                        )}
                      >
                        {email ? (
                          <a href={`mailto:${it.value}`} className="text-primary underline-offset-2 hover:underline">
                            {it.value}
                          </a>
                        ) : (
                          it.value
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
