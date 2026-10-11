import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** 画面の見出し。back を渡すとスマホで「戻る」が出る */
export function PageHeader({
  title,
  description,
  back,
  actions,
  actionsBelow,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  back?: string;
  actions?: React.ReactNode;
  /** ボタンが多いとき、スマホではボタンを見出しの下の行に出す */
  actionsBelow?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-4 pb-2", className)}>
      {back && (
        <Link href={back} aria-label="戻る" className="-ml-2 grid size-11 place-items-center rounded-xl text-[#344054] hover:bg-accent">
          <ChevronLeftIcon className="size-6" />
        </Link>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="text-[22px] leading-8 font-bold break-words">{title}</h1>
        {description && <div className="mt-0.5 text-sm text-muted-foreground">{description}</div>}
      </div>
      {actions && <div className={cn("flex flex-wrap items-center gap-2", actionsBelow && "max-md:w-full")}>{actions}</div>}
    </div>
  );
}

/** 空の画面に「次にやること」を出す（要件 §9-6） */
export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mx-4 my-6 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-input bg-[#fcfcfd] px-6 py-8 text-center">
      <p className="text-[17px] font-bold">{title}</p>
      {children && <div className="text-sm text-muted-foreground">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
