import { createFileRoute } from "@tanstack/react-router";
import { SettingsSection } from "@/components/settings/settings-section";

export const Route = createFileRoute("/_authenticated/settings/catalogs/service-families")({
  head: () => ({ meta: [{ title: "Família de Serviços - Configurações - APTicket" }] }),
  component: () => <SettingsSection section="service-families" />,
});
