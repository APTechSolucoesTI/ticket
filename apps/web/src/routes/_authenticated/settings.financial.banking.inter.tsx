import { createFileRoute } from "@tanstack/react-router";
import { SettingsSection } from "@/components/settings/settings-section";

export const Route = createFileRoute("/_authenticated/settings/financial/banking/inter")({
  head: () => ({ meta: [{ title: "Banco Inter - Configurações - APTicket" }] }),
  component: () => <SettingsSection section="inter" />,
});
