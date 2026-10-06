import { cn } from "@/lib/utils";

/**
 * 一覧＋詳細（要件 §5）。
 * - PC: 左に一覧、右に詳細。一覧に戻らずに次々確認できる
 * - スマホ: 詳細を開いているときは詳細だけ
 */
export function ListDetail({ list, detail }: { list: React.ReactNode; detail?: React.ReactNode }) {
  if (!detail) return <div className="flex flex-col">{list}</div>;
  return (
    <div className="md:grid md:h-[calc(100dvh-61px)] md:grid-cols-[minmax(300px,380px)_1fr]">
      <section className="hidden min-w-0 overflow-y-auto border-r md:block">{list}</section>
      <section className="min-w-0 md:overflow-y-auto">{detail}</section>
    </div>
  );
}

/** 詳細の中の区切り */
export function Section({
  title,
  actions,
  children,
  className,
}: {
  title: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mx-4 mb-4 rounded-lg border", className)}>
      <div className="flex min-h-12 items-center justify-between gap-2 border-b px-4 py-2">
        <h2 className="font-bold">{title}</h2>
        {actions && <div className="flex items-center gap-1">{actions}</div>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** 「項目名: 値」の並び */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 py-1.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children || <span className="text-muted-foreground">−</span>}</dd>
    </div>
  );
}
