import { ExternalLinkIcon, PencilIcon, PhoneIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Field, ListDetail, Section } from "@/components/app/list-detail";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireMember } from "@/lib/auth";
import { RecordActivityButton } from "@/components/app/activity-sheet";
import { formatShortJa, formatTimeJst, toJstDateString, todayJst } from "@/lib/date";
import { COMPANY_FILTER_KEYS, getCompanyDetail, listActiveUsers, listCompanies } from "@/lib/data/companies";
import { getMasters } from "@/lib/data/masters";
import { ACTIVITY_KIND, ACTIVITY_RESULT, COMPANY_KIND, COMPANY_STATUS, EVENT_STATUS, PRIORITY } from "@/lib/labels";
import { isNextActionMissing } from "@/lib/sales";
import { pickParams } from "@/lib/params";
import { CompanyList } from "../company-list";
import { ContactsSection, ItemsSection, LinksSection } from "./company-sections";

export default async function CompanyDetailPage({ params, searchParams }: PageProps<"/sales/[id]">) {
  const user = await requireMember();
  const { id } = await params;
  // 詳細を開いている間、左の一覧はリスト表示（カンバンは一覧の画面だけ）
  const filters = pickParams(await searchParams, COMPANY_FILTER_KEYS.filter((k) => k !== "view"));
  const detail = await getCompanyDetail(id);
  if (!detail) notFound();
  const { company, contacts, links, itemIds, events, activities } = detail;
  const kind = company.kind;
  const query = new URLSearchParams({ ...filters, kind }).toString();
  const [companies, masters, users] = await Promise.all([listCompanies({ ...filters, kind }, user.id), getMasters(), listActiveUsers()]);
  const today = todayJst();
  const missing = isNextActionMissing(company);
  const recordTarget = {
    id: company.id,
    name: company.name,
    status: company.status,
    next_action_date: company.next_action_date,
    next_action: company.next_action,
    contacts: contacts.filter((c) => c.is_active).map((c) => ({ id: c.id, name: c.name })),
  };

  return (
    <ListDetail
      list={<CompanyList companies={companies} kind={kind} users={users} query={query} today={today} selectedId={id} />}
      detail={
        <div className="pb-8">
          <PageHeader
            back={`/sales?${query}`}
            title={company.name}
            description={
              <span className="flex flex-wrap items-center gap-2">
                {COMPANY_KIND[kind]}
                <Badge tone={COMPANY_STATUS[company.status].tone}>{COMPANY_STATUS[company.status].label}</Badge>
                {!company.is_active && <Badge tone="muted">非表示</Badge>}
              </span>
            }
            actions={
              <Button asChild variant="outline" size="sm">
                <Link href={`/sales/${id}/edit`}>
                  <PencilIcon />
                  編集
                </Link>
              </Button>
            }
          />
          <Section title="次回アクション" className={missing ? "border-status-alert/40" : undefined}>
            {company.next_action_date ? (
              <p className={company.next_action_date < today ? "font-bold text-status-alert" : company.next_action_date === today ? "font-bold" : ""}>
                {company.next_action_date < today ? "期限切れ " : company.next_action_date === today ? "今日 " : ""}
                {formatShortJa(company.next_action_date)} {company.next_action}
              </p>
            ) : (
              <p className={missing ? "font-bold text-status-alert" : "text-muted-foreground"}>{missing ? "未設定です。記録するときに次回アクション日を選んでください。" : "なし"}</p>
            )}
            <RecordActivityButton company={recordTarget} className="mt-3 w-full sm:w-auto" />
          </Section>
          <Section title={`活動履歴${activities.length ? `（${activities.length >= 50 ? "直近50件" : `${activities.length}件`}）` : ""}`}>
            {activities.length === 0 ? (
              <p className="text-sm text-muted-foreground">まだ記録はありません。電話やメールのあとに「記録する」を押すと、ここに残ります。</p>
            ) : (
              <ol className="flex flex-col">
                {activities.map((a) => {
                  const at = new Date(a.occurred_at);
                  return (
                    <li key={a.id} className="border-l-2 border-border py-2 pl-3">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-sm text-muted-foreground">
                          {formatShortJa(toJstDateString(at))} {formatTimeJst(at)}
                        </span>
                        <span className="font-medium">{ACTIVITY_KIND[a.kind]}</span>
                        {a.result && <Badge tone={ACTIVITY_RESULT[a.result].tone}>{ACTIVITY_RESULT[a.result].label}</Badge>}
                        {a.status && <span className="text-sm">→ {COMPANY_STATUS[a.status].label}</span>}
                      </p>
                      {a.memo && <p className="whitespace-pre-wrap break-words">{a.memo}</p>}
                      <p className="text-sm text-muted-foreground">
                        {[a.user?.name, a.contact?.name && `先方: ${a.contact.name}`, a.next_action_date && `次回 ${formatShortJa(a.next_action_date)} ${a.next_action}`]
                          .filter(Boolean)
                          .join(" ／ ")}
                      </p>
                    </li>
                  );
                })}
              </ol>
            )}
          </Section>
          <Section title="基本情報">
            <dl>
              <Field label="電話">
                {company.phone && (
                  <a href={`tel:${company.phone.replace(/[^0-9+]/g, "")}`} className="inline-flex items-center gap-1 text-primary">
                    <PhoneIcon className="size-4" />
                    {company.phone}
                  </a>
                )}
              </Field>
              <Field label="住所">{company.address}</Field>
              <Field label="Web">
                {company.website && (
                  <a href={company.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary">
                    {company.website}
                    <ExternalLinkIcon className="size-4" />
                  </a>
                )}
              </Field>
              <Field label="優先度">{PRIORITY[company.priority]}</Field>
              <Field label="担当者">{company.owner?.name}</Field>
              <Field label="メモ">{company.memo && <span className="whitespace-pre-wrap">{company.memo}</span>}</Field>
            </dl>
          </Section>
          <Section title="先方の担当者">
            <ContactsSection companyId={id} contacts={contacts} />
          </Section>
          {kind === "client" && (
            <Section title="使う獲得項目">
              <ItemsSection companyId={id} items={masters.items.filter((i) => i.is_active)} selected={itemIds} />
            </Section>
          )}
          {kind === "client" && (
            <Section title="関連する現場（直近30件）">
              {events.length === 0 ? (
                <p className="text-sm text-muted-foreground">まだ現場はありません</p>
              ) : (
                <ul className="divide-y">
                  {events.map((e) => (
                    <li key={e.id!}>
                      <Link href={`/events/${e.id}`} className="flex items-center gap-3 py-2 hover:bg-accent">
                        <span className="w-20 shrink-0 text-sm font-medium">{formatShortJa(e.date!)}</span>
                        <span className="min-w-0 flex-1 truncate">{e.venue?.name}</span>
                        <span className="text-sm text-muted-foreground">
                          {e.confirmed_total}/{e.required_total}人
                        </span>
                        <Badge tone={EVENT_STATUS[e.status!]?.tone}>{EVENT_STATUS[e.status!]?.label}</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}
          <Section title="関連資料のリンク">
            <LinksSection companyId={id} links={links} />
          </Section>
        </div>
      }
    />
  );
}
