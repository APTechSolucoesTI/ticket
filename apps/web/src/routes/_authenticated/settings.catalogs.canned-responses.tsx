import { createFileRoute } from "@tanstack/react-router";
import { SettingsSection } from "@/components/settings/settings-section";

export const Route = createFileRoute("/_authenticated/settings/catalogs/canned-responses")({
  head: () => ({ meta: [{ title: "Respostas Padrão - Configurações - APTicket" }] }),
  component: () => <SettingsSection section="canned" />,
});
