import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Landmark, ShieldCheck, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useModulePermissions } from "@/lib/permission-ui";
import { listInterSettings, saveInterSettings } from "@/lib/inter-settings.functions";
import {
  interSettingsSchema,
  type InterSettingsInput,
  type InterSettingsMetadata,
} from "@/lib/inter-settings.schema";

export function InterTab() {
  const access = useModulePermissions("empresa");
  const list = useServerFn(listInterSettings);
  const [environment, setEnvironment] = useState<"sandbox" | "production">("sandbox");
  const query = useQuery({ queryKey: ["inter-settings"], queryFn: () => list() });
  const current = query.data?.find((item) => item.environment === environment);
  return (
    <div className="max-w-4xl space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Landmark className="size-6 text-primary" />
            <div>
              <CardTitle>Banco Inter</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Credenciais bancárias exclusivas deste tenant.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <ShieldCheck className="mr-2 inline size-4 text-primary" />
            Segredos criptografados no servidor. Salvar ou selecionar um ambiente não emite boletos
            nem movimenta a conta.
          </div>
          <Tabs
            value={environment}
            onValueChange={(value) => setEnvironment(value as typeof environment)}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="sandbox">Homologação</TabsTrigger>
              <TabsTrigger value="production">Produção / Oficial</TabsTrigger>
            </TabsList>
          </Tabs>
          {query.isPending ? (
            <p role="status" className="flex gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" />
              Carregando configuração…
            </p>
          ) : query.isError ? (
            <div role="alert" className="space-y-2 text-sm">
              <p>Não foi possível carregar a configuração.</p>
              <Button variant="outline" onClick={() => void query.refetch()}>
                Tentar novamente
              </Button>
            </div>
          ) : (
            <InterForm
              key={`${environment}-${current?.version ?? 0}`}
              environment={environment}
              current={current}
              canEdit={access.edit}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function InterForm({
  environment,
  current,
  canEdit,
}: {
  environment: "sandbox" | "production";
  current?: InterSettingsMetadata;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const save = useServerFn(saveInterSettings);
  const [fileNames, setFileNames] = useState<Record<string, string>>({});
  const [reading, setReading] = useState(false);
  const form = useForm<InterSettingsInput>({
    resolver: zodResolver(interSettingsSchema),
    defaultValues: {
      environment,
      account: current?.account ?? "",
      clientId: "",
      clientSecret: "",
      certificate: "",
      privateKey: "",
      activate: current?.is_active ?? false,
      productionConfirmation: false,
      version: current?.version ?? 0,
    },
  });
  const mutation = useMutation({
    gcTime: 0,
    mutationFn: (data: InterSettingsInput) => save({ data }),
    onSuccess: async () => {
      form.reset({
        ...form.getValues(),
        clientId: "",
        clientSecret: "",
        certificate: "",
        privateKey: "",
        productionConfirmation: false,
      });
      setFileNames({});
      toast.success("Configuração do Inter salva com segurança.");
      await queryClient.invalidateQueries({ queryKey: ["inter-settings"] });
    },
    onError: (error: Error) => toast.error(error.message || "Não foi possível salvar."),
  });
  const busy = mutation.isPending || reading;
  const error = (field: keyof InterSettingsInput) => form.formState.errors[field]?.message;
  async function upload(field: "certificate" | "privateKey", file?: File) {
    if (!file) return;
    form.setValue(field, "", { shouldDirty: true });
    setFileNames((previous) => ({ ...previous, [field]: "Nenhum arquivo válido selecionado." }));
    if (file.size > 32768) {
      form.setError(field, { message: "Arquivo maior que 32 KB." });
      return;
    }
    setReading(true);
    let text: string;
    try {
      text = await file.text();
    } catch {
      form.setError(field, { message: "Não foi possível ler o arquivo. Selecione-o novamente." });
      return;
    } finally {
      setReading(false);
    }
    if (!text.includes(field === "certificate" ? "BEGIN CERTIFICATE" : "PRIVATE KEY")) {
      form.setError(field, { message: "Selecione um arquivo PEM válido (.crt/.pem ou .key)." });
      return;
    }
    form.clearErrors(field);
    form.setValue(field, text, { shouldDirty: true });
    setFileNames((previous) => ({ ...previous, [field]: file.name }));
  }
  return (
    <form onSubmit={form.handleSubmit((data) => mutation.mutate(data))} className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">
            {environment === "sandbox" ? "Ambiente de homologação" : "Ambiente oficial"}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {environment === "sandbox"
              ? "Use as credenciais de testes fornecidas pelo Inter."
              : "Use somente as credenciais da conta bancária oficial deste tenant."}
          </p>
        </div>
        <Badge variant={current?.is_active ? "default" : "outline"}>
          {current?.is_active
            ? "Ambiente selecionado"
            : current
              ? "Configurado"
              : "Não configurado"}
        </Badge>
      </div>
      {!canEdit && (
        <p role="status" className="rounded-md border p-3 text-sm">
          Somente leitura. Solicite permissão de edição de Empresa para configurar a integração.
        </p>
      )}
      <fieldset disabled={!canEdit || busy} className="space-y-4 disabled:opacity-70">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="inter-account">Conta corrente com dígito</Label>
            <Input
              id="inter-account"
              inputMode="numeric"
              autoComplete="off"
              {...form.register("account")}
              aria-invalid={!!error("account")}
            />
            <p className="text-xs text-muted-foreground">Somente números, sem zeros à esquerda.</p>
            <FieldError message={error("account")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="inter-client">Client ID</Label>
            <Input
              id="inter-client"
              type="password"
              autoComplete="new-password"
              placeholder={
                current ? "Configurado. Em branco mantém o atual." : "Informe o Client ID"
              }
              {...form.register("clientId")}
              aria-invalid={!!error("clientId")}
            />
            <FieldError message={error("clientId")} />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="inter-secret">Client Secret</Label>
          <Input
            id="inter-secret"
            type="password"
            autoComplete="new-password"
            placeholder={
              current ? "Configurado. Em branco mantém o atual." : "Informe o Client Secret"
            }
            {...form.register("clientSecret")}
            aria-invalid={!!error("clientSecret")}
          />
          <FieldError message={error("clientSecret")} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {(["certificate", "privateKey"] as const).map((field) => (
            <div key={field} className="min-w-0 rounded-lg border p-3">
              <Label className="mb-2 block" htmlFor={`inter-${field}`}>
                {field === "certificate"
                  ? "Certificado (.crt / .pem)"
                  : "Chave privada (.key / .pem)"}
              </Label>
              <label
                className={`inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus-within:ring-2 focus-within:ring-ring ${!canEdit || busy ? "opacity-60" : "cursor-pointer"}`}
              >
                <Upload className="size-4" />
                Selecionar arquivo
                <input
                  id={`inter-${field}`}
                  type="file"
                  className="sr-only"
                  accept={field === "certificate" ? ".crt,.pem" : ".key,.pem"}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    void upload(field, file);
                  }}
                />
              </label>
              <p className="mt-2 break-all text-xs text-muted-foreground">
                {fileNames[field] ??
                  (current
                    ? "Armazenado com segurança. Envie o par somente para substituir."
                    : "Nenhum arquivo selecionado. Máximo: 32 KB.")}
              </p>
              <FieldError message={error(field)} />
            </div>
          ))}
        </div>
        {current && (
          <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            <p>
              Certificado válido até{" "}
              {new Date(current.certificate_expires_at).toLocaleDateString("pt-BR")}.
            </p>
            <p className="mt-1 break-all">
              Impressão digital SHA-256: {current.certificate_fingerprint}
            </p>
          </div>
        )}
        <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
          <input type="checkbox" className="mt-1" {...form.register("activate")} />
          <span>
            Selecionar este ambiente como padrão do tenant
            <span className="mt-1 block text-xs text-muted-foreground">
              O outro ambiente será desmarcado, mas manterá suas credenciais.
            </span>
          </span>
        </label>
        {environment === "production" && form.watch("activate") && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1"
                {...form.register("productionConfirmation")}
              />
              <span>
                Confirmo que estou selecionando o ambiente oficial e conferi a conta e as
                credenciais.
              </span>
            </label>
            <FieldError message={error("productionConfirmation")} />
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="max-w-lg text-xs text-muted-foreground">
            Esta etapa salva a configuração e valida o par de arquivos. A conexão com o banco e a
            emissão de boletos serão integradas na próxima etapa.
          </p>
          <Button type="submit">
            {busy && <Loader2 className="size-4 animate-spin" />}Salvar configuração
          </Button>
        </div>
      </fieldset>
    </form>
  );
}

function FieldError({ message }: { message?: string }) {
  return message ? (
    <p role="alert" className="mt-1 text-xs text-destructive">
      {message}
    </p>
  ) : null;
}
