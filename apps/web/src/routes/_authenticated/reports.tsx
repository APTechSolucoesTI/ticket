import { createFileRoute } from "@tanstack/react-router";
import { EmptyStub, PageHeader } from "@/components/empty-stub";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "Relatórios - APTicket" }] }),
  component: () => (
    <div className="p-6 space-y-4">
      <PageHeader title="Relatórios" subtitle="Volume, horas apontadas, consumo de franquia e CSAT." />
      <EmptyStub title="Sem dados para o período" message="Os relatórios começam a popular assim que os primeiros tickets e apontamentos forem registrados." />
    </div>
  ),
});
