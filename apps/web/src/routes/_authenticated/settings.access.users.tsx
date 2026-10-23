import { createFileRoute } from "@tanstack/react-router";
import { SettingsSection } from "@/components/settings/settings-section";

export const Route = createFileRoute("/_authenticated/settings/access/users")({
  head: () => ({ meta: [{ title: "Usuários - Configurações - APTicket" }] }),
  component: () => <SettingsSection section="users" />,
});
