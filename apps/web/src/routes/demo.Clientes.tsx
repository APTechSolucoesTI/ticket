import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, MapPin } from "lucide-react";
import { demoCompanies } from "@/lib/demo-seed";

export const Route = createFileRoute("/demo/Clientes")({
  head: () => ({ meta: [{ title: "Clientes - Demo APTicket" }, { name: "robots", content: "noindex" }] }),
  component: DemoClientes,
});

function DemoClientes() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Clientes</h1>
        <p className="text-sm text-muted-foreground">Empresas atendidas por este MSP.</p>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground bg-muted/40">
              <tr className="text-left">
                <th className="py-2 px-4">Empresa</th>
                <th className="py-2 px-4">CNPJ</th>
                <th className="py-2 px-4">Localidade</th>
                <th className="py-2 px-4">Contatos</th>
                <th className="py-2 px-4">Tickets abertos</th>
                <th className="py-2 px-4">Plano</th>
              </tr>
            </thead>
            <tbody>
              {demoCompanies.map((c) => (
                <tr key={c.id} className="border-t hover:bg-muted/20">
                  <td className="py-2 px-4 font-medium flex items-center gap-2">
                    <Building2 className="size-4 text-muted-foreground" /> {c.name}
                  </td>
                  <td className="py-2 px-4 font-mono text-xs">{c.cnpj}</td>
                  <td className="py-2 px-4 text-muted-foreground flex items-center gap-1">
                    <MapPin className="size-3.5" /> {c.city} / {c.uf}
                  </td>
                  <td className="py-2 px-4">{c.contatos}</td>
                  <td className="py-2 px-4">
                    {c.tickets_abertos > 0
                      ? <Badge variant="destructive">{c.tickets_abertos}</Badge>
                      : <span className="text-muted-foreground">0</span>}
                  </td>
                  <td className="py-2 px-4"><Badge variant="outline">{c.plano}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
