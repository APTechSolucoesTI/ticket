import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/kb")({
  head: () => ({
    meta: [
      { title: "Base de Conhecimento" },
      { name: "description", content: "Artigos e tutoriais públicos para autoatendimento." },
    ],
  }),
  component: () => <Outlet />,
});
