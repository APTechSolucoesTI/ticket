import { createFileRoute } from "@tanstack/react-router";
import { SettingsSection } from "@/components/settings/settings-section";

export const Route = createFileRoute("/_authenticated/settings/access/roles")({
  head: () => ({ meta: [{ title: "Papéis - Configurações - APTicket" }] }),
  component: () => <SettingsSection section="roles" />,
});
