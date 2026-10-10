
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "activities": {
                  Row: {
                    "company_id": string,"contact_id": string | null,"created_at": string,"id": string,"kind": Database["public"]['Enums']["activity_kind"],"memo": string,"next_action": string,"next_action_date": string | null,"occurred_at": string,"result": Database["public"]['Enums']["activity_result"] | null,"status": Database["public"]['Enums']["company_status"] | null,"user_id": string | null
                  }
                  Insert: {
                    "company_id": string,"contact_id"?: string | null,"created_at"?: string,"id"?: string,"kind": Database["public"]['Enums']["activity_kind"],"memo"?: string,"next_action"?: string,"next_action_date"?: string | null,"occurred_at"?: string,"result"?: Database["public"]['Enums']["activity_result"] | null,"status"?: Database["public"]['Enums']["company_status"] | null,"user_id"?: string | null
                  }
                  Update: {
                    "company_id"?: string,"contact_id"?: string | null,"created_at"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["activity_kind"],"memo"?: string,"next_action"?: string,"next_action_date"?: string | null,"occurred_at"?: string,"result"?: Database["public"]['Enums']["activity_result"] | null,"status"?: Database["public"]['Enums']["company_status"] | null,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "activities_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activities_contact_id_fkey"
      columns: ["contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activities_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "app_users"
      referencedColumns: ["id"]
    }
                  ]
                },"app_users": {
                  Row: {
                    "created_at": string,"email": string,"id": string,"is_active": boolean,"name": string,"role": Database["public"]['Enums']["user_role"],"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"email": string,"id": string,"is_active"?: boolean,"name": string,"role"?: Database["public"]['Enums']["user_role"],"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"email"?: string,"id"?: string,"is_active"?: boolean,"name"?: string,"role"?: Database["public"]['Enums']["user_role"],"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"areas": {
                  Row: {
                    "created_at": string,"id": string,"is_active": boolean,"name": string,"sort_order": number
                  }
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"name": string,"sort_order"?: number
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"name"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    
                  ]
                },"assignment_private": {
                  Row: {
                    "assignment_id": string,"daily_rate_override": number | null
                  }
                  Insert: {
                    "assignment_id": string,"daily_rate_override"?: number | null
                  }
                  Update: {
                    "assignment_id"?: string,"daily_rate_override"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "assignment_private_assignment_id_fkey"
      columns: ["assignment_id"]
isOneToOne: true
      referencedRelation: "assignments"
      referencedColumns: ["id"]
    }
                  ]
                },"assignments": {
                  Row: {
                    "cancel_reason": string,"cancel_reason_code": string | null,"confirm_notice_sent_at": string | null,"created_at": string,"created_by": string | null,"event_id": string,"id": string,"offered_at": string,"reminder_sent_at": string | null,"responded_at": string | null,"response_source": Database["public"]['Enums']["input_source"] | null,"role_id": string,"staff_id": string,"status": Database["public"]['Enums']["assignment_status"],"updated_at": string
                  }
                  Insert: {
                    "cancel_reason"?: string,"cancel_reason_code"?: string | null,"confirm_notice_sent_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"event_id": string,"id"?: string,"offered_at"?: string,"reminder_sent_at"?: string | null,"responded_at"?: string | null,"response_source"?: Database["public"]['Enums']["input_source"] | null,"role_id": string,"staff_id": string,"status"?: Database["public"]['Enums']["assignment_status"],"updated_at"?: string
                  }
                  Update: {
                    "cancel_reason"?: string,"cancel_reason_code"?: string | null,"confirm_notice_sent_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"event_id"?: string,"id"?: string,"offered_at"?: string,"reminder_sent_at"?: string | null,"responded_at"?: string | null,"response_source"?: Database["public"]['Enums']["input_source"] | null,"role_id"?: string,"staff_id"?: string,"status"?: Database["public"]['Enums']["assignment_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "assignments_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "event_overview"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "assignments_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "assignments_role_id_fkey"
      columns: ["role_id"]
isOneToOne: false
      referencedRelation: "roles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "assignments_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_logs": {
                  Row: {
                    "action": string,"after": Json | null,"before": Json | null,"changed_fields": (string)[] | null,"created_at": string,"id": number,"row_id": string,"staff_id": string | null,"table_name": string,"user_id": string | null
                  }
                  Insert: {
                    "action": string,"after"?: Json | null,"before"?: Json | null,"changed_fields"?: (string)[] | null,"created_at"?: string,"id"?: never,"row_id": string,"staff_id"?: string | null,"table_name": string,"user_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"after"?: Json | null,"before"?: Json | null,"changed_fields"?: (string)[] | null,"created_at"?: string,"id"?: never,"row_id"?: string,"staff_id"?: string | null,"table_name"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"availability": {
                  Row: {
                    "date": string,"source": Database["public"]['Enums']["input_source"],"staff_id": string,"status": Database["public"]['Enums']["availability_status"],"updated_at": string,"updated_by": string | null
                  }
                  Insert: {
                    "date": string,"source"?: Database["public"]['Enums']["input_source"],"staff_id": string,"status": Database["public"]['Enums']["availability_status"],"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "date"?: string,"source"?: Database["public"]['Enums']["input_source"],"staff_id"?: string,"status"?: Database["public"]['Enums']["availability_status"],"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "availability_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"availability_submissions": {
                  Row: {
                    "memo": string,"month": string,"source": Database["public"]['Enums']["input_source"],"staff_id": string,"submitted_at": string | null,"updated_at": string
                  }
                  Insert: {
                    "memo"?: string,"month": string,"source"?: Database["public"]['Enums']["input_source"],"staff_id": string,"submitted_at"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "memo"?: string,"month"?: string,"source"?: Database["public"]['Enums']["input_source"],"staff_id"?: string,"submitted_at"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "availability_submissions_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"client_rates": {
                  Row: {
                    "amount": number,"company_id": string,"id": string,"item_id": string | null,"kind": Database["public"]['Enums']["rate_kind"],"role_id": string | null,"venue_id": string | null
                  }
                  Insert: {
                    "amount": number,"company_id": string,"id"?: string,"item_id"?: string | null,"kind": Database["public"]['Enums']["rate_kind"],"role_id"?: string | null,"venue_id"?: string | null
                  }
                  Update: {
                    "amount"?: number,"company_id"?: string,"id"?: string,"item_id"?: string | null,"kind"?: Database["public"]['Enums']["rate_kind"],"role_id"?: string | null,"venue_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "client_rates_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_rates_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_rates_role_id_fkey"
      columns: ["role_id"]
isOneToOne: false
      referencedRelation: "roles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_rates_venue_id_fkey"
      columns: ["venue_id"]
isOneToOne: false
      referencedRelation: "venues"
      referencedColumns: ["id"]
    }
                  ]
                },"closing_logs": {
                  Row: {
                    "action": Database["public"]['Enums']["closing_action"],"created_at": string,"id": string,"month": string,"reason": string,"user_id": string | null
                  }
                  Insert: {
                    "action": Database["public"]['Enums']["closing_action"],"created_at"?: string,"id"?: string,"month": string,"reason"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "action"?: Database["public"]['Enums']["closing_action"],"created_at"?: string,"id"?: string,"month"?: string,"reason"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "closing_logs_month_fkey"
      columns: ["month"]
isOneToOne: false
      referencedRelation: "monthly_closings"
      referencedColumns: ["month"]
    }
                  ]
                },"companies": {
                  Row: {
                    "address": string,"created_at": string,"id": string,"is_active": boolean,"kana": string,"kind": Database["public"]['Enums']["company_kind"],"memo": string,"name": string,"name_key": string | null,"next_action": string,"next_action_date": string | null,"owner_user_id": string | null,"phone": string,"phone_digits": string | null,"priority": Database["public"]['Enums']["priority"],"search_text": string | null,"status": Database["public"]['Enums']["company_status"],"updated_at": string,"website": string
                  }
                  Insert: {
                    "address"?: string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"kana"?: string,"kind": Database["public"]['Enums']["company_kind"],"memo"?: string,"name": string,"name_key"?: never,"next_action"?: string,"next_action_date"?: string | null,"owner_user_id"?: string | null,"phone"?: string,"phone_digits"?: never,"priority"?: Database["public"]['Enums']["priority"],"search_text"?: never,"status"?: Database["public"]['Enums']["company_status"],"updated_at"?: string,"website"?: string
                  }
                  Update: {
                    "address"?: string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"kana"?: string,"kind"?: Database["public"]['Enums']["company_kind"],"memo"?: string,"name"?: string,"name_key"?: never,"next_action"?: string,"next_action_date"?: string | null,"owner_user_id"?: string | null,"phone"?: string,"phone_digits"?: never,"priority"?: Database["public"]['Enums']["priority"],"search_text"?: never,"status"?: Database["public"]['Enums']["company_status"],"updated_at"?: string,"website"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "companies_owner_user_id_fkey"
      columns: ["owner_user_id"]
isOneToOne: false
      referencedRelation: "app_users"
      referencedColumns: ["id"]
    }
                  ]
                },"company_billing": {
                  Row: {
                    "bill_transport": boolean,"closing_day": number,"company_id": string,"invoice_note": string,"updated_at": string
                  }
                  Insert: {
                    "bill_transport"?: boolean,"closing_day"?: number,"company_id": string,"invoice_note"?: string,"updated_at"?: string
                  }
                  Update: {
                    "bill_transport"?: boolean,"closing_day"?: number,"company_id"?: string,"invoice_note"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "company_billing_company_id_fkey"
      columns: ["company_id"]
isOneToOne: true
      referencedRelation: "companies"
      referencedColumns: ["id"]
    }
                  ]
                },"company_items": {
                  Row: {
                    "company_id": string,"item_id": string
                  }
                  Insert: {
                    "company_id": string,"item_id": string
                  }
                  Update: {
                    "company_id"?: string,"item_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "company_items_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "company_items_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id"]
    }
                  ]
                },"company_links": {
                  Row: {
                    "company_id": string,"created_at": string,"id": string,"title": string,"url": string
                  }
                  Insert: {
                    "company_id": string,"created_at"?: string,"id"?: string,"title"?: string,"url": string
                  }
                  Update: {
                    "company_id"?: string,"created_at"?: string,"id"?: string,"title"?: string,"url"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "company_links_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    }
                  ]
                },"contacts": {
                  Row: {
                    "company_id": string,"created_at": string,"email": string,"id": string,"is_active": boolean,"kana": string,"line": string,"memo": string,"name": string,"phone": string,"phone_digits": string | null,"search_text": string | null,"title": string,"updated_at": string
                  }
                  Insert: {
                    "company_id": string,"created_at"?: string,"email"?: string,"id"?: string,"is_active"?: boolean,"kana"?: string,"line"?: string,"memo"?: string,"name": string,"phone"?: string,"phone_digits"?: never,"search_text"?: never,"title"?: string,"updated_at"?: string
                  }
                  Update: {
                    "company_id"?: string,"created_at"?: string,"email"?: string,"id"?: string,"is_active"?: boolean,"kana"?: string,"line"?: string,"memo"?: string,"name"?: string,"phone"?: string,"phone_digits"?: never,"search_text"?: never,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contacts_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    }
                  ]
                },"event_groups": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"name": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"name"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"event_incentive_rates": {
                  Row: {
                    "amount": number,"event_id": string,"item_id": string
                  }
                  Insert: {
                    "amount": number,"event_id": string,"item_id": string
                  }
                  Update: {
                    "amount"?: number,"event_id"?: string,"item_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_incentive_rates_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "event_overview"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_incentive_rates_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_incentive_rates_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id"]
    }
                  ]
                },"event_rates": {
                  Row: {
                    "amount": number,"event_id": string,"id": string,"item_id": string | null,"kind": Database["public"]['Enums']["rate_kind"],"role_id": string | null
                  }
                  Insert: {
                    "amount": number,"event_id": string,"id"?: string,"item_id"?: string | null,"kind": Database["public"]['Enums']["rate_kind"],"role_id"?: string | null
                  }
                  Update: {
                    "amount"?: number,"event_id"?: string,"id"?: string,"item_id"?: string | null,"kind"?: Database["public"]['Enums']["rate_kind"],"role_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_rates_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "event_overview"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_rates_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_rates_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_rates_role_id_fkey"
      columns: ["role_id"]
isOneToOne: false
      referencedRelation: "roles"
      referencedColumns: ["id"]
    }
                  ]
                },"event_requirements": {
                  Row: {
                    "event_id": string,"required_count": number,"role_id": string
                  }
                  Insert: {
                    "event_id": string,"required_count": number,"role_id": string
                  }
                  Update: {
                    "event_id"?: string,"required_count"?: number,"role_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_requirements_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "event_overview"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_requirements_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_requirements_role_id_fkey"
      columns: ["role_id"]
isOneToOne: false
      referencedRelation: "roles"
      referencedColumns: ["id"]
    }
                  ]
                },"events": {
                  Row: {
                    "belongings": string,"cancel_reason": string,"cancelled_at": string | null,"client_id": string,"created_at": string,"created_by": string | null,"date": string,"end_time": string | null,"group_id": string | null,"id": string,"meeting_place": string,"meeting_time": string | null,"notes": string,"report_required": boolean,"start_time": string | null,"updated_at": string,"venue_id": string
                  }
                  Insert: {
                    "belongings"?: string,"cancel_reason"?: string,"cancelled_at"?: string | null,"client_id": string,"created_at"?: string,"created_by"?: string | null,"date": string,"end_time"?: string | null,"group_id"?: string | null,"id"?: string,"meeting_place"?: string,"meeting_time"?: string | null,"notes"?: string,"report_required"?: boolean,"start_time"?: string | null,"updated_at"?: string,"venue_id": string
                  }
                  Update: {
                    "belongings"?: string,"cancel_reason"?: string,"cancelled_at"?: string | null,"client_id"?: string,"created_at"?: string,"created_by"?: string | null,"date"?: string,"end_time"?: string | null,"group_id"?: string | null,"id"?: string,"meeting_place"?: string,"meeting_time"?: string | null,"notes"?: string,"report_required"?: boolean,"start_time"?: string | null,"updated_at"?: string,"venue_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "events_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "events_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "event_groups"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "events_venue_id_fkey"
      columns: ["venue_id"]
isOneToOne: false
      referencedRelation: "venues"
      referencedColumns: ["id"]
    }
                  ]
                },"expenses": {
                  Row: {
                    "amount": number,"assignment_id": string,"created_at": string,"id": string,"kind": Database["public"]['Enums']["expense_kind"],"memo": string,"reject_reason": string,"reviewed_at": string | null,"reviewed_by": string | null,"source": Database["public"]['Enums']["input_source"],"staff_id": string,"status": Database["public"]['Enums']["expense_status"],"updated_at": string
                  }
                  Insert: {
                    "amount": number,"assignment_id": string,"created_at"?: string,"id"?: string,"kind": Database["public"]['Enums']["expense_kind"],"memo"?: string,"reject_reason"?: string,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"source"?: Database["public"]['Enums']["input_source"],"staff_id": string,"status"?: Database["public"]['Enums']["expense_status"],"updated_at"?: string
                  }
                  Update: {
                    "amount"?: number,"assignment_id"?: string,"created_at"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["expense_kind"],"memo"?: string,"reject_reason"?: string,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"source"?: Database["public"]['Enums']["input_source"],"staff_id"?: string,"status"?: Database["public"]['Enums']["expense_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "expenses_assignment_id_fkey"
      columns: ["assignment_id"]
isOneToOne: false
      referencedRelation: "assignments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_reviewed_by_fkey"
      columns: ["reviewed_by"]
isOneToOne: false
      referencedRelation: "app_users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"incentive_rates": {
                  Row: {
                    "amount": number,"item_id": string
                  }
                  Insert: {
                    "amount": number,"item_id": string
                  }
                  Update: {
                    "amount"?: number,"item_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "incentive_rates_item_id_fkey"
      columns: ["item_id"]
isOneToOne: true
      referencedRelation: "items"
      referencedColumns: ["id"]
    }
                  ]
                },"invoices": {
                  Row: {
                    "company_id": string,"detail": NonNullable<Json>,"id": string,"month": string,"snapshot_at": string,"subtotal": number,"tax": number,"total": number
                  }
                  Insert: {
                    "company_id": string,"detail"?: NonNullable<Json>,"id"?: string,"month": string,"snapshot_at"?: string,"subtotal"?: number,"tax"?: number,"total"?: number
                  }
                  Update: {
                    "company_id"?: string,"detail"?: NonNullable<Json>,"id"?: string,"month"?: string,"snapshot_at"?: string,"subtotal"?: number,"tax"?: number,"total"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoices_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    }
                  ]
                },"items": {
                  Row: {
                    "created_at": string,"id": string,"is_active": boolean,"name": string,"sort_order": number
                  }
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"name": string,"sort_order"?: number
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"name"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    
                  ]
                },"message_templates": {
                  Row: {
                    "body": string,"kind": Database["public"]['Enums']["template_kind"],"updated_at": string
                  }
                  Insert: {
                    "body": string,"kind": Database["public"]['Enums']["template_kind"],"updated_at"?: string
                  }
                  Update: {
                    "body"?: string,"kind"?: Database["public"]['Enums']["template_kind"],"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"monthly_closings": {
                  Row: {
                    "closed_at": string | null,"closed_by": string | null,"month": string,"status": Database["public"]['Enums']["closing_status"]
                  }
                  Insert: {
                    "closed_at"?: string | null,"closed_by"?: string | null,"month": string,"status": Database["public"]['Enums']["closing_status"]
                  }
                  Update: {
                    "closed_at"?: string | null,"closed_by"?: string | null,"month"?: string,"status"?: Database["public"]['Enums']["closing_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "monthly_closings_closed_by_fkey"
      columns: ["closed_by"]
isOneToOne: false
      referencedRelation: "app_users"
      referencedColumns: ["id"]
    }
                  ]
                },"monthly_targets": {
                  Row: {
                    "gross_profit": number | null,"month": string,"revenue": number | null
                  }
                  Insert: {
                    "gross_profit"?: number | null,"month": string,"revenue"?: number | null
                  }
                  Update: {
                    "gross_profit"?: number | null,"month"?: string,"revenue"?: number | null
                  }
                  Relationships: [
                    
                  ]
                },"owner_settings": {
                  Row: {
                    "key": string,"updated_at": string,"value": NonNullable<Json>
                  }
                  Insert: {
                    "key": string,"updated_at"?: string,"value": NonNullable<Json>
                  }
                  Update: {
                    "key"?: string,"updated_at"?: string,"value"?: NonNullable<Json>
                  }
                  Relationships: [
                    
                  ]
                },"payment_adjustments": {
                  Row: {
                    "amount": number,"created_at": string,"created_by": string | null,"id": string,"month": string,"reason": string,"staff_id": string
                  }
                  Insert: {
                    "amount": number,"created_at"?: string,"created_by"?: string | null,"id"?: string,"month": string,"reason": string,"staff_id": string
                  }
                  Update: {
                    "amount"?: number,"created_at"?: string,"created_by"?: string | null,"id"?: string,"month"?: string,"reason"?: string,"staff_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_adjustments_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "adjustment_total": number,"daily_total": number,"detail": NonNullable<Json>,"expense_total": number,"id": string,"incentive_total": number,"month": string,"net_amount": number,"paid_on": string | null,"snapshot_at": string,"staff_id": string,"status": Database["public"]['Enums']["payment_status"],"withholding_amount": number,"withholding_base": number
                  }
                  Insert: {
                    "adjustment_total"?: number,"daily_total"?: number,"detail"?: NonNullable<Json>,"expense_total"?: number,"id"?: string,"incentive_total"?: number,"month": string,"net_amount"?: number,"paid_on"?: string | null,"snapshot_at"?: string,"staff_id": string,"status"?: Database["public"]['Enums']["payment_status"],"withholding_amount"?: number,"withholding_base"?: number
                  }
                  Update: {
                    "adjustment_total"?: number,"daily_total"?: number,"detail"?: NonNullable<Json>,"expense_total"?: number,"id"?: string,"incentive_total"?: number,"month"?: string,"net_amount"?: number,"paid_on"?: string | null,"snapshot_at"?: string,"staff_id"?: string,"status"?: Database["public"]['Enums']["payment_status"],"withholding_amount"?: number,"withholding_base"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"rank_rates": {
                  Row: {
                    "base_daily_rate": number,"rank_id": string
                  }
                  Insert: {
                    "base_daily_rate": number,"rank_id": string
                  }
                  Update: {
                    "base_daily_rate"?: number,"rank_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "rank_rates_rank_id_fkey"
      columns: ["rank_id"]
isOneToOne: true
      referencedRelation: "ranks"
      referencedColumns: ["id"]
    }
                  ]
                },"ranks": {
                  Row: {
                    "created_at": string,"description": string,"id": string,"is_active": boolean,"name": string,"sort_order": number
                  }
                  Insert: {
                    "created_at"?: string,"description"?: string,"id"?: string,"is_active"?: boolean,"name": string,"sort_order"?: number
                  }
                  Update: {
                    "created_at"?: string,"description"?: string,"id"?: string,"is_active"?: boolean,"name"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    
                  ]
                },"rate_limits": {
                  Row: {
                    "count": number,"key": string,"window_start": string
                  }
                  Insert: {
                    "count"?: number,"key": string,"window_start": string
                  }
                  Update: {
                    "count"?: number,"key"?: string,"window_start"?: string
                  }
                  Relationships: [
                    
                  ]
                },"report_items": {
                  Row: {
                    "assignment_id": string,"confirmed_count": number | null,"diff_note": string,"diff_reason": Database["public"]['Enums']["diff_reason"] | null,"item_id": string,"reported_count": number | null
                  }
                  Insert: {
                    "assignment_id": string,"confirmed_count"?: number | null,"diff_note"?: string,"diff_reason"?: Database["public"]['Enums']["diff_reason"] | null,"item_id": string,"reported_count"?: number | null
                  }
                  Update: {
                    "assignment_id"?: string,"confirmed_count"?: number | null,"diff_note"?: string,"diff_reason"?: Database["public"]['Enums']["diff_reason"] | null,"item_id"?: string,"reported_count"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "report_items_assignment_id_fkey"
      columns: ["assignment_id"]
isOneToOne: false
      referencedRelation: "assignments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "report_items_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id"]
    }
                  ]
                },"reports": {
                  Row: {
                    "assignment_id": string,"comment": string,"confirmed_at": string | null,"confirmed_by": string | null,"source": Database["public"]['Enums']["input_source"],"submitted_at": string | null,"updated_at": string
                  }
                  Insert: {
                    "assignment_id": string,"comment"?: string,"confirmed_at"?: string | null,"confirmed_by"?: string | null,"source"?: Database["public"]['Enums']["input_source"],"submitted_at"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "assignment_id"?: string,"comment"?: string,"confirmed_at"?: string | null,"confirmed_by"?: string | null,"source"?: Database["public"]['Enums']["input_source"],"submitted_at"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "reports_assignment_id_fkey"
      columns: ["assignment_id"]
isOneToOne: true
      referencedRelation: "assignments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reports_confirmed_by_fkey"
      columns: ["confirmed_by"]
isOneToOne: false
      referencedRelation: "app_users"
      referencedColumns: ["id"]
    }
                  ]
                },"roles": {
                  Row: {
                    "created_at": string,"id": string,"is_active": boolean,"name": string,"sort_order": number
                  }
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"name": string,"sort_order"?: number
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"name"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    
                  ]
                },"settings": {
                  Row: {
                    "key": string,"updated_at": string,"value": NonNullable<Json>
                  }
                  Insert: {
                    "key": string,"updated_at"?: string,"value": NonNullable<Json>
                  }
                  Update: {
                    "key"?: string,"updated_at"?: string,"value"?: NonNullable<Json>
                  }
                  Relationships: [
                    
                  ]
                },"share_links": {
                  Row: {
                    "is_active": boolean,"kind": string,"rotated_at": string,"token": string,"updated_by": string | null
                  }
                  Insert: {
                    "is_active"?: boolean,"kind": string,"rotated_at"?: string,"token"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "is_active"?: boolean,"kind"?: string,"rotated_at"?: string,"token"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"sheet_exports": {
                  Row: {
                    "id": number,"message": string,"ok": boolean,"ran_at": string,"source": string
                  }
                  Insert: {
                    "id"?: never,"message"?: string,"ok": boolean,"ran_at"?: string,"source": string
                  }
                  Update: {
                    "id"?: never,"message"?: string,"ok"?: boolean,"ran_at"?: string,"source"?: string
                  }
                  Relationships: [
                    
                  ]
                },"staff": {
                  Row: {
                    "created_at": string,"id": string,"kana": string,"line_name": string,"line_user_id": string | null,"memo": string,"mypage_token": string,"name": string,"nearest_station": string,"phone": string,"phone_digits": string | null,"rank_id": string | null,"search_text": string | null,"status": Database["public"]['Enums']["staff_status"],"token_rotated_at": string | null,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"id"?: string,"kana"?: string,"line_name"?: string,"line_user_id"?: string | null,"memo"?: string,"mypage_token"?: string,"name": string,"nearest_station"?: string,"phone"?: string,"phone_digits"?: never,"rank_id"?: string | null,"search_text"?: never,"status"?: Database["public"]['Enums']["staff_status"],"token_rotated_at"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"kana"?: string,"line_name"?: string,"line_user_id"?: string | null,"memo"?: string,"mypage_token"?: string,"name"?: string,"nearest_station"?: string,"phone"?: string,"phone_digits"?: never,"rank_id"?: string | null,"search_text"?: never,"status"?: Database["public"]['Enums']["staff_status"],"token_rotated_at"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_rank_id_fkey"
      columns: ["rank_id"]
isOneToOne: false
      referencedRelation: "ranks"
      referencedColumns: ["id"]
    }
                  ]
                },"staff_areas": {
                  Row: {
                    "area_id": string,"staff_id": string
                  }
                  Insert: {
                    "area_id": string,"staff_id": string
                  }
                  Update: {
                    "area_id"?: string,"staff_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_areas_area_id_fkey"
      columns: ["area_id"]
isOneToOne: false
      referencedRelation: "areas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_areas_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"staff_ng": {
                  Row: {
                    "company_id": string | null,"created_at": string,"created_by": string | null,"id": string,"reason": string,"staff_id": string,"venue_id": string | null
                  }
                  Insert: {
                    "company_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"reason"?: string,"staff_id": string,"venue_id"?: string | null
                  }
                  Update: {
                    "company_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"reason"?: string,"staff_id"?: string,"venue_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_ng_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_ng_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_ng_venue_id_fkey"
      columns: ["venue_id"]
isOneToOne: false
      referencedRelation: "venues"
      referencedColumns: ["id"]
    }
                  ]
                },"staff_notes": {
                  Row: {
                    "assignment_id": string | null,"created_at": string,"created_by": string | null,"date": string,"id": string,"is_auto": boolean,"kind": Database["public"]['Enums']["note_kind"],"memo": string,"staff_id": string
                  }
                  Insert: {
                    "assignment_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"date"?: string,"id"?: string,"is_auto"?: boolean,"kind": Database["public"]['Enums']["note_kind"],"memo"?: string,"staff_id": string
                  }
                  Update: {
                    "assignment_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"date"?: string,"id"?: string,"is_auto"?: boolean,"kind"?: Database["public"]['Enums']["note_kind"],"memo"?: string,"staff_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_notes_assignment_fk"
      columns: ["assignment_id"]
isOneToOne: false
      referencedRelation: "assignments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_notes_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"staff_private": {
                  Row: {
                    "account_holder_kana": string,"account_number": string,"account_type": Database["public"]['Enums']["account_type"] | null,"bank_branch": string,"bank_name": string,"base_daily_rate": number | null,"contract_date": string | null,"contract_file_path": string | null,"invoice_number": string | null,"staff_id": string,"updated_at": string,"withholding_method": Database["public"]['Enums']["withholding_method"]
                  }
                  Insert: {
                    "account_holder_kana"?: string,"account_number"?: string,"account_type"?: Database["public"]['Enums']["account_type"] | null,"bank_branch"?: string,"bank_name"?: string,"base_daily_rate"?: number | null,"contract_date"?: string | null,"contract_file_path"?: string | null,"invoice_number"?: string | null,"staff_id": string,"updated_at"?: string,"withholding_method"?: Database["public"]['Enums']["withholding_method"]
                  }
                  Update: {
                    "account_holder_kana"?: string,"account_number"?: string,"account_type"?: Database["public"]['Enums']["account_type"] | null,"bank_branch"?: string,"bank_name"?: string,"base_daily_rate"?: number | null,"contract_date"?: string | null,"contract_file_path"?: string | null,"invoice_number"?: string | null,"staff_id"?: string,"updated_at"?: string,"withholding_method"?: Database["public"]['Enums']["withholding_method"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_private_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: true
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"staff_roles": {
                  Row: {
                    "role_id": string,"staff_id": string
                  }
                  Insert: {
                    "role_id": string,"staff_id": string
                  }
                  Update: {
                    "role_id"?: string,"staff_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_roles_role_id_fkey"
      columns: ["role_id"]
isOneToOne: false
      referencedRelation: "roles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_roles_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"venues": {
                  Row: {
                    "access_notes": string,"address": string,"area_id": string | null,"created_at": string,"green_room": string,"id": string,"is_active": boolean,"kana": string,"memo": string,"name": string,"nearest_station": string,"parking": string,"prefecture": string,"search_text": string | null,"updated_at": string
                  }
                  Insert: {
                    "access_notes"?: string,"address"?: string,"area_id"?: string | null,"created_at"?: string,"green_room"?: string,"id"?: string,"is_active"?: boolean,"kana"?: string,"memo"?: string,"name": string,"nearest_station"?: string,"parking"?: string,"prefecture"?: string,"search_text"?: never,"updated_at"?: string
                  }
                  Update: {
                    "access_notes"?: string,"address"?: string,"area_id"?: string | null,"created_at"?: string,"green_room"?: string,"id"?: string,"is_active"?: boolean,"kana"?: string,"memo"?: string,"name"?: string,"nearest_station"?: string,"parking"?: string,"prefecture"?: string,"search_text"?: never,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "venues_area_id_fkey"
      columns: ["area_id"]
isOneToOne: false
      referencedRelation: "areas"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "event_overview": {
                  Row: {
                    "belongings": string | null,"by_role": Json | null,"cancel_reason": string | null,"cancelled_at": string | null,"client_id": string | null,"confirm_notice_pending": number | null,"confirmed_total": number | null,"created_at": string | null,"created_by": string | null,"date": string | null,"end_time": string | null,"group_id": string | null,"id": string | null,"meeting_place": string | null,"meeting_time": string | null,"notes": string | null,"offered_count": number | null,"oldest_offer_at": string | null,"reminder_pending": number | null,"report_required": boolean | null,"required_total": number | null,"shortage_total": number | null,"start_time": string | null,"status": string | null,"unconfirmed_result_count": number | null,"unreported_count": number | null,"updated_at": string | null,"venue_id": string | null,"waitlisted_count": number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "events_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "events_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "event_groups"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "events_venue_id_fkey"
      columns: ["venue_id"]
isOneToOne: false
      referencedRelation: "venues"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            "board_json":
{ Args: { "m_end": string,"m_start": string }; Returns: Json
                           },
"board_snapshot":
{ Args: { "p_month": string }; Returns: Json
                           },
"company_key":
{ Args: { "t": string }; Returns: string
                           },
"digits_only":
{ Args: { "t": string }; Returns: string
                           },
"event_candidates":
{ Args: { "p_event_id": string }; Returns: {
              "area_match": boolean,"availability": Database["public"]['Enums']["availability_status"],"availability_submitted": boolean,"avg_confirmed": number,"caution_count": number,"current_status": Database["public"]['Enums']["assignment_status"],"double_booking": boolean,"double_booking_venue": string,"kana": string,"name": string,"nearest_station": string,"ng_client": boolean,"ng_reason": string,"ng_venue": boolean,"rank_id": string,"rank_name": string,"rank_order": number,"role_ids": (string)[],"sort_group": number,"staff_id": string
            }[]
                           },
"is_member":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_month_closed":
{ Args: { "d": string }; Returns: boolean
                           },
"is_owner":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"jst_today":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"month_start":
{ Args: { "d": string }; Returns: string
                           },
"mypage_availability_get":
{ Args: { "p_month": string,"p_token": string }; Returns: Json
                           },
"mypage_availability_save":
{ Args: { "p_days": Json,"p_memo": string,"p_month": string,"p_submit": boolean,"p_token": string }; Returns: Json
                           },
"mypage_event_json":
{ Args: { "p_event_id": string }; Returns: Json
                           },
"mypage_history":
{ Args: { "p_token": string }; Returns: Json
                           },
"mypage_me":
{ Args: { "p_token": string }; Returns: Json
                           },
"mypage_offers":
{ Args: { "p_token": string }; Returns: Json
                           },
"mypage_report_get":
{ Args: { "p_assignment_id": string,"p_token": string }; Returns: Json
                           },
"mypage_report_save":
{ Args: { "p_assignment_id": string,"p_comment": string,"p_items": Json,"p_other_amount": number,"p_other_memo": string,"p_token": string,"p_transport_amount": number,"p_transport_memo": string }; Returns: Json
                           },
"mypage_reports":
{ Args: { "p_token": string }; Returns: Json
                           },
"mypage_respond":
{ Args: { "p_accept": boolean,"p_assignment_id": string,"p_token": string }; Returns: Json
                           },
"mypage_schedule":
{ Args: { "p_token": string }; Returns: Json
                           },
"mypage_staff":
{ Args: { "p_token": string }; Returns: Record<string, unknown>
                           },
"new_mypage_token":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"rate_limit_hit":
{ Args: { "p_key": string,"p_limit": number }; Returns: boolean
                           },
"record_activity":
{ Args: { "p_company_id": string,"p_contact_id": string,"p_kind": Database["public"]['Enums']["activity_kind"],"p_memo": string,"p_next_action": string,"p_next_action_date": string,"p_result": Database["public"]['Enums']["activity_result"],"p_status": Database["public"]['Enums']["company_status"] }; Returns: Json
                           },
"report_history":
{ Args: { "p_assignment_id": string }; Returns: {
              "action": string,"after": Json,"before": Json,"by_staff": boolean,"changed_fields": (string)[],"created_at": string,"item_id": string,"table_name": string,"user_name": string
            }[]
                           },
"search_norm":
{ Args: { "t": string }; Returns: string
                           },
"setting_int":
{ Args: { "p_default": number,"p_key": string }; Returns: number
                           },
"share_board":
{ Args: { "p_month": string,"p_token": string }; Returns: Json
                           },
"staff_avg_confirmed":
{ Args: { "p_since": string }; Returns: {
              "avg_confirmed": number,"staff_id": string,"worked_count": number
            }[]
                           },
"undo_activity":
{ Args: { "p_activity_id": string,"p_before": Json }; Returns: boolean
                           }
          }
          Enums: {
            "account_type": "ordinary"|"checking","activity_kind": "call"|"line"|"email"|"visit"|"meeting"|"other","activity_result": "reached"|"absent"|"callback"|"sent_material"|"appointment"|"declined","assignment_status": "offered"|"confirmed"|"waitlisted"|"declined"|"cancelled"|"no_show","availability_status": "ok"|"maybe"|"ng","closing_action": "close"|"unlock"|"reclose","closing_status": "closed"|"unlocked","company_kind": "client"|"partner","company_status": "not_contacted"|"contacted"|"meeting_set"|"met"|"active"|"dormant","diff_reason": "cancelled"|"rejected"|"input_error"|"other","expense_kind": "transport"|"other","expense_status": "pending"|"approved"|"rejected","input_source": "self"|"admin","note_kind": "last_minute_cancel"|"late"|"trouble"|"good"|"other","payment_status": "unconfirmed"|"confirmed"|"paid","priority": "high"|"mid"|"low","rate_kind": "per_person_day"|"per_event"|"per_item","staff_status": "active"|"paused"|"ended","template_kind": "offer"|"confirm"|"reminder"|"availability_request"|"availability_reminder"|"report_request","user_role": "owner"|"manager","withholding_method": "none"|"fee"|"sales_agent"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "account_type": ["ordinary", "checking"],"activity_kind": ["call", "line", "email", "visit", "meeting", "other"],"activity_result": ["reached", "absent", "callback", "sent_material", "appointment", "declined"],"assignment_status": ["offered", "confirmed", "waitlisted", "declined", "cancelled", "no_show"],"availability_status": ["ok", "maybe", "ng"],"closing_action": ["close", "unlock", "reclose"],"closing_status": ["closed", "unlocked"],"company_kind": ["client", "partner"],"company_status": ["not_contacted", "contacted", "meeting_set", "met", "active", "dormant"],"diff_reason": ["cancelled", "rejected", "input_error", "other"],"expense_kind": ["transport", "other"],"expense_status": ["pending", "approved", "rejected"],"input_source": ["self", "admin"],"note_kind": ["last_minute_cancel", "late", "trouble", "good", "other"],"payment_status": ["unconfirmed", "confirmed", "paid"],"priority": ["high", "mid", "low"],"rate_kind": ["per_person_day", "per_event", "per_item"],"staff_status": ["active", "paused", "ended"],"template_kind": ["offer", "confirm", "reminder", "availability_request", "availability_reminder", "report_request"],"user_role": ["owner", "manager"],"withholding_method": ["none", "fee", "sales_agent"]
          }
        }
} as const
