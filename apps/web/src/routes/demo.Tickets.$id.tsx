import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Paperclip, Play, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ChannelIcon, type TicketChannel } from "@/components/ticket/ChannelIcon";
import { PriorityBadge, type TicketPriority } from "@/components/ticket/PriorityBadge";
import { TicketBadge, type TicketStatus } from "@/components/ticket/TicketBadge";
import { SlaTimer } from "@/components/ticket/SlaTimer";
import { cn } from "@/lib/utils";
import { demoTickets } from "@/lib/demo-seed";
import { toast } from "sonner";

export const Route = createFileRoute("/demo/Tickets/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `Ticket #${params.id} - Demo APTicket` },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: ({ params }) => {
    const t = demoTickets.find((x) => x.id === params.id);
    if (!t) throw notFound();
    return t;
  },
  component: DemoTicketDetail,
  notFoundComponent: () => (
    <div className="p-6 text-sm">
      Ticket não encontrado.{" "}
      <Link to="/demo/Tickets" className="text-primary underline">Voltar</Link>
    </div>
  ),
});

const SLA_DEFAULT_MIN = 240;

type DemoMsg = {
  id: string;
  author: string;
  authorType: "agent" | "contact" | "system";
  content: string;
  isInternal: boolean;
  createdAt: string;
};

function buildTimeline(subject: string, company: string, agent: string): DemoMsg[] {
  const now = Date.now();
  const at = (m: number) => new Date(now - m * 60_000).toISOString();
  return [
    { id: "m1", author: "Sistema",           authorType: "system",  content: `Ticket criado a partir do canal padrão.`, isInternal: false, createdAt: at(180) },
    { id: "m2", author: `Contato · ${company}`, authorType: "contact", content: `Olá, ${subject.toLowerCase()}. Podem verificar com urgência?`, isInternal: false, createdAt: at(170) },
    { id: "m3", author: agent,               authorType: "agent",   content: `Recebi o chamado. Iniciando o diagnóstico agora.`, isInternal: false, createdAt: at(90) },
    { id: "m4", author: agent,               authorType: "agent",   content: `Nota interna: cliente já teve incidente similar semana passada - verificar histórico do equipamento.`, isInternal: true, createdAt: at(60) },
    { id: "m5", author: `Contato · ${company}`, authorType: "contact", content: `Obrigado, no aguardo.`, isInternal: false, createdAt: at(30) },
  ];
}

function DemoTicketDetail() {
  const t = Route.useLoaderData();
  const status = (t.status === "open" ? "new" : t.status) as TicketStatus;
  const channel = (t.channel === "phone" ? "chat" : t.channel) as TicketChannel;
  const priority = t.priority as TicketPriority;

  const [messages, setMessages] = useState<DemoMsg[]>(() => buildTimeline(t.subject, t.companyName, t.assigneeName));
  const [draft, setDraft] = useState("");
  const [internal, setInternal] = useState(false);
  const [running, setRunning] = useState(false);
  const [spent, setSpent] = useState(t.minutes_spent);

  const send = () => {
    if (!draft.trim()) return;
    setMessages((prev) => [
      ...prev,
      { id: `m${prev.length + 1}`, author: t.assigneeName, authorType: "agent", content: draft.trim(), isInternal: internal, createdAt: new Date().toISOString() },
    ]);
    setDraft("");
    toast.success(internal ? "Nota interna adicionada (demo)" : "Resposta enviada (demo)");
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-background px-3 py-2">
        <div className="flex items-center gap-2">
          <Link to="/demo/Tickets" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Voltar
          </Link>
          <span className="font-mono text-xs text-muted-foreground">#{t.number}</span>
          <h1 className="text-sm font-semibold">{t.subject}</h1>
        </div>
        <div className="flex items-center gap-2">
          <ChannelIcon channel={channel} withLabel />
          <PriorityBadge priority={priority} />
          <TicketBadge status={status} />
        </div>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-3 overflow-hidden p-3 lg:grid-cols-[1fr_320px]">
        {/* Timeline + composer */}
        <div className="flex min-h-0 flex-col rounded-md border bg-background">
          <div className="flex-1 space-y-3 overflow-auto p-3">
            {messages.map((m) => (
              <div key={m.id} className={cn(
                "rounded-md border p-3 text-sm",
                m.authorType === "system" && "bg-muted/40 text-xs text-muted-foreground",
                m.isInternal && "border-yellow-500/40 bg-yellow-500/10",
                m.authorType === "agent" && !m.isInternal && "bg-primary/5",
              )}>
                <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {m.author}
                    {m.isInternal && <span className="ml-2 rounded bg-yellow-500/20 px-1.5 py-0.5 text-[10px] font-medium text-yellow-700 dark:text-yellow-400">Nota interna</span>}
                  </span>
                  <span>{new Date(m.createdAt).toLocaleString("pt-BR")}</span>
                </div>
                <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
              </div>
            ))}
          </div>

          <div className="border-t p-3">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={internal ? "Escrever nota interna (visível apenas para a equipe)…" : "Responder ao cliente…"}
              className={cn("min-h-[72px] text-sm", internal && "bg-yellow-500/5")}
            />
            <div className="mt-2 flex items-center justify-between">
              <div className="flex items-center gap-3 text-xs">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
                  Nota interna
                </label>
                <button className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={() => toast.info("Anexos disponíveis no sistema real")}>
                  <Paperclip className="h-3.5 w-3.5" /> Anexar
                </button>
              </div>
              <Button size="sm" className="h-7 gap-1 text-xs" onClick={send}>
                <Send className="h-3.5 w-3.5" /> Enviar
              </Button>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-3 overflow-auto">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs">SLA de resolução</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-xs">
              <SlaTimer dueAt={t.sla_due} totalMinutes={SLA_DEFAULT_MIN} stoppedAt={null} className="text-sm font-medium" />
              <div className="text-muted-foreground">Vence em {new Date(t.sla_due).toLocaleString("pt-BR")}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs">Time tracking</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Tempo apontado</span>
                <span className="font-mono text-sm">{spent} min</span>
              </div>
              <Button
                size="sm"
                variant={running ? "destructive" : "default"}
                className="h-7 w-full gap-1 text-xs"
                onClick={() => {
                  if (running) { setSpent((s: number) => s + 5); toast.success("Cronômetro parado (+5 min demo)"); }
                  else toast.info("Cronômetro iniciado (demo)");
                  setRunning((r) => !r);
                }}
              >
                <Play className="h-3.5 w-3.5" /> {running ? "Parar" : "Iniciar atendimento"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs">Cliente</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-xs">
              <div className="font-medium text-sm">{t.companyName}</div>
              <div className="text-muted-foreground">{t.contact}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs">Atribuído</CardTitle></CardHeader>
            <CardContent className="text-xs">
              <div className="font-medium">{t.assigneeName}</div>
              <div className="text-muted-foreground">Técnico responsável</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs">Detalhes</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-xs">
              <Row label="Criado em" value={new Date(t.created_at).toLocaleString("pt-BR")} />
              <Row label="Canal" value={channel} />
              <Row label="Prioridade" value={priority} />
              <Row label="Status" value={status} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
