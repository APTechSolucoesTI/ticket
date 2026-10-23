import { createFileRoute } from "@tanstack/react-router";
import { SettingsSection } from "@/components/settings/settings-section";

export const Route = createFileRoute("/_authenticated/settings/integrations/channels")({
  head: () => ({ meta: [{ title: "Canais - Configurações - APTicket" }] }),
  component: () => <SettingsSection section="channels" />,
});
