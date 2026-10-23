import { createFileRoute } from "@tanstack/react-router";
import { SettingsSection } from "@/components/settings/settings-section";

export const Route = createFileRoute("/_authenticated/settings/access/permissions")({
  head: () => ({ meta: [{ title: "Permissões - Configurações - APTicket" }] }),
  component: () => <SettingsSection section="user-permissions" />,
});
