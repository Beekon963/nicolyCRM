import { ExternalLinkIcon, PencilIcon, PhoneIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Field, ListDetail, Section } from "@/components/app/list-detail";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireMember } from "@/lib/auth";
import { formatShortJa, todayJst } from "@/lib/date";
import { getCompanyDetail, listCompanies, needsNextAction } from "@/lib/data/companies";
import { getMasters } from "@/lib/data/masters";
import { COMPANY_KIND, COMPANY_STATUS, EVENT_STATUS, PRIORITY } from "@/lib/labels";
import { pickParams } from "@/lib/params";
import { CompanyList } from "../company-list";
import { ContactsSection, ItemsSection, LinksSection } from "./company-sections";

export default async function CompanyDetailPage({ params, searchParams }: PageProps<"/sales/[id]">) {
  await requireMember();
  const { id } = await params;
  const filters = pickParams(await searchParams, ["kind", "q", "status", "inactive"]);
  const detail = await getCompanyDetail(id);
  if (!detail) notFound();
  const { company, contacts, links, itemIds, events } = detail;
  const kind = company.kind;
  const query = new URLSearchParams({ ...filters, kind }).toString();
  const [companies, masters] = await Promise.all([listCompanies({ ...filters, kind }), getMasters()]);
  const today = todayJst();
  const missing = needsNextAction(company.status) && (!company.next_action_date || !company.next_action);

  return (
    <ListDetail
      list={<CompanyList companies={companies} kind={kind} query={query} today={today} selectedId={id} />}
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
              <p className={company.next_action_date <= today ? "font-bold text-status-alert" : ""}>
                {formatShortJa(company.next_action_date)} {company.next_action}
              </p>
            ) : (
              <p className={missing ? "text-status-alert" : "text-muted-foreground"}>{missing ? "未設定です。編集から入力してください。" : "なし"}</p>
            )}
            <p className="mt-2 text-sm text-muted-foreground">活動の記録（架電・商談など）は Phase 2 で追加します。</p>
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
