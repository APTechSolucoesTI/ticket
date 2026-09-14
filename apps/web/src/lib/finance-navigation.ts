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
  { to: "/finance", label: "Visão geral", icon: LayoutDashboard },
  {
    to: "/finance/receivables",
    label: "Contas a receber",
    icon: BanknoteArrowDown,
  },
  {
    to: "/finance/payables",
    label: "Contas a pagar",
    icon: PackageSearch,
  },
  {
    to: "/finance/banking",
    label: "Banco e conciliação",
    icon: Landmark,
  },
  {
    to: "/finance/cash-flow",
    label: "Fluxo de caixa",
    icon: WalletCards,
  },
  {
    to: "/finance/planning",
    label: "Planejamento",
    icon: Target,
  },
  {
    to: "/finance/analytics",
    label: "Resultados",
    icon: ChartNoAxesCombined,
  },
  {
    to: "/finance/closing",
    label: "Fechamento",
    icon: CalendarCheck2,
  },
] as const;
