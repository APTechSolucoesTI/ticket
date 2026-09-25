export interface AutomationDispatch {
  id: string;
  tenant_id: string;
  trigger_id: string;
  company_id: string;
  related_entity_id: string;
  payload: Record<string, unknown>;
  attempt_count: number;
}

export type AutomationJobData = { dispatch?: AutomationDispatch };
