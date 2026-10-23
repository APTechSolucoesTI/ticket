import { createFileRoute } from "@tanstack/react-router";
import { SettingsSection } from "@/components/settings/settings-section";

export const Route = createFileRoute("/_authenticated/settings/catalogs/departments")({
  head: () => ({ meta: [{ title: "Departamentos - Configurações - APTicket" }] }),
  component: () => <SettingsSection section="departments" />,
});
