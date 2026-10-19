import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { aiConfigured } from "@/lib/ai/config";
import { getCompanyExpense, getExpenseChoices, getPayers, receiptLink } from "@/lib/data/company-expenses";
import { monthOf } from "@/lib/date";
import { ExpenseForm } from "../expense-form";

export const metadata = { title: "経費を直す | NICOLY CRM" };

/** ★ 会社の経費を直す・取り消す（Phase 16。オーナーだけ） */
export default async function CompanyExpensePage({ params }: PageProps<"/company-expenses/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const e = await getCompanyExpense(id);
  if (!e || e.voided) notFound();
  const [payers, choices, src] = await Promise.all([getPayers(), getExpenseChoices(), receiptLink(e.receiptPath)]);
  return (
    <>
      <PageHeader title="経費を直す" back={`/company-expenses?month=${monthOf(e.spentOn)}`} />
      <ExpenseForm
        initial={{
          id: e.id,
          paidBy: e.paidBy,
          spentOn: e.spentOn,
          vendor: e.vendor,
          item: e.item,
          purpose: e.purpose,
          category: e.category,
          amount: e.amount.toLocaleString("ja-JP"),
          attendees: e.attendees,
          memo: e.memo,
        }}
        // オーナーに加えて、この経費の今の払った人（無効にした人など）も出す
        payers={payers.filter((p) => (p.owner && p.active) || p.id === e.paidBy)}
        categories={choices.categories}
        vendors={choices.vendors}
        aiReady={aiConfigured()}
        receipt={{ src, url: e.receiptUrl }}
      />
    </>
  );
}
