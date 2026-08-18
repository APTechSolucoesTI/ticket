import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RichTextEditor } from "@/components/rich-text-editor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type PerformedService = { provided_service_id: string; name: string; complement: string };
export type FinalReport = {
  resolution_summary: string;
  resolution_diagnosis: string;
  services: Array<{ provided_service_id: string; complement: string }>;
};

type RemoteService = { id: string; code: string; description: string };

/**
 * Laudo final — required before a ticket can move to "resolved" or "closed"
 * (also enforced server-side by a CHECK constraint on tickets, and the
 * remote-only rule on ticket_services_performed by a trigger — this dialog
 * isn't the only gate, just the friendly one).
 */
export function FinalizeTicketDialog({
  status,
  ticketSubject,
  onCancel,
  onConfirm,
  submitting,
}: {
  status: "resolved" | "closed";
  ticketSubject: string;
  onCancel: () => void;
  onConfirm: (report: FinalReport) => void;
  submitting?: boolean;
}) {
  const [subject, setSubject] = useState(ticketSubject);
  const [diagnosis, setDiagnosis] = useState("");
  const [services, setServices] = useState<PerformedService[]>([]);
  const [pickService, setPickService] = useState("");
  const [pickComplement, setPickComplement] = useState("");

  // Only "Suporte Remoto" services are offered here — this laudo is the
  // remote-support one. Backend (trigger) re-checks this on save either way.
  const { data: remoteServices = [] } = useQuery({
    queryKey: ["provided_services", "remote_active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provided_services")
        .select("id, code, description")
        .eq("includes_remote", true)
        .eq("is_active", true)
        .order("description");
      if (error) throw error;
      return data as RemoteService[];
    },
  });

  const canSubmit = subject.trim().length > 0 && diagnosis.trim().length > 0;

  const addService = () => {
    if (!pickService) return;
    const svc = remoteServices.find((s) => s.id === pickService);
    if (!svc) return;
    setServices((prev) => [
      ...prev,
      { provided_service_id: svc.id, name: svc.description, complement: pickComplement.trim() },
    ]);
    setPickService("");
    setPickComplement("");
  };

  const removeService = (idx: number) => setServices((prev) => prev.filter((_, i) => i !== idx));

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-2xl w-[95vw] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Laudo final — {status === "closed" ? "fechar" : "resolver"} ticket
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">
          Obrigatório para finalizar o atendimento. Fica registrado no ticket.
        </p>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Assunto/Solicitação *</Label>
            <Input
              autoFocus
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Vem preenchido com o assunto do ticket — ajuste se precisar"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Diagnóstico das ações realizadas *</Label>
            <RichTextEditor value={diagnosis} onChange={setDiagnosis} />
          </div>

          <div className="space-y-2">
            <Label>Serviços executados (Suporte Remoto)</Label>
            <div className="flex gap-2">
              <Select value={pickService} onValueChange={setPickService}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Selecione um serviço…" />
                </SelectTrigger>
                <SelectContent>
                  {remoteServices.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      Nenhum serviço de Suporte Remoto cadastrado
                    </div>
                  ) : (
                    remoteServices.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.description}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" onClick={addService} disabled={!pickService}>
                Adicionar
              </Button>
            </div>
            <Textarea
              rows={2}
              value={pickComplement}
              onChange={(e) => setPickComplement(e.target.value)}
              placeholder="Complemento do serviço executado (opcional)"
            />

            {services.length > 0 && (
              <div className="space-y-1.5 pt-1">
                {services.map((s, i) => (
                  <div
                    key={`${s.provided_service_id}-${i}`}
                    className="flex items-start justify-between gap-2 rounded-md border bg-muted/30 p-2 text-xs"
                  >
                    <div>
                      <div className="font-medium">{s.name}</div>
                      {s.complement && (
                        <div className="mt-0.5 whitespace-pre-wrap text-muted-foreground">
                          {s.complement}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeService(i)}
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label="Remover serviço"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={submitting}>
            Cancelar
          </Button>
          <Button
            onClick={() =>
              onConfirm({
                resolution_summary: subject.trim(),
                resolution_diagnosis: diagnosis.trim(),
                services: services.map((s) => ({
                  provided_service_id: s.provided_service_id,
                  complement: s.complement,
                })),
              })
            }
            disabled={!canSubmit || submitting}
          >
            {submitting ? "Salvando…" : "Confirmar e finalizar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
