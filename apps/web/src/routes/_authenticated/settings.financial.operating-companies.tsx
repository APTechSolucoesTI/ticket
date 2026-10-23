import { createFileRoute } from "@tanstack/react-router";
import { SettingsSection } from "@/components/settings/settings-section";

export const Route = createFileRoute("/_authenticated/settings/financial/operating-companies")({
  head: () => ({ meta: [{ title: "Empresa Operadora - Configurações - APTicket" }] }),
  component: () => <SettingsSection section="operating-companies" />,
});
