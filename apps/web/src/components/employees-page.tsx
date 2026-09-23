import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  Banknote,
  BriefcaseBusiness,
  CalendarDays,
  Eye,
  FileCheck2,
  FileUp,
  Gift,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  WalletCards,
} from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getMyTenantId } from "@/lib/tenant";
import { getCurrentUserId } from "@/lib/session";
import { getUserFacingError, getValidationErrorMessage } from "@/lib/user-facing-error";
import { usePermissions } from "@/lib/use-permissions";
import { formatCurrency } from "@/lib/number-format";
import { maskPhone } from "@/lib/masks";
import { PageHeader, EmptyStub } from "@/components/empty-stub";
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state";
import { ConfigurableTable, type ListColumn } from "@/components/configurable-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FinancialCurrencyInput } from "@/components/ui/decimal-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

const db = supabase as unknown as SupabaseClient;
const NONE = "__none__";
const today = () => new Date().toISOString().slice(0, 10);
const month = () => today().slice(0, 7);
const digits = (value: string) => value.replace(/\D/g, "");
const normalizeEmail = (value: string) => value.trim().toLowerCase();
const date = (value?: string | null) =>
  value ? new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR") : "-";

type Employee = {
  id: string;
  tenant_id: string;
  operating_company_id: string;
  nome_completo: string;
  nome_social: string | null;
  cpf: string | null;
  rg: string | null;
  rg_orgao_emissor: string | null;
  data_nascimento: string | null;
  sexo: string | null;
  estado_civil: string | null;
  nacionalidade: string;
  naturalidade_cidade: string | null;
  naturalidade_uf: string | null;
  nome_mae: string | null;
  nome_pai: string | null;
  pis_pasep: string | null;
  ctps_numero: string | null;
  ctps_serie: string | null;
  ctps_uf: string | null;
  titulo_eleitor: string | null;
  certificado_reservista: string | null;
  email_pessoal: string | null;
  email_corporativo: string | null;
  telefone_principal: string | null;
  telefone_secundario: string | null;
  matricula: string;
  cargo_atual_id: string | null;
  departamento: string | null;
  centro_custo_id: string | null;
  data_admissao: string;
  data_demissao: string | null;
  tipo_contrato: string;
  regime_jornada: string;
  carga_horaria_semanal: number | null;
  status: "ativo" | "afastado" | "ferias" | "desligado";
  motivo_desligamento: string | null;
  tipo_desligamento: string | null;
  gestor_responsavel_id: string | null;
  observacoes: string | null;
  cargo?: string;
  salario?: number;
  documentos_pendentes?: number;
  documentos_vencidos?: number;
};
type Option = { id: string; label: string };
type Position = {
  id: string;
  cargo: string;
  nivel: string | null;
  salario_base: number;
  tipo_alteracao: string;
  motivo: string | null;
  vigente_de: string;
  vigente_ate: string | null;
};
type Address = {
  id: string;
  tipo: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  cidade: string;
  uf: string;
  vigente_de: string;
  vigente_ate: string | null;
  is_atual: boolean;
};
type Document = {
  id: string;
  tipo_documento_id: string;
  numero_documento: string | null;
  data_emissao: string | null;
  data_validade: string | null;
  arquivo_url: string;
  arquivo_nome_original: string;
  status: string;
};
type Vacation = {
  id: string;
  periodo_aquisitivo_inicio: string;
  periodo_aquisitivo_fim: string;
  periodo_concessivo_limite: string;
  dias_direito: number;
  dias_vendidos: number;
  dias_gozados: number;
  data_inicio_gozo: string | null;
  data_fim_gozo: string | null;
  status: string;
  venda_abono: boolean;
  adianta_13: boolean;
};
type Bank = {
  id: string;
  tipo_recebimento: string;
  banco_codigo: string | null;
  banco_nome: string | null;
  agencia: string | null;
  conta: string | null;
  chave_pix: string | null;
  titular_nome: string;
  titular_cpf: string;
  vigente_de: string;
  vigente_ate: string | null;
  is_atual: boolean;
};
type Event = {
  id: string;
  funcionario_id: string;
  tipo_evento: string;
  competencia: string;
  valor_bruto: number;
  valor_descontos: number;
  valor_liquido: number;
  data_prevista_pagamento: string;
  status_integracao: string;
  erro_integracao: string | null;
  conta_pagar_id: string | null;
};
type DocType = { id: string; nome: string; categoria: string };
type Benefit = {
  id: string;
  tipo_beneficio: string;
  vigente_de: string;
  vigente_ate: string | null;
  valor: number;
  observacao: string | null;
};
type BenefitDocument = {
  id: string;
  beneficio_id: string;
  arquivo_url: string;
  arquivo_nome_original: string;
  historico: string | null;
};

const statusLabels: Record<Employee["status"], string> = {
  ativo: "Ativo",
  afastado: "Afastado",
  ferias: "Férias",
  desligado: "Desligado",
};
const eventLabels: Record<string, string> = {
  adiantamento_salarial: "Adiantamento salarial",
  pagamento_folha: "Pagamento da folha",
  vale_transporte: "Vale-transporte",
  vale_refeicao: "Vale-refeição",
  decimo_terceiro_1a_parcela: "13º - 1ª parcela",
  decimo_terceiro_2a_parcela: "13º - 2ª parcela",
  ferias: "Férias",
  banco_horas: "Banco de horas",
};

const employeeSchema = z.object({
  operating_company_id: z.string().uuid("Selecione a empresa operadora."),
  nome_completo: z.string().trim().min(3, "Informe o nome completo."),
  cpf: z
    .string()
    .transform(digits)
    .refine((v) => v.length === 0 || v.length === 11, "CPF deve ter 11 dígitos."),
  data_nascimento: z.string(),
  pis_pasep: z
    .string()
    .transform(digits)
    .refine((v) => v.length === 0 || v.length === 11, "PIS/PASEP deve ter 11 dígitos."),
  ctps_numero: z.string().trim(),
  ctps_serie: z.string().trim(),
  ctps_uf: z.string().refine((v) => !v || /^[A-Z]{2}$/.test(v), "Informe uma UF válida."),
  email_pessoal: z
    .string()
    .trim()
    .refine((value) => !value || z.email().safeParse(value).success, "E-mail pessoal inválido."),
  email_corporativo: z
    .string()
    .trim()
    .refine(
      (value) => !value || z.email().safeParse(value).success,
      "E-mail corporativo inválido.",
    ),
  data_admissao: z.string().min(1),
  tipo_contrato: z.enum([
    "clt",
    "pj",
    "estagio",
    "aprendiz",
    "temporario",
    "servicos_terceirizados",
  ]),
  regime_jornada: z.enum(["integral", "meio_periodo", "home_office", "hibrido"]),
  cargo: z.string().trim().min(2, "Informe o cargo."),
  salario: z.number().min(0),
});

const blankEmployee = {
  operating_company_id: "",
  nome_completo: "",
  nome_social: "",
  cpf: "",
  rg: "",
  rg_orgao_emissor: "",
  data_nascimento: "",
  sexo: "",
  estado_civil: "",
  nacionalidade: "Brasileira",
  naturalidade_cidade: "",
  naturalidade_uf: "",
  nome_mae: "",
  nome_pai: "",
  pis_pasep: "",
  ctps_numero: "",
  ctps_serie: "",
  ctps_uf: "",
  titulo_eleitor: "",
  certificado_reservista: "",
  email_pessoal: "",
  email_corporativo: "",
  telefone_principal: "",
  telefone_secundario: "",
  matricula: "",
  departamento: "",
  centro_custo_id: "",
  data_admissao: today(),
  tipo_contrato: "clt",
  regime_jornada: "integral",
  carga_horaria_semanal: "44",
  gestor_responsavel_id: "",
  observacoes: "",
  cargo: "",
  nivel: "",
  salario: 0,
};

export function EmployeesPage() {
  const permissions = usePermissions();
  const canCreate = permissions.has("funcionarios", "create");
  const canEdit = permissions.has("funcionarios", "edit");
  const canDelete = permissions.has("funcionarios", "delete");
  const canSensitive = permissions.has("funcionarios", "sensitive");
  const canPayroll = permissions.has("funcionarios", "payroll");
  const qc = useQueryClient();
  const [view, setView] = useState("employees");
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Employee | null>(null);

  const options = useQuery({
    queryKey: ["employee-options"],
    queryFn: async () => {
      const [companies, centers] = await Promise.all([
        db
          .from("operating_companies")
          .select("id,legal_name,trade_name")
          .eq("is_active", true)
          .is("deleted_at", null)
          .order("legal_name"),
        db
          .from("financial_cost_centers")
          .select("id,name,operating_company_id")
          .eq("is_active", true)
          .is("deleted_at", null)
          .order("name"),
      ]);
      if (companies.error) throw companies.error;
      return {
        companies: (companies.data ?? []).map((item: Record<string, unknown>) => ({
          id: String(item.id),
          label: String(item.trade_name || item.legal_name),
        })),
        centers: (centers.data ?? []).map((item: Record<string, unknown>) => ({
          id: String(item.id),
          label: String(item.name),
          companyId: String(item.operating_company_id),
        })),
      };
    },
  });
  const query = useQuery({
    queryKey: ["employees", canSensitive],
    queryFn: async () => {
      await db.rpc("refresh_employee_compliance");
      const { data, error } = await db
        .from("funcionarios")
        .select("*")
        .is("deleted_at", null)
        .order("nome_completo");
      if (error) throw error;
      const employees = (data ?? []) as Employee[];
      const positionIds = employees.map((item) => item.cargo_atual_id).filter(Boolean) as string[];
      const [positions, documents] = await Promise.all([
        positionIds.length
          ? db
              .from("funcionario_cargos_salarios")
              .select("id,cargo,salario_base")
              .in("id", positionIds)
          : Promise.resolve({ data: [], error: null }),
        canSensitive && employees.length
          ? db
              .from("funcionario_documentos")
              .select("funcionario_id,tipo_documento_id,status,data_validade")
              .in(
                "funcionario_id",
                employees.map((item) => item.id),
              )
              .is("deleted_at", null)
          : Promise.resolve({ data: [], error: null }),
      ]);
      const positionMap = new Map(
        (positions.data ?? []).map((item: Record<string, unknown>) => [String(item.id), item]),
      );
      return employees.map((employee) => {
        const current = employee.cargo_atual_id
          ? positionMap.get(employee.cargo_atual_id)
          : undefined;
        const docs = (documents.data ?? []).filter(
          (item: Record<string, unknown>) => item.funcionario_id === employee.id,
        );
        return {
          ...employee,
          cargo: String(current?.cargo ?? "Não informado"),
          salario: Number(current?.salario_base ?? 0),
          documentos_pendentes: docs.filter(
            (item: Record<string, unknown>) => item.status === "pendente",
          ).length,
          documentos_vencidos: docs.filter(
            (item: Record<string, unknown>) => item.status === "vencido",
          ).length,
        };
      });
    },
  });
  const rows = query.data ?? [];
  const columns: ListColumn<Employee>[] = [
    {
      key: "employee",
      label: "Funcionário",
      className: "font-medium",
      accessor: (employee) => `${employee.nome_social ?? ""} ${employee.nome_completo}`,
      cell: (employee) => (
        <div className="flex items-center gap-2">
          <UserRound className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate">{employee.nome_social || employee.nome_completo}</div>
            {employee.nome_social ? (
              <div className="max-w-72 truncate text-xs text-muted-foreground">
                {employee.nome_completo}
              </div>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      key: "registration",
      label: "Matrícula",
      className: "font-mono text-xs",
      accessor: (employee) => employee.matricula,
      cell: (employee) => employee.matricula,
    },
    {
      key: "position",
      label: "Cargo",
      accessor: (employee) => employee.cargo ?? "",
      cell: (employee) => employee.cargo || "-",
    },
    {
      key: "department",
      label: "Departamento",
      accessor: (employee) => employee.departamento ?? "",
      cell: (employee) => employee.departamento || "-",
    },
    {
      key: "company",
      label: "Empresa",
      accessor: (employee) =>
        options.data?.companies.find((item) => item.id === employee.operating_company_id)?.label ??
        "",
      cell: (employee) =>
        options.data?.companies.find((item) => item.id === employee.operating_company_id)?.label ||
        "-",
    },
    {
      key: "cost_center",
      label: "Centro de custo",
      accessor: (employee) =>
        options.data?.centers.find((item) => item.id === employee.centro_custo_id)?.label ?? "",
      cell: (employee) =>
        options.data?.centers.find((item) => item.id === employee.centro_custo_id)?.label || "-",
    },
    {
      key: "admission",
      label: "Admissão",
      accessor: (employee) => employee.data_admissao,
      cell: (employee) => date(employee.data_admissao),
    },
    {
      key: "contract",
      label: "Contrato",
      accessor: (employee) => employee.tipo_contrato,
      cell: (employee) => employee.tipo_contrato.toUpperCase(),
    },
    {
      key: "work_schedule",
      label: "Jornada",
      accessor: (employee) => employee.regime_jornada.replaceAll("_", " "),
      cell: (employee) => employee.regime_jornada.replaceAll("_", " "),
    },
    {
      key: "corporate_email",
      label: "E-mail corporativo",
      accessor: (employee) => employee.email_corporativo ?? "",
      cell: (employee) => employee.email_corporativo || "-",
    },
    {
      key: "phone",
      label: "Telefone",
      accessor: (employee) => employee.telefone_principal ?? "",
      cell: (employee) =>
        employee.telefone_principal ? maskPhone(employee.telefone_principal) : "-",
    },
    ...(canSensitive
      ? [
          {
            key: "documents",
            label: "Documentos",
            accessor: (employee: Employee) => {
              if (employee.documentos_vencidos) return "Vencidos";
              if (employee.documentos_pendentes) return "Pendentes";
              return "Em dia";
            },
            cell: (employee: Employee) => (
              <div className="flex gap-1">
                {employee.documentos_vencidos ? (
                  <Badge variant="destructive">{employee.documentos_vencidos} vencido(s)</Badge>
                ) : null}
                {employee.documentos_pendentes ? (
                  <Badge variant="outline">{employee.documentos_pendentes} pendente(s)</Badge>
                ) : null}
                {!employee.documentos_vencidos && !employee.documentos_pendentes ? (
                  <Badge variant="secondary">Em dia</Badge>
                ) : null}
              </div>
            ),
          },
          {
            key: "salary",
            label: "Salário",
            accessor: (employee: Employee) => employee.salario ?? 0,
            cell: (employee: Employee) => formatCurrency(employee.salario ?? 0),
          },
        ]
      : []),
    {
      key: "status",
      label: "Status",
      accessor: (employee) => statusLabels[employee.status],
      cell: (employee) => (
        <Badge variant={employee.status === "ativo" ? "secondary" : "outline"}>
          {statusLabels[employee.status]}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-4 p-6">
      <PageHeader
        title="Funcionários"
        subtitle="Cadastro, documentos, férias, dados bancários e integração da folha ao financeiro."
        icon={Users}
        actions={
          canCreate ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="mr-1 size-4" /> Novo funcionário
            </Button>
          ) : undefined
        }
      />
      <Tabs value={view} onValueChange={setView}>
        <TabsList>
          <TabsTrigger value="employees">Funcionários</TabsTrigger>
          {canPayroll ? <TabsTrigger value="payroll">Fechamento de folha</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="employees" className="space-y-4">
          {query.isLoading ? (
            <LoadingState label="Carregando funcionários…" />
          ) : query.isError ? (
            <ErrorState
              title="Funcionários indisponíveis"
              description="Não foi possível consultar o cadastro."
              action={{ label: "Atualizar", onClick: () => void query.refetch() }}
            />
          ) : !rows.length ? (
            <EmptyStub
              title="Nenhum funcionário cadastrado"
              message="Cadastre o primeiro colaborador para iniciar a gestão da equipe."
            />
          ) : (
            <Card className="p-3">
              <ConfigurableTable<Employee>
                listKey="employees"
                rows={rows}
                rowKey={(employee) => employee.id}
                defaultColumns={[
                  "employee",
                  "registration",
                  "position",
                  "department",
                  "admission",
                  ...(canSensitive ? ["documents"] : []),
                  "status",
                ]}
                columns={columns}
                rowActions={(employee) => (
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Abrir ficha"
                    aria-label={`Abrir ficha de ${employee.nome_completo}`}
                    onClick={() => setSelected(employee)}
                  >
                    <Eye className="size-4" />
                  </Button>
                )}
              />
            </Card>
          )}
        </TabsContent>
        <TabsContent value="payroll">
          <PayrollPanel
            employees={query.data ?? []}
            canPayroll={canPayroll}
            onChanged={() => void qc.invalidateQueries({ queryKey: ["employees"] })}
          />
        </TabsContent>
      </Tabs>
      <EmployeeCreateDialog
        open={creating}
        onClose={() => setCreating(false)}
        options={options.data}
        employees={query.data ?? []}
        onCreated={() => {
          setCreating(false);
          void qc.invalidateQueries({ queryKey: ["employees"] });
        }}
      />
      {selected ? (
        <EmployeeDetailDialog
          employee={selected}
          canEdit={canEdit}
          canDelete={canDelete}
          canSensitive={canSensitive}
          canPayroll={canPayroll}
          onClose={() => setSelected(null)}
          onChanged={() => {
            void qc.invalidateQueries({ queryKey: ["employees"] });
          }}
        />
      ) : null}
    </div>
  );
}

function EmployeeCreateDialog({
  open,
  onClose,
  onCreated,
  options,
  employees,
}: {
  open: boolean;
  onClose(): void;
  onCreated(): void;
  options?: { companies: Option[]; centers: Array<Option & { companyId: string }> };
  employees: Employee[];
}) {
  const [form, setForm] = useState(blankEmployee);
  useEffect(() => {
    if (open) setForm({ ...blankEmployee, operating_company_id: options?.companies[0]?.id ?? "" });
  }, [open, options]);
  const create = useMutation({
    mutationFn: async () => {
      const parsed = employeeSchema.safeParse({ ...form, salario: Number(form.salario) });
      if (!parsed.success) throw new Error(getValidationErrorMessage(parsed.error));
      const { cargo, nivel, salario, ...data } = form;
      const { error } = await db.rpc("create_employee_with_position", {
        p_data: {
          ...data,
          cpf: digits(data.cpf) || null,
          data_nascimento: data.data_nascimento || null,
          pis_pasep: digits(data.pis_pasep) || null,
          ctps_numero: data.ctps_numero.trim() || null,
          ctps_serie: data.ctps_serie.trim() || null,
          ctps_uf: data.ctps_uf.trim().toUpperCase() || null,
          email_pessoal: normalizeEmail(data.email_pessoal) || null,
          email_corporativo: normalizeEmail(data.email_corporativo) || null,
        },
        p_cargo: cargo,
        p_nivel: nivel || null,
        p_salario: Number(salario),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Funcionário cadastrado.");
      onCreated();
    },
    onError: (error) =>
      toast.error(getUserFacingError(error, "Não foi possível cadastrar o funcionário.")),
  });
  const field = (key: keyof typeof form, label: string, type = "text") => (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input
        type={type}
        value={String(form[key] ?? "")}
        onChange={(event) =>
          setForm((current) => ({
            ...current,
            [key]: type === "email" ? event.target.value.toLowerCase() : event.target.value,
          }))
        }
      />
    </div>
  );
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Novo funcionário</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <Label>Empresa operadora *</Label>
            <Select
              value={form.operating_company_id}
              onValueChange={(value) =>
                setForm((current) => ({
                  ...current,
                  operating_company_id: value,
                  centro_custo_id: "",
                }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {options?.companies.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {field("nome_completo", "Nome completo *")} {field("nome_social", "Nome social")}{" "}
          {field("cpf", "CPF")} {field("data_nascimento", "Nascimento", "date")}
          {field("rg", "RG")} {field("rg_orgao_emissor", "Órgão emissor")}{" "}
          <div>
            <Label>Sexo</Label>
            <Select
              value={form.sexo || NONE}
              onValueChange={(value) =>
                setForm((current) => ({ ...current, sexo: value === NONE ? "" : value }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Não informado</SelectItem>
                <SelectItem value="feminino">Feminino</SelectItem>
                <SelectItem value="masculino">Masculino</SelectItem>
                <SelectItem value="nao_binario">Não binário</SelectItem>
                <SelectItem value="nao_informado">Prefere não informar</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Estado civil</Label>
            <Select
              value={form.estado_civil || NONE}
              onValueChange={(value) =>
                setForm((current) => ({ ...current, estado_civil: value === NONE ? "" : value }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Não informado</SelectItem>
                <SelectItem value="solteiro">Solteiro(a)</SelectItem>
                <SelectItem value="casado">Casado(a)</SelectItem>
                <SelectItem value="divorciado">Divorciado(a)</SelectItem>
                <SelectItem value="viuvo">Viúvo(a)</SelectItem>
                <SelectItem value="uniao_estavel">União estável</SelectItem>
                <SelectItem value="outro">Outro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {field("nacionalidade", "Nacionalidade *")} {field("naturalidade_cidade", "Naturalidade")}
          {field("naturalidade_uf", "UF de naturalidade")} {field("nome_mae", "Nome da mãe")}
          {field("nome_pai", "Nome do pai")} {field("titulo_eleitor", "Título de eleitor")}
          {field("certificado_reservista", "Certificado de reservista")}
          {field("pis_pasep", "PIS/PASEP")} {field("ctps_numero", "CTPS número")}{" "}
          {field("ctps_serie", "CTPS série")} {field("ctps_uf", "CTPS UF")}
          {field("email_pessoal", "E-mail pessoal", "email")}{" "}
          {field("email_corporativo", "E-mail corporativo", "email")}{" "}
          {field("telefone_principal", "Telefone principal")}{" "}
          {field("telefone_secundario", "Telefone secundário")}
          {field("data_admissao", "Data de admissão *", "date")}{" "}
          {field("matricula", "Matrícula (automática se vazia)")}{" "}
          {field("departamento", "Departamento")} {field("cargo", "Cargo inicial *")}{" "}
          {field("nivel", "Nível")}
          <div className="space-y-1">
            <Label>Salário base *</Label>
            <FinancialCurrencyInput
              value={form.salario}
              onValueChange={(value) =>
                setForm((current) => ({ ...current, salario: Number(value || 0) }))
              }
            />
          </div>
          <div>
            <Label>Tipo de contrato *</Label>
            <Select
              value={form.tipo_contrato}
              onValueChange={(value) =>
                setForm((current) => ({ ...current, tipo_contrato: value }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="clt">CLT</SelectItem>
                <SelectItem value="pj">PJ</SelectItem>
                <SelectItem value="estagio">Estágio</SelectItem>
                <SelectItem value="aprendiz">Aprendiz</SelectItem>
                <SelectItem value="temporario">Temporário</SelectItem>
                <SelectItem value="servicos_terceirizados">Serviços Terceirizados</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Regime de jornada *</Label>
            <Select
              value={form.regime_jornada}
              onValueChange={(value) =>
                setForm((current) => ({ ...current, regime_jornada: value }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="integral">Integral</SelectItem>
                <SelectItem value="meio_periodo">Meio período</SelectItem>
                <SelectItem value="home_office">Home office</SelectItem>
                <SelectItem value="hibrido">Híbrido</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {field("carga_horaria_semanal", "Carga semanal", "number")}
          <div>
            <Label>Centro de custo</Label>
            <Select
              value={form.centro_custo_id || NONE}
              onValueChange={(value) =>
                setForm((current) => ({ ...current, centro_custo_id: value === NONE ? "" : value }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Não informado</SelectItem>
                {options?.centers
                  .filter((item) => item.companyId === form.operating_company_id)
                  .map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Gestor responsável</Label>
            <Select
              value={form.gestor_responsavel_id || NONE}
              onValueChange={(value) =>
                setForm((current) => ({
                  ...current,
                  gestor_responsavel_id: value === NONE ? "" : value,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Nenhum</SelectItem>
                {employees
                  .filter((item) => item.status === "ativo")
                  .map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.nome_completo}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <Label>Observações</Label>
            <Textarea
              value={form.observacoes}
              onChange={(event) =>
                setForm((current) => ({ ...current, observacoes: event.target.value }))
              }
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? <Loader2 className="size-4 animate-spin" /> : null}Cadastrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmployeeDetailDialog({
  employee,
  canEdit,
  canDelete,
  canSensitive,
  canPayroll,
  onClose,
  onChanged,
}: {
  employee: Employee;
  canEdit: boolean;
  canDelete: boolean;
  canSensitive: boolean;
  canPayroll: boolean;
  onClose(): void;
  onChanged(): void;
}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState("profile");
  const [adding, setAdding] = useState<string | null>(null);
  const [editingPosition, setEditingPosition] = useState<Position | null>(null);
  const detail = useQuery({
    queryKey: ["employee-detail", employee.id, canSensitive],
    queryFn: async () => {
      if (canSensitive)
        await db.rpc("log_employee_sensitive_access", {
          p_employee_id: employee.id,
          p_action: "view_employee_record",
          p_detail: { tab },
        });
      const queries = [
        db
          .from("funcionario_enderecos")
          .select("*")
          .eq("funcionario_id", employee.id)
          .is("deleted_at", null)
          .order("vigente_de", { ascending: false }),
        db
          .from("funcionario_cargos_salarios")
          .select("*")
          .eq("funcionario_id", employee.id)
          .is("deleted_at", null)
          .order("vigente_de", { ascending: false }),
        db
          .from("funcionario_ferias")
          .select("*")
          .eq("funcionario_id", employee.id)
          .is("deleted_at", null)
          .order("periodo_aquisitivo_inicio", { ascending: false }),
        db
          .from("funcionario_eventos_financeiros")
          .select("*")
          .eq("funcionario_id", employee.id)
          .is("deleted_at", null)
          .order("competencia", { ascending: false }),
        db
          .from("funcionario_tipos_documento")
          .select("id,nome,categoria")
          .eq("is_active", true)
          .is("deleted_at", null)
          .order("nome"),
        canSensitive
          ? db
              .from("funcionario_documentos")
              .select("*")
              .eq("funcionario_id", employee.id)
              .is("deleted_at", null)
              .order("created_at", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        canSensitive
          ? db
              .from("funcionario_dados_bancarios")
              .select("*")
              .eq("funcionario_id", employee.id)
              .is("deleted_at", null)
              .order("vigente_de", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        db
          .from("funcionario_beneficios")
          .select("*")
          .eq("funcionario_id", employee.id)
          .is("deleted_at", null)
          .order("vigente_de", { ascending: false }),
        canSensitive
          ? db
              .from("funcionario_beneficio_documentos")
              .select("*")
              .eq("funcionario_id", employee.id)
              .is("deleted_at", null)
              .order("created_at", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
      ];
      const [
        addresses,
        positions,
        vacations,
        events,
        types,
        documents,
        banks,
        benefits,
        benefitDocuments,
      ] = await Promise.all(queries);
      const failed = [
        addresses,
        positions,
        vacations,
        events,
        types,
        benefits,
        benefitDocuments,
      ].find((result) => result.error);
      if (failed?.error) throw failed.error;
      return {
        addresses: (addresses.data ?? []) as Address[],
        positions: (positions.data ?? []) as Position[],
        vacations: (vacations.data ?? []) as Vacation[],
        events: (events.data ?? []) as Event[],
        types: (types.data ?? []) as DocType[],
        documents: (documents.data ?? []) as Document[],
        banks: (banks.data ?? []) as Bank[],
        benefits: (benefits.data ?? []) as Benefit[],
        benefitDocuments: (benefitDocuments.data ?? []) as BenefitDocument[],
      };
    },
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["employee-detail", employee.id] });
    onChanged();
    setAdding(null);
  };
  const integrate = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke(
        "criar-lancamento-financeiro-funcionario",
        { body: { event_id: id } },
      );
      if (error) throw error;
      if (!data?.payable_id) {
        const result = await db
          .from("funcionario_eventos_financeiros")
          .select("erro_integracao")
          .eq("id", id)
          .single();
        throw new Error(
          String(result.data?.erro_integracao || "A integração financeira não foi concluída."),
        );
      }
    },
    onSuccess: () => {
      toast.success("Conta a pagar gerada.");
      refresh();
    },
    onError: (error) =>
      toast.error(getUserFacingError(error, "Não foi possível gerar a conta a pagar.")),
  });
  const removePosition = useMutation({
    mutationFn: async (position: Position) => {
      if (
        !window.confirm(
          `Excluir o registro de ${position.cargo}? O histórico de auditoria será preservado.`,
        )
      )
        return false;
      const { error } = await db.rpc("archive_employee_position", { p_position_id: position.id });
      if (error) throw error;
      return true;
    },
    onSuccess: (removed) => {
      if (removed) {
        toast.success("Cargo e salário excluídos.");
        refresh();
      }
    },
    onError: (error) => toast.error(getUserFacingError(error)),
  });
  const removeEvent = useMutation({
    mutationFn: async (event: Event) => {
      if (!window.confirm(`Excluir o evento ${eventLabels[event.tipo_evento]} pendente?`))
        return false;
      const { error } = await db.rpc("archive_employee_financial_event", {
        p_event_id: event.id,
      });
      if (error) throw error;
      return true;
    },
    onSuccess: (removed) => {
      if (!removed) return;
      toast.success("Evento financeiro excluído.");
      refresh();
    },
    onError: (error) => toast.error(getUserFacingError(error)),
  });
  return (
    <Dialog open onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserRound className="size-5 text-primary" />
            {employee.nome_social || employee.nome_completo}
            <Badge variant="outline">{employee.matricula}</Badge>
          </DialogTitle>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-auto w-full flex-wrap justify-start">
            <TabsTrigger value="profile">Dados cadastrais</TabsTrigger>
            <TabsTrigger value="addresses">Endereços</TabsTrigger>
            <TabsTrigger value="positions">Cargo & salário</TabsTrigger>
            {canSensitive ? <TabsTrigger value="documents">Documentos</TabsTrigger> : null}
            <TabsTrigger value="vacations">Férias</TabsTrigger>
            <TabsTrigger value="benefits">Benefícios</TabsTrigger>
            {canSensitive ? <TabsTrigger value="bank">Dados bancários</TabsTrigger> : null}
            <TabsTrigger value="finance">Financeiro</TabsTrigger>
          </TabsList>
          {detail.isLoading ? (
            <LoadingState />
          ) : detail.isError ? (
            <ErrorState
              title="Ficha indisponível"
              description="Não foi possível carregar o histórico."
            />
          ) : (
            <>
              <TabsContent value="profile">
                <Profile
                  employee={employee}
                  canEdit={canEdit}
                  canDelete={canDelete}
                  onChanged={refresh}
                  onArchived={onClose}
                />
              </TabsContent>
              <TabsContent value="addresses">
                <HistorySection
                  title="Histórico de endereços"
                  icon={MapPin}
                  canAdd={canEdit}
                  onAdd={() => setAdding("address")}
                  empty={!detail.data?.addresses.length}
                >
                  {detail.data?.addresses.map((item) => (
                    <HistoryCard
                      key={item.id}
                      title={`${item.logradouro}, ${item.numero}`}
                      subtitle={`${item.bairro} · ${item.cidade}/${item.uf} · CEP ${item.cep}`}
                      meta={`${date(item.vigente_de)} até ${item.is_atual ? "atual" : date(item.vigente_ate)}`}
                    />
                  ))}
                </HistorySection>
              </TabsContent>
              <TabsContent value="positions">
                <HistorySection
                  title="Histórico de cargos e salários"
                  icon={BriefcaseBusiness}
                  canAdd={canEdit}
                  onAdd={() => setAdding("position")}
                  empty={!detail.data?.positions.length}
                >
                  {detail.data?.positions.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <p className="font-medium">
                          {item.cargo}
                          {item.nivel ? ` · ${item.nivel}` : ""}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {formatCurrency(item.salario_base)} ·{" "}
                          {item.tipo_alteracao.replaceAll("_", " ")}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {date(item.vigente_de)} até{" "}
                          {item.vigente_ate ? date(item.vigente_ate) : "atual"}
                        </p>
                      </div>
                      {canEdit ? (
                        <div className="flex gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Editar cargo e salário"
                            onClick={() => setEditingPosition(item)}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          {canDelete ? (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-destructive"
                              aria-label="Excluir cargo e salário"
                              onClick={() => removePosition.mutate(item)}
                              disabled={removePosition.isPending}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </HistorySection>
              </TabsContent>
              <TabsContent value="documents">
                <Documents
                  employee={employee}
                  documents={detail.data?.documents ?? []}
                  types={detail.data?.types ?? []}
                  canEdit={canSensitive}
                  canManageTypes={canEdit}
                  onChanged={refresh}
                />
              </TabsContent>
              <TabsContent value="vacations">
                <HistorySection
                  title="Períodos de férias"
                  icon={CalendarDays}
                  canAdd={canEdit}
                  onAdd={() => setAdding("vacation")}
                  empty={!detail.data?.vacations.length}
                >
                  {detail.data?.vacations.map((item) => (
                    <HistoryCard
                      key={item.id}
                      title={`${date(item.periodo_aquisitivo_inicio)} a ${date(item.periodo_aquisitivo_fim)}`}
                      subtitle={`${item.dias_direito} dias de direito · ${item.dias_gozados} gozados · ${item.dias_vendidos} vendidos`}
                      meta={`Limite: ${date(item.periodo_concessivo_limite)} · ${item.status.replaceAll("_", " ")}`}
                    />
                  ))}
                </HistorySection>
              </TabsContent>
              <TabsContent value="bank">
                <HistorySection
                  title="Dados bancários"
                  icon={WalletCards}
                  canAdd={canSensitive}
                  onAdd={() => setAdding("bank")}
                  empty={!detail.data?.banks.length}
                >
                  {detail.data?.banks.map((item) => (
                    <HistoryCard
                      key={item.id}
                      title={
                        item.tipo_recebimento === "pix"
                          ? `PIX · ${item.chave_pix}`
                          : `${item.banco_nome || "Banco"} · Ag. ${item.agencia} · Conta ${item.conta}`
                      }
                      subtitle={`Titular: ${item.titular_nome} · CPF ${item.titular_cpf}`}
                      meta={`${date(item.vigente_de)} até ${item.is_atual ? "atual" : date(item.vigente_ate)}`}
                    />
                  ))}
                </HistorySection>
              </TabsContent>
              <TabsContent value="benefits">
                <Benefits
                  employee={employee}
                  benefits={detail.data?.benefits ?? []}
                  documents={detail.data?.benefitDocuments ?? []}
                  canEdit={canEdit}
                  canAttach={canSensitive}
                  onChanged={refresh}
                />
              </TabsContent>
              <TabsContent value="finance">
                <HistorySection
                  title="Eventos financeiros"
                  icon={Banknote}
                  canAdd={canPayroll}
                  onAdd={() => setAdding("event")}
                  empty={!detail.data?.events.length}
                >
                  {detail.data?.events.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <p className="font-medium">{eventLabels[item.tipo_evento]}</p>
                        <p className="text-xs text-muted-foreground">
                          Competência {item.competencia.slice(0, 7)} · vencimento{" "}
                          {date(item.data_prevista_pagamento)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{formatCurrency(item.valor_liquido)}</span>
                        <Badge
                          variant={item.status_integracao === "erro" ? "destructive" : "outline"}
                        >
                          {item.status_integracao}
                        </Badge>
                        {canPayroll && !item.conta_pagar_id ? (
                          <Button
                            size="sm"
                            onClick={() => integrate.mutate(item.id)}
                            disabled={integrate.isPending}
                          >
                            Gerar conta a pagar
                          </Button>
                        ) : null}
                        {canPayroll &&
                        item.status_integracao === "pendente" &&
                        !item.conta_pagar_id ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-destructive"
                            aria-label="Excluir evento financeiro pendente"
                            onClick={() => removeEvent.mutate(item)}
                            disabled={removeEvent.isPending}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        ) : null}
                      </div>
                      {item.erro_integracao ? (
                        <p className="text-xs text-destructive">{item.erro_integracao}</p>
                      ) : null}
                    </div>
                  ))}
                </HistorySection>
              </TabsContent>
            </>
          )}
        </Tabs>
        {adding ? (
          <SubrecordDialog
            kind={adding}
            employee={employee}
            onClose={() => setAdding(null)}
            onSaved={refresh}
          />
        ) : null}
        {editingPosition ? (
          <SubrecordDialog
            kind="position"
            employee={employee}
            initialPosition={editingPosition}
            onClose={() => setEditingPosition(null)}
            onSaved={() => {
              setEditingPosition(null);
              refresh();
            }}
          />
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Profile({
  employee,
  canEdit,
  canDelete,
  onChanged,
  onArchived,
}: {
  employee: Employee;
  canEdit: boolean;
  canDelete: boolean;
  onChanged(): void;
  onArchived(): void;
}) {
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState(employee.status);
  const [observations, setObservations] = useState(employee.observacoes ?? "");
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await db
        .from("funcionarios")
        .update({ status, observacoes: observations, updated_by: getCurrentUserId() })
        .eq("id", employee.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Dados atualizados.");
      onChanged();
    },
    onError: (error) => toast.error(getUserFacingError(error)),
  });
  const archive = useMutation({
    mutationFn: async () => {
      if (!window.confirm("Arquivar este funcionário? O histórico será preservado.")) return false;
      const { error } = await db.rpc("archive_employee", {
        p_employee_id: employee.id,
        p_reason: "Arquivado pelo cadastro de funcionários",
      });
      if (error) throw error;
      return true;
    },
    onSuccess: (archived) => {
      if (!archived) return;
      toast.success("Funcionário arquivado.");
      onChanged();
      onArchived();
    },
    onError: (error) => toast.error(getUserFacingError(error)),
  });
  const ctpsBase = [employee.ctps_numero, employee.ctps_serie].filter(Boolean).join(" / ");
  const ctps = employee.ctps_uf
    ? `${ctpsBase ? `${ctpsBase} - ` : ""}${employee.ctps_uf}`
    : ctpsBase;
  const items = [
    ["CPF", employee.cpf],
    ["RG", employee.rg],
    ["Nascimento", date(employee.data_nascimento)],
    ["PIS/PASEP", employee.pis_pasep],
    ["CTPS", ctps],
    ["Contrato", employee.tipo_contrato.toUpperCase()],
    ["Jornada", employee.regime_jornada.replaceAll("_", " ")],
    ["E-mail", employee.email_corporativo || employee.email_pessoal],
    ["Telefone", employee.telefone_principal],
    ["Departamento", employee.departamento],
  ];
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Dados cadastrais</CardTitle>
          {canEdit ? (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              <Pencil className="mr-1 size-4" />
              Editar cadastro
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {items.map(([label, value]) => (
            <div key={label}>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p
                className={`text-sm font-medium ${
                  label === "E-mail" ? "break-all lowercase" : "break-words capitalize"
                }`}
              >
                {value || "-"}
              </p>
            </div>
          ))}
        </div>
        {canEdit ? (
          <div className="grid gap-3 border-t pt-4 sm:grid-cols-[220px_1fr_auto]">
            <div>
              <Label>Status</Label>
              <Select
                value={status}
                onValueChange={(value) => setStatus(value as Employee["status"])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(statusLabels)
                    .filter(([value]) => value !== "desligado")
                    .map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Observações</Label>
              <Input
                value={observations}
                onChange={(event) => setObservations(event.target.value)}
              />
            </div>
            <Button className="self-end" onClick={() => save.mutate()} disabled={save.isPending}>
              Salvar
            </Button>
            {canDelete ? (
              <Button
                className="self-end sm:col-start-3"
                variant="destructive"
                onClick={() => archive.mutate()}
                disabled={archive.isPending}
              >
                Arquivar funcionário
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
      {editing ? (
        <EmployeeEditDialog
          employee={employee}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChanged();
            onArchived();
          }}
        />
      ) : null}
    </Card>
  );
}

function EmployeeEditDialog({
  employee,
  onClose,
  onSaved,
}: {
  employee: Employee;
  onClose(): void;
  onSaved(): void;
}) {
  const [form, setForm] = useState({
    nome_completo: employee.nome_completo,
    nome_social: employee.nome_social ?? "",
    cpf: employee.cpf ?? "",
    rg: employee.rg ?? "",
    rg_orgao_emissor: employee.rg_orgao_emissor ?? "",
    data_nascimento: employee.data_nascimento ?? "",
    sexo: employee.sexo ?? "",
    estado_civil: employee.estado_civil ?? "",
    nacionalidade: employee.nacionalidade ?? "Brasileira",
    naturalidade_cidade: employee.naturalidade_cidade ?? "",
    naturalidade_uf: employee.naturalidade_uf ?? "",
    nome_mae: employee.nome_mae ?? "",
    nome_pai: employee.nome_pai ?? "",
    pis_pasep: employee.pis_pasep ?? "",
    ctps_numero: employee.ctps_numero ?? "",
    ctps_serie: employee.ctps_serie ?? "",
    ctps_uf: employee.ctps_uf ?? "",
    titulo_eleitor: employee.titulo_eleitor ?? "",
    certificado_reservista: employee.certificado_reservista ?? "",
    email_pessoal: employee.email_pessoal ?? "",
    email_corporativo: employee.email_corporativo ?? "",
    telefone_principal: employee.telefone_principal ?? "",
    telefone_secundario: employee.telefone_secundario ?? "",
    matricula: employee.matricula,
    departamento: employee.departamento ?? "",
    data_admissao: employee.data_admissao,
    tipo_contrato: employee.tipo_contrato,
    regime_jornada: employee.regime_jornada,
    carga_horaria_semanal: String(employee.carga_horaria_semanal ?? ""),
    observacoes: employee.observacoes ?? "",
  });
  const set = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const field = (key: keyof typeof form, label: string, type = "text") => (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input
        type={type}
        value={form[key]}
        onChange={(event) =>
          set(key, type === "email" ? event.target.value.toLowerCase() : event.target.value)
        }
      />
    </div>
  );
  const save = useMutation({
    mutationFn: async () => {
      const cpf = digits(form.cpf);
      if (cpf && cpf.length !== 11) throw new Error("CPF deve ter 11 dígitos.");
      const pis = digits(form.pis_pasep);
      if (pis && pis.length !== 11) throw new Error("PIS/PASEP deve ter 11 dígitos.");
      if (form.ctps_uf && !/^[A-Z]{2}$/.test(form.ctps_uf.toUpperCase()))
        throw new Error("Informe uma UF válida para a CTPS.");
      for (const [label, value] of [
        ["pessoal", form.email_pessoal],
        ["corporativo", form.email_corporativo],
      ] as const) {
        if (value.trim() && !z.email().safeParse(value.trim()).success)
          throw new Error(`Informe um e-mail ${label} válido.`);
      }
      const nullable = (value: string) => value.trim() || null;
      const { error } = await db
        .from("funcionarios")
        .update({
          nome_completo: form.nome_completo.trim(),
          nome_social: nullable(form.nome_social),
          cpf: cpf || null,
          rg: nullable(form.rg),
          rg_orgao_emissor: nullable(form.rg_orgao_emissor),
          data_nascimento: form.data_nascimento || null,
          sexo: nullable(form.sexo),
          estado_civil: nullable(form.estado_civil),
          nacionalidade: form.nacionalidade.trim() || "Brasileira",
          naturalidade_cidade: nullable(form.naturalidade_cidade),
          naturalidade_uf: nullable(form.naturalidade_uf)?.toUpperCase() ?? null,
          nome_mae: nullable(form.nome_mae),
          nome_pai: nullable(form.nome_pai),
          pis_pasep: pis || null,
          ctps_numero: nullable(form.ctps_numero),
          ctps_serie: nullable(form.ctps_serie),
          ctps_uf: nullable(form.ctps_uf)?.toUpperCase() ?? null,
          titulo_eleitor: nullable(form.titulo_eleitor),
          certificado_reservista: nullable(form.certificado_reservista),
          email_pessoal: nullable(normalizeEmail(form.email_pessoal)),
          email_corporativo: nullable(normalizeEmail(form.email_corporativo)),
          telefone_principal: nullable(form.telefone_principal),
          telefone_secundario: nullable(form.telefone_secundario),
          matricula: form.matricula.trim(),
          departamento: nullable(form.departamento),
          data_admissao: form.data_admissao,
          tipo_contrato: form.tipo_contrato,
          regime_jornada: form.regime_jornada,
          carga_horaria_semanal: form.carga_horaria_semanal
            ? Number(form.carga_horaria_semanal)
            : null,
          observacoes: nullable(form.observacoes),
          updated_by: getCurrentUserId(),
        })
        .eq("id", employee.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cadastro do funcionário atualizado.");
      onSaved();
    },
    onError: (error) => toast.error(getUserFacingError(error)),
  });
  return (
    <Dialog open onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Editar funcionário</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {field("nome_completo", "Nome completo *")}
          {field("nome_social", "Nome social")}
          {field("cpf", "CPF")}
          {field("data_nascimento", "Nascimento", "date")}
          {field("rg", "RG")}
          {field("rg_orgao_emissor", "Órgão emissor")}
          {field("nacionalidade", "Nacionalidade")}
          {field("naturalidade_cidade", "Naturalidade")}
          {field("naturalidade_uf", "UF de naturalidade")}
          {field("nome_mae", "Nome da mãe")}
          {field("nome_pai", "Nome do pai")}
          {field("pis_pasep", "PIS/PASEP")}
          {field("ctps_numero", "CTPS número")}
          {field("ctps_serie", "CTPS série")}
          {field("ctps_uf", "CTPS UF")}
          {field("titulo_eleitor", "Título de eleitor")}
          {field("certificado_reservista", "Certificado de reservista")}
          {field("email_pessoal", "E-mail pessoal", "email")}
          {field("email_corporativo", "E-mail corporativo", "email")}
          {field("telefone_principal", "Telefone principal")}
          {field("telefone_secundario", "Telefone secundário")}
          {field("matricula", "Matrícula *")}
          {field("departamento", "Departamento")}
          {field("data_admissao", "Admissão *", "date")}
          {field("carga_horaria_semanal", "Carga semanal", "number")}
          <div>
            <Label>Tipo de contrato</Label>
            <Select
              value={form.tipo_contrato}
              onValueChange={(value) => set("tipo_contrato", value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[
                  ["clt", "CLT"],
                  ["pj", "PJ"],
                  ["estagio", "Estágio"],
                  ["aprendiz", "Aprendiz"],
                  ["temporario", "Temporário"],
                  ["servicos_terceirizados", "Serviços Terceirizados"],
                ].map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Regime</Label>
            <Select
              value={form.regime_jornada}
              onValueChange={(value) => set("regime_jornada", value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[
                  ["integral", "Integral"],
                  ["meio_periodo", "Meio período"],
                  ["home_office", "Home office"],
                  ["hibrido", "Híbrido"],
                ].map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Sexo</Label>
            <Select
              value={form.sexo || NONE}
              onValueChange={(value) => set("sexo", value === NONE ? "" : value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Não informado</SelectItem>
                <SelectItem value="feminino">Feminino</SelectItem>
                <SelectItem value="masculino">Masculino</SelectItem>
                <SelectItem value="nao_binario">Não binário</SelectItem>
                <SelectItem value="nao_informado">Prefere não informar</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Estado civil</Label>
            <Select
              value={form.estado_civil || NONE}
              onValueChange={(value) => set("estado_civil", value === NONE ? "" : value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Não informado</SelectItem>
                <SelectItem value="solteiro">Solteiro(a)</SelectItem>
                <SelectItem value="casado">Casado(a)</SelectItem>
                <SelectItem value="divorciado">Divorciado(a)</SelectItem>
                <SelectItem value="viuvo">Viúvo(a)</SelectItem>
                <SelectItem value="uniao_estavel">União estável</SelectItem>
                <SelectItem value="outro">Outro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <Label>Observações</Label>
            <Textarea
              value={form.observacoes}
              onChange={(event) => set("observacoes", event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="size-4 animate-spin" /> : null}Salvar alterações
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistorySection({
  title,
  icon: Icon,
  canAdd,
  onAdd,
  empty,
  children,
}: {
  title: string;
  icon: typeof MapPin;
  canAdd: boolean;
  onAdd(): void;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="size-5 text-primary" />
          {title}
        </CardTitle>
        {canAdd ? (
          <Button size="sm" variant="outline" onClick={onAdd}>
            <Plus className="mr-1 size-4" />
            Adicionar
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-2">
        {empty ? (
          <EmptyState title="Nenhum registro" description="O histórico aparecerá aqui." />
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}
function HistoryCard({ title, subtitle, meta }: { title: string; subtitle: string; meta: string }) {
  return (
    <div className="relative rounded-lg border p-3 pl-5 before:absolute before:left-0 before:top-3 before:h-8 before:w-1 before:rounded-r before:bg-primary">
      <p className="font-medium">{title}</p>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
      <p className="mt-1 text-xs text-muted-foreground">{meta}</p>
    </div>
  );
}

function SubrecordDialog({
  kind,
  employee,
  initialPosition,
  onClose,
  onSaved,
}: {
  kind: string;
  employee: Employee;
  initialPosition?: Position;
  onClose(): void;
  onSaved(): void;
}) {
  const [form, setForm] = useState<Record<string, string | number | boolean>>({
    tipo: "residencial",
    cep: "",
    logradouro: "",
    numero: "",
    complemento: "",
    bairro: "",
    cidade: "",
    uf: "",
    cargo: initialPosition?.cargo ?? "",
    nivel: initialPosition?.nivel ?? "",
    salario_base: initialPosition?.salario_base ?? 0,
    tipo_alteracao: initialPosition?.tipo_alteracao ?? "Promoção",
    motivo: initialPosition?.motivo ?? "",
    vigente_de: initialPosition?.vigente_de ?? today(),
    vigente_ate: initialPosition?.vigente_ate ?? "",
    periodo_aquisitivo_inicio: employee.data_admissao,
    dias_direito: 30,
    dias_vendidos: 0,
    data_inicio_gozo: "",
    venda_abono: false,
    adianta_13: false,
    tipo_recebimento: "pix",
    banco_codigo: "",
    banco_nome: "",
    agencia: "",
    agencia_dv: "",
    conta: "",
    conta_dv: "",
    tipo_conta: "corrente",
    chave_pix: "",
    tipo_chave_pix: "cpf",
    titular_nome: employee.nome_completo,
    titular_cpf: employee.cpf ?? "",
    justificativa_terceiro: "",
    tipo_evento: "pagamento_folha",
    competencia: month(),
    valor_bruto: employee.salario ?? 0,
    valor_descontos: 0,
    data_prevista_pagamento: today(),
  });
  const set = (key: string, value: string | number | boolean) =>
    setForm((current) => ({ ...current, [key]: value }));
  const cep = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("buscar-cep", {
        body: { cep: digits(String(form.cep)) },
      });
      if (error) throw error;
      return data as Record<string, string>;
    },
    onSuccess: (data) =>
      setForm((current) => ({
        ...current,
        logradouro: data.logradouro,
        bairro: data.bairro,
        cidade: data.cidade,
        uf: data.uf,
      })),
    onError: (error) => toast.error(getUserFacingError(error, "Não foi possível consultar o CEP.")),
  });
  const save = useMutation({
    mutationFn: async () => {
      const tenantId = await getMyTenantId();
      if (!tenantId) throw new Error("Tenant não encontrado.");
      if (kind === "address") {
        const { error } = await db.from("funcionario_enderecos").insert({
          tenant_id: tenantId,
          funcionario_id: employee.id,
          tipo: form.tipo,
          cep: digits(String(form.cep)),
          logradouro: form.logradouro,
          numero: form.numero,
          complemento: form.complemento || null,
          bairro: form.bairro,
          cidade: form.cidade,
          uf: String(form.uf).toUpperCase(),
          vigente_de: today(),
          created_by: getCurrentUserId(),
        });
        if (error) throw error;
      }
      if (kind === "position") {
        if (initialPosition) {
          const { error } = await db.rpc("update_employee_position", {
            p_position_id: initialPosition.id,
            p_cargo: form.cargo,
            p_nivel: form.nivel || "",
            p_salario: Number(form.salario_base),
            p_tipo_alteracao: form.tipo_alteracao,
            p_motivo: form.motivo || "",
            p_vigente_de: form.vigente_de,
            p_vigente_ate: form.vigente_ate || null,
          });
          if (error) throw error;
        } else {
          const { error } = await db.from("funcionario_cargos_salarios").insert({
            tenant_id: tenantId,
            funcionario_id: employee.id,
            cargo: form.cargo,
            nivel: form.nivel || null,
            salario_base: Number(form.salario_base),
            tipo_alteracao: form.tipo_alteracao,
            motivo: form.motivo || null,
            vigente_de: form.vigente_de,
            created_by: getCurrentUserId(),
          });
          if (error) throw error;
        }
      }
      if (kind === "vacation") {
        const start = new Date(`${form.periodo_aquisitivo_inicio}T00:00:00Z`);
        const end = new Date(start);
        end.setUTCFullYear(end.getUTCFullYear() + 1);
        end.setUTCDate(end.getUTCDate() - 1);
        const limit = new Date(end);
        limit.setUTCFullYear(limit.getUTCFullYear() + 1);
        const go = form.data_inicio_gozo ? new Date(`${form.data_inicio_gozo}T00:00:00Z`) : null;
        const goEnd = go ? new Date(go) : null;
        if (goEnd)
          goEnd.setUTCDate(
            goEnd.getUTCDate() + Number(form.dias_direito) - Number(form.dias_vendidos) - 1,
          );
        const { error } = await db.from("funcionario_ferias").insert({
          tenant_id: tenantId,
          funcionario_id: employee.id,
          periodo_aquisitivo_inicio: form.periodo_aquisitivo_inicio,
          periodo_aquisitivo_fim: end.toISOString().slice(0, 10),
          periodo_concessivo_limite: limit.toISOString().slice(0, 10),
          dias_direito: Number(form.dias_direito),
          dias_vendidos: Number(form.dias_vendidos),
          data_inicio_gozo: go?.toISOString().slice(0, 10) || null,
          data_fim_gozo: goEnd?.toISOString().slice(0, 10) || null,
          venda_abono: Boolean(form.venda_abono),
          adianta_13: Boolean(form.adianta_13),
          status: go ? "agendadas" : "nao_vencidas",
          created_by: getCurrentUserId(),
        });
        if (error) throw error;
      }
      if (kind === "bank") {
        const { error } = await db.from("funcionario_dados_bancarios").insert({
          tenant_id: tenantId,
          funcionario_id: employee.id,
          tipo_recebimento: form.tipo_recebimento,
          banco_codigo: form.banco_codigo || null,
          banco_nome: form.banco_nome || null,
          agencia: form.agencia || null,
          agencia_dv: form.agencia_dv || null,
          conta: form.conta || null,
          conta_dv: form.conta_dv || null,
          tipo_conta: form.tipo_conta || null,
          chave_pix: form.tipo_recebimento === "pix" ? form.chave_pix : null,
          tipo_chave_pix: form.tipo_recebimento === "pix" ? form.tipo_chave_pix : null,
          titular_nome: form.titular_nome,
          titular_cpf: digits(String(form.titular_cpf)),
          justificativa_terceiro: form.justificativa_terceiro || null,
          vigente_de: today(),
          created_by: getCurrentUserId(),
        });
        if (error) throw error;
      }
      if (kind === "event") {
        const { error } = await db.from("funcionario_eventos_financeiros").insert({
          tenant_id: tenantId,
          operating_company_id: employee.operating_company_id,
          funcionario_id: employee.id,
          tipo_evento: form.tipo_evento,
          competencia: `${form.competencia}-01`,
          valor_bruto: Number(form.valor_bruto),
          valor_descontos: Number(form.valor_descontos),
          data_prevista_pagamento: form.data_prevista_pagamento,
          cost_center_id: employee.centro_custo_id,
          criado_por: getCurrentUserId(),
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(initialPosition ? "Cargo e salário atualizados." : "Registro incluído.");
      onSaved();
    },
    onError: (error) =>
      toast.error(getUserFacingError(error, "Não foi possível incluir o registro.")),
  });
  const input = (key: string, label: string, type = "text") => (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input
        type={type}
        value={String(form[key] ?? "")}
        onChange={(event) => set(key, event.target.value)}
      />
    </div>
  );
  return (
    <Dialog open onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {initialPosition ? "Editar " : "Adicionar "}
            {kind === "address"
              ? "endereço"
              : kind === "position"
                ? "cargo e salário"
                : kind === "vacation"
                  ? "período de férias"
                  : kind === "bank"
                    ? "dados bancários"
                    : "evento financeiro"}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {kind === "address" ? (
            <>
              {input("cep", "CEP *")}
              <Button
                className="self-end"
                variant="outline"
                onClick={() => cep.mutate()}
                disabled={cep.isPending}
              >
                <Search className="mr-1 size-4" />
                Buscar CEP
              </Button>
              {input("logradouro", "Logradouro *")}
              {input("numero", "Número *")}
              {input("complemento", "Complemento")}
              {input("bairro", "Bairro *")}
              {input("cidade", "Cidade *")}
              {input("uf", "UF *")}
            </>
          ) : null}
          {kind === "position" ? (
            <>
              {input("cargo", "Cargo *")}
              {input("nivel", "Nível")}
              <div>
                <Label>Salário base</Label>
                <FinancialCurrencyInput
                  value={Number(form.salario_base)}
                  onValueChange={(value) => set("salario_base", Number(value || 0))}
                />
              </div>
              {input("tipo_alteracao", "Tipo de alteração *")}
              {input("vigente_de", "Vigente desde", "date")}
              {initialPosition ? input("vigente_ate", "Vigente até", "date") : null}
              {input("motivo", "Motivo")}
            </>
          ) : null}
          {kind === "vacation" ? (
            <>
              {input("periodo_aquisitivo_inicio", "Início do período aquisitivo", "date")}
              {input("dias_direito", "Dias de direito", "number")}
              {input("dias_vendidos", "Dias vendidos", "number")}
              {input("data_inicio_gozo", "Início do gozo", "date")}
            </>
          ) : null}
          {kind === "bank" ? (
            <>
              <div>
                <Label>Forma de recebimento</Label>
                <Select
                  value={String(form.tipo_recebimento)}
                  onValueChange={(value) => set("tipo_recebimento", value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pix">PIX</SelectItem>
                    <SelectItem value="conta_corrente">Conta corrente</SelectItem>
                    <SelectItem value="conta_salario">Conta salário</SelectItem>
                    <SelectItem value="poupanca">Poupança</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.tipo_recebimento === "pix" ? (
                <>
                  {input("chave_pix", "Chave PIX *")}
                  <div>
                    <Label>Tipo da chave</Label>
                    <Select
                      value={String(form.tipo_chave_pix)}
                      onValueChange={(value) => set("tipo_chave_pix", value)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["cpf", "email", "telefone", "aleatoria"].map((value) => (
                          <SelectItem key={value} value={value}>
                            {value}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              ) : (
                <>
                  {input("banco_codigo", "Código do banco")}
                  {input("banco_nome", "Banco")}
                  {input("agencia", "Agência")}
                  {input("conta", "Conta")}
                </>
              )}
              {input("titular_nome", "Titular *")}
              {input("titular_cpf", "CPF do titular *")}
              {input("justificativa_terceiro", "Justificativa para terceiro")}
            </>
          ) : null}
          {kind === "event" ? (
            <>
              <div>
                <Label>Tipo de evento</Label>
                <Select
                  value={String(form.tipo_evento)}
                  onValueChange={(value) => set("tipo_evento", value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(eventLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {input("competencia", "Competência", "month")}
              <div>
                <Label>Valor bruto</Label>
                <FinancialCurrencyInput
                  value={Number(form.valor_bruto)}
                  onValueChange={(value) => set("valor_bruto", Number(value || 0))}
                />
              </div>
              <div>
                <Label>Descontos</Label>
                <FinancialCurrencyInput
                  value={Number(form.valor_descontos)}
                  onValueChange={(value) => set("valor_descontos", Number(value || 0))}
                />
              </div>
              {input("data_prevista_pagamento", "Previsão de pagamento", "date")}
            </>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="size-4 animate-spin" /> : null}Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Benefits({
  employee,
  benefits,
  documents,
  canEdit,
  canAttach,
  onChanged,
}: {
  employee: Employee;
  benefits: Benefit[];
  documents: BenefitDocument[];
  canEdit: boolean;
  canAttach: boolean;
  onChanged(): void;
}) {
  const [form, setForm] = useState({
    tipo_beneficio: "",
    vigente_de: today(),
    vigente_ate: "",
    valor: 0,
    observacao: "",
  });
  const [benefitId, setBenefitId] = useState("");
  const [history, setHistory] = useState("");
  const [file, setFile] = useState<File>();
  const create = useMutation({
    mutationFn: async () => {
      if (form.tipo_beneficio.trim().length < 2) throw new Error("Informe o tipo de benefício.");
      if (form.vigente_ate && form.vigente_ate < form.vigente_de)
        throw new Error("A data final não pode ser anterior à data inicial.");
      const tenant = await getMyTenantId();
      if (!tenant) throw new Error("Tenant não encontrado.");
      const { error } = await db.from("funcionario_beneficios").insert({
        tenant_id: tenant,
        funcionario_id: employee.id,
        tipo_beneficio: form.tipo_beneficio.trim(),
        vigente_de: form.vigente_de,
        vigente_ate: form.vigente_ate || null,
        valor: Number(form.valor),
        observacao: form.observacao.trim() || null,
        created_by: getCurrentUserId(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Benefício cadastrado.");
      setForm({
        tipo_beneficio: "",
        vigente_de: today(),
        vigente_ate: "",
        valor: 0,
        observacao: "",
      });
      onChanged();
    },
    onError: (error) => toast.error(getUserFacingError(error)),
  });
  const archive = useMutation({
    mutationFn: async (benefit: Benefit) => {
      if (!window.confirm(`Excluir o benefício ${benefit.tipo_beneficio}?`)) return false;
      const { error } = await db
        .from("funcionario_beneficios")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", benefit.id);
      if (error) throw error;
      return true;
    },
    onSuccess: (removed) => {
      if (!removed) return;
      toast.success("Benefício excluído.");
      onChanged();
    },
    onError: (error) => toast.error(getUserFacingError(error)),
  });
  const upload = useMutation({
    mutationFn: async () => {
      if (!benefitId || !file) throw new Error("Selecione o benefício e o arquivo.");
      const xlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      if (!["application/pdf", "image/jpeg", xlsx].includes(file.type))
        throw new Error("Envie um arquivo XLSX, PDF ou JPG.");
      if (file.size > 10485760) throw new Error("O arquivo deve ter no máximo 10 MB.");
      const tenant = await getMyTenantId();
      if (!tenant) throw new Error("Tenant não encontrado.");
      const id = crypto.randomUUID();
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${tenant}/${employee.id}/${benefitId}/${id}/${safe}`;
      const stored = await supabase.storage
        .from("funcionario-beneficios")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (stored.error) throw stored.error;
      const { error } = await db.from("funcionario_beneficio_documentos").insert({
        id,
        tenant_id: tenant,
        funcionario_id: employee.id,
        beneficio_id: benefitId,
        arquivo_url: path,
        arquivo_nome_original: file.name,
        arquivo_mime_type: file.type,
        arquivo_tamanho_bytes: file.size,
        historico: history.trim() || null,
        enviado_por: getCurrentUserId(),
      });
      if (error) {
        await supabase.storage.from("funcionario-beneficios").remove([path]);
        throw error;
      }
    },
    onSuccess: () => {
      toast.success("Documento do benefício anexado.");
      setFile(undefined);
      setHistory("");
      onChanged();
    },
    onError: (error) => toast.error(getUserFacingError(error)),
  });
  const openDocument = async (document: BenefitDocument) => {
    const { data, error } = await supabase.storage
      .from("funcionario-beneficios")
      .createSignedUrl(document.arquivo_url, 300);
    if (error) toast.error(getUserFacingError(error));
    else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };
  return (
    <div className="space-y-4">
      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Gift className="size-5 text-primary" />
              Novo benefício
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Label>Tipo de benefício *</Label>
              <Input
                value={form.tipo_beneficio}
                onChange={(e) => setForm({ ...form, tipo_beneficio: e.target.value })}
              />
            </div>
            <div>
              <Label>Vigente desde *</Label>
              <Input
                type="date"
                value={form.vigente_de}
                onChange={(e) => setForm({ ...form, vigente_de: e.target.value })}
              />
            </div>
            <div>
              <Label>Vigente até</Label>
              <Input
                type="date"
                value={form.vigente_ate}
                onChange={(e) => setForm({ ...form, vigente_ate: e.target.value })}
              />
            </div>
            <div>
              <Label>Valor</Label>
              <FinancialCurrencyInput
                value={form.valor}
                onValueChange={(value) => setForm({ ...form, valor: Number(value || 0) })}
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <Label>Observação</Label>
              <Input
                value={form.observacao}
                onChange={(e) => setForm({ ...form, observacao: e.target.value })}
              />
            </div>
            <Button
              className="self-end"
              onClick={() => create.mutate()}
              disabled={create.isPending}
            >
              Cadastrar benefício
            </Button>
          </CardContent>
        </Card>
      ) : null}
      {canAttach && benefits.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Anexar documento</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Label>Benefício</Label>
              <Select value={benefitId} onValueChange={setBenefitId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {benefits.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.tipo_beneficio}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Histórico do anexo</Label>
              <Input value={history} onChange={(e) => setHistory(e.target.value)} />
            </div>
            <div>
              <Label>Arquivo (XLSX, PDF ou JPG)</Label>
              <Input
                type="file"
                accept=".xlsx,.pdf,.jpg,.jpeg"
                onChange={(e) => setFile(e.target.files?.[0])}
              />
            </div>
            <Button
              className="self-end"
              onClick={() => upload.mutate()}
              disabled={upload.isPending}
            >
              <FileUp className="mr-1 size-4" />
              Anexar
            </Button>
          </CardContent>
        </Card>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {benefits.map((benefit) => {
          const attachments = documents.filter((document) => document.beneficio_id === benefit.id);
          return (
            <Card key={benefit.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{benefit.tipo_beneficio}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatCurrency(benefit.valor)} · {date(benefit.vigente_de)} até{" "}
                    {benefit.vigente_ate ? date(benefit.vigente_ate) : "atual"}
                  </p>
                  {benefit.observacao ? (
                    <p className="mt-1 text-xs text-muted-foreground">{benefit.observacao}</p>
                  ) : null}
                </div>
                {canEdit ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-destructive"
                    aria-label="Excluir benefício"
                    onClick={() => archive.mutate(benefit)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                ) : null}
              </div>
              {attachments.length ? (
                <div className="mt-3 space-y-1 border-t pt-3">
                  {attachments.map((document) => (
                    <button
                      key={document.id}
                      className="block w-full truncate text-left text-xs text-primary hover:underline"
                      onClick={() => void openDocument(document)}
                    >
                      {document.arquivo_nome_original}
                      {document.historico ? ` · ${document.historico}` : ""}
                    </button>
                  ))}
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>
      {!benefits.length ? (
        <EmptyState
          title="Nenhum benefício cadastrado"
          description="Os benefícios oferecidos ao funcionário aparecerão aqui."
        />
      ) : null}
    </div>
  );
}

function Documents({
  employee,
  documents,
  types,
  canEdit,
  canManageTypes,
  onChanged,
}: {
  employee: Employee;
  documents: Document[];
  types: DocType[];
  canEdit: boolean;
  canManageTypes: boolean;
  onChanged(): void;
}) {
  const [typeId, setTypeId] = useState("");
  const [file, setFile] = useState<File>();
  const [number, setNumber] = useState("");
  const [issued, setIssued] = useState("");
  const [valid, setValid] = useState("");
  const [newType, setNewType] = useState("");
  const addType = useMutation({
    mutationFn: async () => {
      if (newType.trim().length < 2) throw new Error("Informe o nome do tipo de documento.");
      const tenant = await getMyTenantId();
      if (!tenant) throw new Error("Tenant não encontrado.");
      const { error } = await db.from("funcionario_tipos_documento").insert({
        tenant_id: tenant,
        nome: newType.trim(),
        categoria: "outros",
        obrigatorio: false,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Tipo de documento criado.");
      setNewType("");
      onChanged();
    },
    onError: (error) => toast.error(getUserFacingError(error)),
  });
  const upload = useMutation({
    mutationFn: async () => {
      if (!file || !typeId) throw new Error("Selecione o tipo e o arquivo.");
      if (file.size > 10485760) throw new Error("O arquivo deve ter no máximo 10 MB.");
      if (!["application/pdf", "image/png", "image/jpeg"].includes(file.type))
        throw new Error("Envie PDF, PNG ou JPEG.");
      const tenant = await getMyTenantId();
      if (!tenant) throw new Error("Tenant não encontrado.");
      const id = crypto.randomUUID();
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${tenant}/${employee.id}/${id}/${safe}`;
      const stored = await supabase.storage
        .from("funcionario-documentos")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (stored.error) throw stored.error;
      const { error } = await db.from("funcionario_documentos").insert({
        id,
        tenant_id: tenant,
        funcionario_id: employee.id,
        tipo_documento_id: typeId,
        numero_documento: number || null,
        data_emissao: issued || null,
        data_validade: valid || null,
        arquivo_url: path,
        arquivo_nome_original: file.name,
        arquivo_mime_type: file.type,
        arquivo_tamanho_bytes: file.size,
        enviado_por: getCurrentUserId(),
      });
      if (error) {
        await supabase.storage.from("funcionario-documentos").remove([path]);
        throw error;
      }
    },
    onSuccess: () => {
      toast.success("Documento enviado.");
      setFile(undefined);
      onChanged();
    },
    onError: (error) => toast.error(getUserFacingError(error)),
  });
  const open = async (doc: Document) => {
    const { data, error } = await supabase.storage
      .from("funcionario-documentos")
      .createSignedUrl(doc.arquivo_url, 300);
    if (error) toast.error(getUserFacingError(error));
    else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };
  const typeMap = new Map(types.map((item) => [item.id, item]));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileCheck2 className="size-5 text-primary" />
          Checklist de documentos
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {canManageTypes ? (
          <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Label>Novo tipo de documento do tenant</Label>
              <Input
                value={newType}
                onChange={(event) => setNewType(event.target.value)}
                placeholder="Ex.: Certificação profissional"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => addType.mutate()}
              disabled={addType.isPending || !newType.trim()}
            >
              <Plus className="mr-1 size-4" />
              Criar tipo
            </Button>
          </div>
        ) : null}
        {canEdit ? (
          <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <Label>Tipo</Label>
              <Select value={typeId} onValueChange={setTypeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {types.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Número</Label>
              <Input value={number} onChange={(e) => setNumber(e.target.value)} />
            </div>
            <div>
              <Label>Emissão</Label>
              <Input type="date" value={issued} onChange={(e) => setIssued(e.target.value)} />
            </div>
            <div>
              <Label>Validade</Label>
              <Input type="date" value={valid} onChange={(e) => setValid(e.target.value)} />
            </div>
            <div>
              <Label>Arquivo</Label>
              <Input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                onChange={(e) => setFile(e.target.files?.[0])}
              />
            </div>
            <Button
              className="lg:col-start-5"
              onClick={() => upload.mutate()}
              disabled={upload.isPending}
            >
              <FileUp className="mr-1 size-4" />
              Enviar
            </Button>
          </div>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2">
          {documents.map((doc) => (
            <button
              key={doc.id}
              className="flex items-center justify-between rounded-lg border p-3 text-left hover:bg-muted/40"
              onClick={() => void open(doc)}
            >
              <div>
                <p className="font-medium">
                  {typeMap.get(doc.tipo_documento_id)?.nome || doc.arquivo_nome_original}
                </p>
                <p className="text-xs text-muted-foreground">
                  {doc.arquivo_nome_original} · validade {date(doc.data_validade)}
                </p>
              </div>
              <Badge variant={doc.status === "vencido" ? "destructive" : "outline"}>
                {doc.status}
              </Badge>
            </button>
          ))}
        </div>
        {!documents.length ? (
          <EmptyState
            title="Nenhum documento enviado"
            description="Se necessário, use o formulário acima para anexar um documento opcional."
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function PayrollPanel({
  employees,
  canPayroll,
  onChanged,
}: {
  employees: Employee[];
  canPayroll: boolean;
  onChanged(): void;
}) {
  const [competence, setCompetence] = useState(month());
  const [due, setDue] = useState(today());
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const events = useQuery({
    queryKey: ["payroll-events", competence],
    queryFn: async () => {
      const { data, error } = await db
        .from("funcionario_eventos_financeiros")
        .select("*")
        .eq("competencia", `${competence}-01`)
        .eq("tipo_evento", "pagamento_folha")
        .is("deleted_at", null);
      if (error) throw error;
      return (data ?? []) as Event[];
    },
  });
  const prepare = async () => {
    setBusy(true);
    try {
      const tenant = await getMyTenantId();
      if (!tenant) throw new Error("Tenant não encontrado.");
      const existing = new Set((events.data ?? []).map((item) => item.funcionario_id));
      const rows = employees
        .filter((item) => item.status === "ativo" && !existing.has(item.id))
        .map((item) => ({
          tenant_id: tenant,
          operating_company_id: item.operating_company_id,
          funcionario_id: item.id,
          tipo_evento: "pagamento_folha",
          competencia: `${competence}-01`,
          valor_bruto: Number(item.salario || 0),
          valor_descontos: 0,
          data_prevista_pagamento: due,
          cost_center_id: item.centro_custo_id,
          criado_por: getCurrentUserId(),
        }));
      if (rows.length) {
        const { error } = await db.from("funcionario_eventos_financeiros").insert(rows);
        if (error) throw error;
      }
      toast.success(`${rows.length} evento(s) preparado(s).`);
      await qc.invalidateQueries({ queryKey: ["payroll-events", competence] });
      onChanged();
    } catch (error) {
      toast.error(getUserFacingError(error));
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    setBusy(true);
    let sent = 0;
    try {
      for (const event of events.data ?? []) {
        if (!event.conta_pagar_id) {
          const { data, error } = await supabase.functions.invoke(
            "criar-lancamento-financeiro-funcionario",
            { body: { event_id: event.id } },
          );
          if (error) throw error;
          if (!data?.payable_id)
            throw new Error(
              "Um lançamento não pôde ser integrado. Revise os dados bancários e financeiros do funcionário.",
            );
          sent++;
        }
      }
      toast.success(`${sent} lançamento(s) enviado(s) ao contas a pagar.`);
      await qc.invalidateQueries({ queryKey: ["payroll-events", competence] });
    } catch (error) {
      toast.error(getUserFacingError(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Fechamento mensal da folha</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Prepare, revise e envie os pagamentos dos funcionários ativos ao Contas a Pagar.
          </p>
        </div>
        <ShieldCheck className="size-6 text-primary" />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[200px_200px_auto_auto]">
          <div>
            <Label>Competência</Label>
            <Input
              type="month"
              value={competence}
              onChange={(e) => setCompetence(e.target.value)}
            />
          </div>
          <div>
            <Label>Pagamento previsto</Label>
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <Button
            className="self-end"
            variant="outline"
            onClick={() => void prepare()}
            disabled={!canPayroll || busy}
          >
            <RefreshCw className="mr-1 size-4" />
            Preparar folha
          </Button>
          <Button
            className="self-end"
            onClick={() => void send()}
            disabled={!canPayroll || busy || !events.data?.length}
          >
            {busy ? (
              <Loader2 className="mr-1 size-4 animate-spin" />
            ) : (
              <Banknote className="mr-1 size-4" />
            )}
            Enviar ao financeiro
          </Button>
        </div>
        {events.isLoading ? (
          <LoadingState />
        ) : !events.data?.length ? (
          <EmptyState
            title="Folha ainda não preparada"
            description="Selecione a competência e prepare os eventos dos funcionários ativos."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Funcionário</TableHead>
                  <TableHead>Evento</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.data.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      {employees.find((employee) => employee.id === item.funcionario_id)
                        ?.nome_completo || "-"}
                    </TableCell>
                    <TableCell>{eventLabels[item.tipo_evento]}</TableCell>
                    <TableCell>{formatCurrency(item.valor_liquido)}</TableCell>
                    <TableCell>{date(item.data_prevista_pagamento)}</TableCell>
                    <TableCell>
                      <Badge
                        variant={item.status_integracao === "erro" ? "destructive" : "outline"}
                      >
                        {item.status_integracao}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
