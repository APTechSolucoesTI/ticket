// Mock data para o modo demonstração — nada é persistido no Supabase.
import { addDays, format, subDays } from "date-fns";

const now = new Date();
const iso = (d: Date) => d.toISOString();
const d = (offset: number) => format(addDays(now, offset), "yyyy-MM-dd");

export const demoTenant = { id: "demo", name: "MSP Demonstração" };

export const demoCompanies = [
  { id: "c1", name: "Padaria Central Ltda",   cnpj: "12.345.678/0001-90", city: "São Paulo",   uf: "SP", contatos: 4, tickets_abertos: 3, plano: "Growth" },
  { id: "c2", name: "Contabilidade Silva",     cnpj: "98.765.432/0001-10", city: "Campinas",    uf: "SP", contatos: 2, tickets_abertos: 1, plano: "Starter" },
  { id: "c3", name: "TransLog Cargas SA",      cnpj: "45.678.912/0001-33", city: "Curitiba",    uf: "PR", contatos: 7, tickets_abertos: 5, plano: "MSP Pro" },
  { id: "c4", name: "Clínica Bem Estar",       cnpj: "23.456.789/0001-77", city: "Belo Horizonte", uf: "MG", contatos: 3, tickets_abertos: 0, plano: "Growth" },
  { id: "c5", name: "Escola Novo Saber",       cnpj: "34.567.890/0001-55", city: "Porto Alegre", uf: "RS", contatos: 5, tickets_abertos: 2, plano: "Growth" },
  { id: "c6", name: "AutoPeças Rápidas",       cnpj: "56.789.012/0001-88", city: "Recife",      uf: "PE", contatos: 2, tickets_abertos: 1, plano: "Starter" },
];

export const demoAgents = [
  { id: "a1", name: "Rafael Mendes",  cor: "#0EA5E9" },
  { id: "a2", name: "Camila Torres",  cor: "#8B5CF6" },
  { id: "a3", name: "Diego Alves",    cor: "#10B981" },
  { id: "a4", name: "Juliana Prado",  cor: "#F59E0B" },
];

type Status = "open" | "in_progress" | "pending" | "resolved" | "closed";
type Priority = "low" | "medium" | "high" | "urgent";
type Channel = "email" | "whatsapp" | "portal" | "phone";

const subjects = [
  "E-mail corporativo não sincroniza",
  "Impressora fiscal com erro 33",
  "VPN caiu no home office",
  "Servidor lento após update",
  "Backup falhou nas últimas 3 noites",
  "Wi-Fi instável no 2º andar",
  "Notebook do diretor não liga",
  "Erro no ERP ao emitir NF-e",
  "Solicitação de novo usuário AD",
  "Câmeras de segurança sem gravar",
  "Sistema de ponto travando",
  "Firewall bloqueando WhatsApp Web",
];

const statuses: Status[] = ["open","in_progress","in_progress","pending","open","in_progress","resolved","pending","open","closed","in_progress","open"];
const priorities: Priority[] = ["high","urgent","medium","low","medium","high","low","urgent","medium","low","high","medium"];
const channels: Channel[] = ["email","whatsapp","portal","email","whatsapp","portal","email","phone","portal","email","whatsapp","email"];

export const demoTickets = subjects.map((subject, i) => {
  const company = demoCompanies[i % demoCompanies.length];
  const agent = demoAgents[i % demoAgents.length];
  const created = subDays(now, i % 9);
  return {
    id: `t${i + 1}`,
    number: 1024 + i,
    subject,
    status: statuses[i],
    priority: priorities[i],
    channel: channels[i],
    company_id: company.id,
    companyName: company.name,
    assigned_to: agent.id,
    assigneeName: agent.name,
    created_at: iso(created),
    sla_due: iso(addDays(created, 1)),
    minutes_spent: (i * 37) % 240,
    contact: `contato${i + 1}@${company.name.split(" ")[0].toLowerCase()}.com.br`,
  };
});

// Últimos 14 dias — volume de tickets criados x resolvidos
export const demoVolume14d = Array.from({ length: 14 }).map((_, i) => {
  const day = subDays(now, 13 - i);
  const criados = 3 + ((i * 7) % 9);
  const resolvidos = Math.max(1, criados - ((i * 3) % 4));
  return { date: format(day, "dd/MM"), criados, resolvidos };
});

export const demoStatusBreakdown = [
  { status: "Abertos",       count: demoTickets.filter(t => t.status === "open").length,        color: "#0EA5E9" },
  { status: "Em atendimento", count: demoTickets.filter(t => t.status === "in_progress").length, color: "#8B5CF6" },
  { status: "Pendentes",     count: demoTickets.filter(t => t.status === "pending").length,     color: "#F59E0B" },
  { status: "Resolvidos",    count: demoTickets.filter(t => t.status === "resolved").length,    color: "#10B981" },
];

export const demoContracts = [
  { id: "k1", company: "Padaria Central Ltda",   tipo: "Suporte Mensal",  horas_contratadas: 20, horas_utilizadas: 14, sla_horas: 4,  ativo: true, vencimento: d(45) },
  { id: "k2", company: "Contabilidade Silva",    tipo: "Sob Demanda",     horas_contratadas: 10, horas_utilizadas: 3,  sla_horas: 8,  ativo: true, vencimento: d(120) },
  { id: "k3", company: "TransLog Cargas SA",     tipo: "24x7 Premium",    horas_contratadas: 80, horas_utilizadas: 61, sla_horas: 1,  ativo: true, vencimento: d(20) },
  { id: "k4", company: "Clínica Bem Estar",      tipo: "Suporte Mensal",  horas_contratadas: 15, horas_utilizadas: 2,  sla_horas: 4,  ativo: true, vencimento: d(90) },
  { id: "k5", company: "Escola Novo Saber",      tipo: "Projeto",         horas_contratadas: 40, horas_utilizadas: 38, sla_horas: 8,  ativo: true, vencimento: d(10) },
  { id: "k6", company: "AutoPeças Rápidas",      tipo: "Suporte Mensal",  horas_contratadas: 10, horas_utilizadas: 9,  sla_horas: 4,  ativo: false, vencimento: d(-5) },
];

export const demoKPIs = {
  ticketsAbertos: demoTickets.filter(t => t.status !== "closed" && t.status !== "resolved").length,
  slaEmRisco: 3,
  mttrHoras: 5.2,
  contratosAtivos: demoContracts.filter(c => c.ativo).length,
};
