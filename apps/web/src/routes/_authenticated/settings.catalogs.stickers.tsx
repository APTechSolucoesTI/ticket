import { createFileRoute } from "@tanstack/react-router";
import { SettingsSection } from "@/components/settings/settings-section";

export const Route = createFileRoute("/_authenticated/settings/catalogs/stickers")({
  head: () => ({ meta: [{ title: "Figurinhas - Configurações - APTicket" }] }),
  component: () => <SettingsSection section="stickers" />,
});
