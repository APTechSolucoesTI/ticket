import { createFileRoute } from "@tanstack/react-router";
import { SettingsSection } from "@/components/settings/settings-section";

export const Route = createFileRoute("/_authenticated/settings/catalogs/provided-services")({
  head: () => ({ meta: [{ title: "Serviços Prestados - Configurações - APTicket" }] }),
  component: () => <SettingsSection section="provided-services" />,
});
