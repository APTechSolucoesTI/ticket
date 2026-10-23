import { createFileRoute } from "@tanstack/react-router";
import { SettingsSection } from "@/components/settings/settings-section";

export const Route = createFileRoute("/_authenticated/settings/catalogs/slas")({
  head: () => ({ meta: [{ title: "SLAs - Configurações - APTicket" }] }),
  component: () => <SettingsSection section="slas" />,
});
