import { PageHeader } from "@/components/app/page-header";
import { aiConfigured } from "@/lib/ai/config";
import { requireOwner } from "@/lib/auth";
import { getExpenseChoices, getPayers } from "@/lib/data/company-expenses";
import { todayJst } from "@/lib/date";
import { ExpenseForm } from "../expense-form";

export const metadata = { title: "経費を入れる | NICOLY CRM" };

/** ★ 会社の経費を入れる（Phase 16。オーナーだけ）。日付は今日、払った人は自分が最初から入っている */
export default async function NewCompanyExpensePage() {
  const me = await requireOwner();
  const [payers, choices] = await Promise.all([getPayers(), getExpenseChoices()]);
  return (
    <>
      <PageHeader title="経費を入れる" description="レシートを撮ると、AI が読み取ります" back="/company-expenses" />
      <ExpenseForm
        initial={{ paidBy: me.id, spentOn: todayJst(), vendor: "", item: "", purpose: "", category: "", amount: "", attendees: "", memo: "" }}
        payers={payers.filter((p) => p.owner && p.active)}
        categories={choices.categories}
        vendors={choices.vendors}
        aiReady={aiConfigured()}
      />
    </>
  );
}
