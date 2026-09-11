export type CollectionChannel = 'email' | 'whatsapp' | 'sms';

export interface CollectionAction {
  id: string;
  tenant_id: string;
  operating_company_id: string;
  channel: CollectionChannel;
  attempt_count: number;
  recipient_snapshot: {
    contact_id?: string | null;
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    customer_name?: string | null;
  };
  content_snapshot: {
    subject?: string | null;
    message_template: string;
    document?: string | null;
    amount?: number | null;
    due_date?: string | null;
  };
}

export interface CollectionJobData {
  action: CollectionAction;
}

export interface ContractFinancialEventResult {
  suspended_contracts: number;
  released_contracts: number;
  ignored_events: number;
  failed_events: number;
}
