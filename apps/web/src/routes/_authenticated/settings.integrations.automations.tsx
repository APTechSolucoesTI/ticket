import { createFileRoute } from "@tanstack/react-router";
import { SettingsSection } from "@/components/settings/settings-section";

export const Route = createFileRoute("/_authenticated/settings/integrations/automations")({
  head: () => ({ meta: [{ title: "Automações - Configurações - APTicket" }] }),
  component: () => <SettingsSection section="automations" />,
});
