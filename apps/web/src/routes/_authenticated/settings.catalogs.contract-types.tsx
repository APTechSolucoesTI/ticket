import { createFileRoute } from "@tanstack/react-router";
import { SettingsSection } from "@/components/settings/settings-section";

export const Route = createFileRoute("/_authenticated/settings/catalogs/contract-types")({
  head: () => ({ meta: [{ title: "Tipos de Contratos - Configurações - APTicket" }] }),
  component: () => <SettingsSection section="contract-types" />,
});
