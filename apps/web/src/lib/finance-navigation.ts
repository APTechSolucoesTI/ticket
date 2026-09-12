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
  { to: "/finance", label: "Visão geral", shortLabel: "Visão geral", icon: LayoutDashboard },
  {
    to: "/finance/receivables",
    label: "Contas a receber",
    shortLabel: "Receber",
    icon: BanknoteArrowDown,
  },
  {
    to: "/finance/payables",
    label: "Contas a pagar",
    shortLabel: "Pagar",
    icon: PackageSearch,
  },
  {
    to: "/finance/banking",
    label: "Banco e conciliação",
    shortLabel: "Banco",
    icon: Landmark,
  },
  {
    to: "/finance/cash-flow",
    label: "Fluxo de caixa",
    shortLabel: "Fluxo",
    icon: WalletCards,
  },
  {
    to: "/finance/planning",
    label: "Planejamento",
    shortLabel: "Planejar",
    icon: Target,
  },
  {
    to: "/finance/analytics",
    label: "Resultados",
    shortLabel: "Resultados",
    icon: ChartNoAxesCombined,
  },
  {
    to: "/finance/closing",
    label: "Fechamento",
    shortLabel: "Fechar",
    icon: CalendarCheck2,
  },
] as const;
