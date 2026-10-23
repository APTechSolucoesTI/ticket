import { createFileRoute } from "@tanstack/react-router";
import { SettingsSection } from "@/components/settings/settings-section";

export const Route = createFileRoute("/_authenticated/settings/financial/preferences")({
  head: () => ({ meta: [{ title: "Preferências financeiras - Configurações - APTicket" }] }),
  component: () => <SettingsSection section="financial" />,
});
