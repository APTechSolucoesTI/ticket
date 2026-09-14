import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/finance")({
  head: () => ({ meta: [{ title: "Financeiro - APTicket" }] }),
  component: FinanceLayout,
});

function FinanceLayout() {
  return (
    <div className="p-4 sm:p-6">
      <Outlet />
    </div>
  );
}
