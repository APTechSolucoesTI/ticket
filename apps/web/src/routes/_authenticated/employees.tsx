import { createFileRoute } from "@tanstack/react-router";
import { EmployeesPage } from "@/components/employees-page";

export const Route = createFileRoute("/_authenticated/employees")({
  component: EmployeesPage,
});
