type ErrorRecord = Record<string, unknown>;

type ValidationIssue = ErrorRecord & {
  code?: string;
  message?: string;
  path?: Array<string | number>;
};

const FIELD_LABELS: Record<string, string> = {
  address_city: "Cidade",
  address_complement: "Complemento",
  address_neighborhood: "Bairro",
  address_number: "Número",
  address_state: "Estado",
  address_street: "Logradouro",
  address_zip: "CEP",
  asset_tag: "Patrimônio",
  billing_model: "Modelo de cobrança",
  body: "Conteúdo",
  can_open_tickets: "Permissão para abrir tickets",
  cnpj: "CNPJ",
  code: "Código",
  company_id: "Cliente",
  contact_id: "Contato",
  contract_type_id: "Tipo de contrato",
  default_hours_monthly: "Horas mensais",
  default_monthly_value: "Valor mensal",
  description: "Descrição",
  email: "E-mail",
  ends_at: "Data final",
  equipment_tiers: "Faixas de equipamentos",
  extra_hour_price: "Valor da hora adicional",
  family_id: "Família de serviço",
  fantasy_name: "Nome fantasia",
  first_response_minutes: "Tempo da primeira resposta",
  hours_monthly_quota: "Franquia mensal de horas",
  job_title: "Cargo",
  monthly_value: "Valor mensal",
  name: "Nome",
  notes: "Observações",
  phone: "Telefone",
  price: "Valor",
  priority: "Prioridade",
  quantity: "Quantidade",
  receives_csat: "Recebimento de pesquisa de satisfação",
  reference: "Referência",
  resolution_minutes: "Tempo de resolução",
  roleId: "Papel",
  service_items: "Serviços vinculados",
  sla_policy_id: "Política de SLA",
  starts_at: "Data inicial",
  status: "Status",
  title: "Título",
  type: "Tipo",
  website: "Site",
};

const GENERIC_MESSAGES = /^(invalid input|invalid value|validation failed|bad request|error)$/i;
const DEFAULT_VALIDATION_MESSAGES =
  /^(too (big|small)|invalid (input|type|format|option|value)|expected |unrecognized key)/i;

function asRecord(value: unknown): ErrorRecord | null {
  return typeof value === "object" && value !== null ? (value as ErrorRecord) : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function fieldLabel(path: Array<string | number> | undefined): string {
  const field = [...(path ?? [])]
    .reverse()
    .find((part): part is string => typeof part === "string");
  if (!field) return "Campo informado";
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];

  const normalized = field.replace(/_/g, " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatLimit(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}

function formatValidationIssue(issue: ValidationIssue): string {
  const label = fieldLabel(issue.path);
  const rawMessage = text(issue.message);

  if (
    rawMessage &&
    !GENERIC_MESSAGES.test(rawMessage) &&
    !DEFAULT_VALIDATION_MESSAGES.test(rawMessage)
  ) {
    return rawMessage;
  }

  switch (issue.code) {
    case "invalid_type":
      return `${label}: informe um valor válido.`;
    case "invalid_value":
      return `${label}: selecione uma opção válida.`;
    case "invalid_format":
      return `${label}: o formato informado não é válido.`;
    case "too_small": {
      const minimum = formatLimit(issue.minimum);
      return minimum
        ? `${label}: informe pelo menos ${minimum} caractere(s) ou um valor igual ou maior.`
        : `${label}: o valor informado é menor que o permitido.`;
    }
    case "too_big": {
      const maximum = formatLimit(issue.maximum);
      return maximum
        ? `${label}: informe no máximo ${maximum} caractere(s) ou um valor igual ou menor.`
        : `${label}: o valor informado ultrapassa o limite permitido.`;
    }
    case "unrecognized_keys":
      return `${label}: há informações que não são aceitas neste cadastro.`;
    default:
      return `${label}: revise o valor informado.`;
  }
}

function validationIssues(error: unknown): ValidationIssue[] {
  const record = asRecord(error);
  if (!record || !Array.isArray(record.issues)) return [];
  return record.issues.filter((issue): issue is ValidationIssue => asRecord(issue) !== null);
}

export function getValidationErrorMessage(error: unknown): string {
  const messages = validationIssues(error)
    .map(formatValidationIssue)
    .filter((message, index, all) => all.indexOf(message) === index)
    .slice(0, 3);

  if (!messages.length) {
    return "Revise os dados informados e tente novamente.";
  }

  return messages.length === 1 ? messages[0] : `Revise os campos: ${messages.join(" ")}`;
}

function extractField(error: ErrorRecord, message: string): string | null {
  const detail = text(error.details);
  const source = `${detail} ${message}`;
  const keyMatch = source.match(/Key \(([^)]+)\)=/i);
  const columnMatch = source.match(/column ["']?([a-zA-Z0-9_]+)["']?/i);
  const fields = keyMatch?.[1]?.split(",").map((field) => field.trim()) ?? [];
  const field = [...fields].reverse().find((item) => item !== "tenant_id") ?? columnMatch?.[1];
  return field ? fieldLabel([field]) : null;
}

function withReference(message: string, code: string): string {
  return code ? `${message} (código ${code})` : message;
}

/**
 * Converts validation, Supabase/PostgREST and ordinary JavaScript errors into
 * actionable Portuguese messages suitable for end users.
 */
export function getUserFacingError(
  error: unknown,
  fallback = "Não foi possível concluir a operação.",
): string {
  const issues = validationIssues(error);
  if (issues.length) return getValidationErrorMessage(error);

  const record = asRecord(error);
  const code = text(record?.code);
  const message = text(record?.message) || (typeof error === "string" ? error.trim() : "");
  const field = record ? extractField(record, message) : null;

  if (code === "23505" || /duplicate key|unique constraint/i.test(message)) {
    return withReference(
      field
        ? `${field} já está cadastrado. Revise esse campo ou edite o registro existente.`
        : "Já existe um cadastro com esses dados. Revise os campos que devem ser únicos.",
      code || "23505",
    );
  }

  if (code === "23503" || /foreign key constraint/i.test(message)) {
    return withReference(
      "Não foi possível concluir porque este cadastro possui vínculos ou um item selecionado não existe mais.",
      code || "23503",
    );
  }

  if (code === "23502" || /not-null constraint|null value in column/i.test(message)) {
    return withReference(
      field ? `${field} é obrigatório.` : "Um campo obrigatório não foi preenchido.",
      code || "23502",
    );
  }

  if (code === "23514" || /check constraint/i.test(message)) {
    return withReference(
      "Um dos valores informados não atende às regras deste cadastro. Revise as opções e os limites preenchidos.",
      code || "23514",
    );
  }

  if (code === "22001" || /value too long|too long for type/i.test(message)) {
    return withReference(
      field
        ? `${field} ultrapassa o limite de caracteres permitido.`
        : "Um dos campos ultrapassa o limite de caracteres permitido.",
      code || "22001",
    );
  }

  if (code === "22P02" || /invalid input syntax/i.test(message)) {
    return withReference(
      field ? `${field} está em um formato inválido.` : "Um dos campos está em formato inválido.",
      code || "22P02",
    );
  }

  if (code === "42501" || /permission denied|row-level security/i.test(message)) {
    return withReference(
      "Você não possui permissão para realizar esta operação. Solicite acesso a um administrador.",
      code || "42501",
    );
  }

  if (["PGRST204", "42703", "42P01"].includes(code)) {
    return withReference(
      "O cadastro não pôde ser salvo porque a estrutura do sistema está desatualizada. Contate o suporte.",
      code,
    );
  }

  if (/failed to fetch|networkerror|network request failed/i.test(message)) {
    return "Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.";
  }

  if (!message || GENERIC_MESSAGES.test(message)) {
    return `${fallback} Revise os campos obrigatórios e os formatos informados.`;
  }

  return withReference(message, code);
}
