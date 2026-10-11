import { cn } from "@/lib/utils";

/**
 * 画面を開いている途中に出す「骨組み」（Phase 7）。押してすぐ何かが出るので、二度押しや「固まった？」を防ぐ。
 * 形は出来上がりの画面に近づける（見出し・カードの並び・表）。動きを減らす設定の人には点滅させない
 */
function Bone({ className }: { className?: string }) {
  return <div className={cn("rounded-lg bg-muted motion-safe:animate-pulse", className)} />;
}

function Status({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col">
      <span className="sr-only">読み込み中</span>
      {children}
    </div>
  );
}

function Header({ actions }: { actions?: boolean }) {
  return (
    <div className="flex items-center gap-3 px-4 pt-4 pb-2">
      <div className="flex flex-1 flex-col gap-2">
        <Bone className="h-7 w-40" />
        <Bone className="h-4 w-56 max-w-full" />
      </div>
      {actions && <Bone className="h-11 w-24 rounded-xl" />}
    </div>
  );
}

/** 一覧の画面（現場・スタッフ・営業・会場など） */
export function ListSkeleton({ rows = 7, filters = true }: { rows?: number; filters?: boolean }) {
  return (
    <Status>
      <Header actions />
      {filters && (
        <div className="flex flex-col gap-2 px-4 pb-3">
          <Bone className="h-11 w-full rounded-xl" />
          <div className="flex gap-2">
            <Bone className="h-11 w-32 rounded-xl" />
            <Bone className="h-11 w-28 rounded-xl" />
          </div>
        </div>
      )}
      <div className="mx-4 flex flex-col divide-y rounded-xl border bg-card">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex min-h-16 items-center gap-3 px-4 py-3">
            <Bone className="size-10 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Bone className={cn("h-4", i % 3 === 0 ? "w-2/5" : i % 3 === 1 ? "w-1/2" : "w-1/3")} />
              <Bone className="h-3 w-3/5" />
            </div>
          </div>
        ))}
      </div>
    </Status>
  );
}

/** カードが並ぶ画面（ホーム・詳細・お金・設定など） */
export function CardsSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <Status>
      <Header />
      <div className="grid gap-4 px-4 pb-8 lg:grid-cols-2">
        {Array.from({ length: cards }, (_, i) => (
          <div key={i} className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-card">
            <Bone className="h-5 w-32" />
            <Bone className="h-3 w-full" />
            <Bone className="h-3 w-4/5" />
            <Bone className="h-3 w-3/5" />
          </div>
        ))}
      </div>
    </Status>
  );
}

/** 稼働表（表の形） */
export function BoardSkeleton() {
  return (
    <Status>
      <Header actions />
      <div className="flex flex-col gap-2 px-4 pb-3">
        <Bone className="h-11 w-full rounded-xl" />
        <Bone className="h-10 w-full" />
      </div>
      <div className="mx-4 overflow-hidden rounded-xl border bg-card">
        {Array.from({ length: 9 }, (_, r) => (
          <div key={r} className="flex gap-1 border-b p-1.5 last:border-b-0">
            <Bone className="h-9 w-24 shrink-0" />
            {Array.from({ length: 8 }, (_, c) => (
              <Bone key={c} className={cn("h-9 w-28 shrink-0", (r + c) % 4 === 0 && "opacity-40")} />
            ))}
          </div>
        ))}
      </div>
    </Status>
  );
}

/** マイページ（スマホ1画面） */
export function MypageSkeleton() {
  return (
    <Status>
      <Bone className="mb-4 h-7 w-44" />
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-card">
            <Bone className="h-5 w-40" />
            <Bone className="h-3 w-4/5" />
            <Bone className="h-12 w-full rounded-xl" />
          </div>
        ))}
      </div>
    </Status>
  );
}
