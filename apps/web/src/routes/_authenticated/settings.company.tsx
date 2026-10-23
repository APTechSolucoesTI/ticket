import { createFileRoute } from "@tanstack/react-router";
import { SettingsSection } from "@/components/settings/settings-section";

export const Route = createFileRoute("/_authenticated/settings/company")({
  head: () => ({ meta: [{ title: "Empresa - Configurações - APTicket" }] }),
  component: () => <SettingsSection section="company" />,
});
