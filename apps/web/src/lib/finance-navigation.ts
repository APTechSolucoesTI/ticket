import {
  BanknoteArrowDown,
  CalendarCheck2,
  ChartNoAxesCombined,
  Landmark,
  LayoutDashboard,
  PackageSearch,
  Target,
  WalletCards,
} from "lucide-react";

export const financeNavigation = [
  { to: "/finance", label: "Visão geral", icon: LayoutDashboard, module: "financeiro" },
  {
    to: "/finance/receivables",
    label: "Contas a receber",
    icon: BanknoteArrowDown,
    module: "financeiro_contas_receber",
  },
  {
    to: "/finance/payables",
    label: "Contas a pagar",
    icon: PackageSearch,
    module: "financeiro_contas_pagar",
  },
  {
    to: "/finance/banking",
    label: "Banco e conciliação",
    icon: Landmark,
    module: "financeiro_bancos",
  },
  {
    to: "/finance/cash-flow",
    label: "Fluxo de caixa",
    icon: WalletCards,
    module: "financeiro_fluxo_caixa",
  },
  {
    to: "/finance/planning",
    label: "Planejamento",
    icon: Target,
    module: "financeiro_planejamento",
  },
  {
    to: "/finance/analytics",
    label: "Resultados",
    icon: ChartNoAxesCombined,
    module: "financeiro_resultados",
  },
  {
    to: "/finance/closing",
    label: "Fechamento",
    icon: CalendarCheck2,
    module: "financeiro_fechamento",
  },
] as const;
