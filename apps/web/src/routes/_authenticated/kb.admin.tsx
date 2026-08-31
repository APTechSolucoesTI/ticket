import { createFileRoute } from "@tanstack/react-router";
import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Pencil,
  Trash2,
  FileText,
  FolderTree,
  Paperclip,
  Link as LinkIcon,
  X,
  Upload,
  ExternalLink,
  Eye,
} from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUserId } from "@/lib/session";
import { getMyTenantId } from "@/lib/tenant";
import { PageHeader, EmptyStub } from "@/components/empty-stub";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RichTextEditor } from "@/components/rich-text-editor";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfigurableTable, type ListColumn } from "@/components/configurable-table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ReadOnlyNotice, ReadOnlyProvider, useModulePermissions } from "@/lib/permission-ui";

export const Route = createFileRoute("/_authenticated/kb/admin")({
  head: () => ({ meta: [{ title: "Base de Conhecimento - APTicket" }] }),
  component: KbAdminPage,
});

type Category = { id: string; name: string; slug: string; parent_id: string | null };
type Article = {
  id: string;
  category_id: string | null;
  title: string;
  slug: string;
  body: string;
  is_public: boolean;
  status: "draft" | "published";
  published_at: string | null;
  attachments?: ArticleAttachment[] | null;
};

type ArticleAttachment = { path: string; name: string; size: number; type: string };

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

async function getTenantId() {
  const data = { tenant_id: await getMyTenantId() };
  if (!data?.tenant_id) throw new Error("Tenant não encontrado");
  return data.tenant_id;
}

function KbAdminPage() {
  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Base de Conhecimento"
        subtitle="Categorias e artigos públicos ou restritos."
      />
      <Tabs defaultValue="articles">
        <TabsList>
          <TabsTrigger value="articles">
            <FileText className="h-4 w-4 mr-1" /> Artigos
          </TabsTrigger>
          <TabsTrigger value="categories">
            <FolderTree className="h-4 w-4 mr-1" /> Categorias
          </TabsTrigger>
        </TabsList>
        <TabsContent value="articles" className="mt-4">
          <ArticlesTab />
        </TabsContent>
        <TabsContent value="categories" className="mt-4">
          <CategoriesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ============================ CATEGORIES ============================ */

const categorySchema = z.object({
  name: z.string().trim().min(1, "Nome obrigatório").max(100),
  slug: z.string().trim().min(1).max(100),
  parent_id: z.string().uuid().nullable(),
});

function CategoriesTab() {
  const access = useModulePermissions("base_conhecimento");
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [toDelete, setToDelete] = useState<Category | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["kb_categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("kb_categories").select("*").order("name");
      if (error) throw error;
      return data as Category[];
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("kb_categories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Categoria removida");
      qc.invalidateQueries({ queryKey: ["kb_categories"] });
      setToDelete(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      {access.create && (
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-1" /> Nova categoria
          </Button>
        </div>
      )}

      {isLoading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Carregando…</Card>
      ) : !data?.length ? (
        <EmptyStub
          title="Nenhuma categoria"
          message="Crie categorias para organizar os artigos da base de conhecimento."
        />
      ) : (
        <Card className="p-3">
          <ConfigurableTable<Category>
            listKey="kb-categories"
            rows={data}
            rowKey={(c) => c.id}
            columns={
              [
                { key: "name", label: "Nome", className: "font-medium", cell: (c) => c.name },
                {
                  key: "slug",
                  label: "Slug",
                  className: "text-xs font-mono text-muted-foreground",
                  cell: (c) => c.slug,
                },
                {
                  key: "parent",
                  label: "Pai",
                  className: "text-sm",
                  cell: (c) => data.find((p) => p.id === c.parent_id)?.name || "-",
                },
              ] as ListColumn<Category>[]
            }
            rowActions={(c) => (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setEditing(c);
                    setOpen(true);
                  }}
                >
                  {access.edit ? <Pencil className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                {access.delete && (
                  <Button variant="ghost" size="icon" onClick={() => setToDelete(c)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </>
            )}
          />
        </Card>
      )}

      <CategoryDialog
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        categories={data ?? []}
      />

      {access.delete && (
        <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remover categoria?</AlertDialogTitle>
              <AlertDialogDescription>
                Artigos vinculados ficarão sem categoria. <b>{toDelete?.name}</b> será removida.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => toDelete && del.mutate(toDelete.id)}>
                Remover
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

function CategoryDialog({
  open,
  onOpenChange,
  editing,
  categories,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: Category | null;
  categories: Category[];
}) {
  const access = useModulePermissions("base_conhecimento");
  const readOnly = editing ? !access.edit : !access.create;
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", slug: "", parent_id: "" as string });

  useEffect(() => {
    if (!open) return;
    setForm({
      name: editing?.name ?? "",
      slug: editing?.slug ?? "",
      parent_id: editing?.parent_id ?? "",
    });
  }, [open, editing]);

  const save = useMutation({
    mutationFn: async (payload: z.infer<typeof categorySchema>) => {
      if (editing && !access.edit) throw new Error("Sem permissão para editar artigos");
      if (!editing && !access.create) throw new Error("Sem permissão para criar artigos");
      const tenant_id = await getTenantId();
      const values = { name: payload.name, slug: payload.slug, parent_id: payload.parent_id };
      if (editing) {
        const { error } = await supabase.from("kb_categories").update(values).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("kb_categories").insert({ ...values, tenant_id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Categoria atualizada" : "Categoria criada");
      qc.invalidateQueries({ queryKey: ["kb_categories"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ReadOnlyProvider readOnly={readOnly}>
        <DialogContent>
          <ReadOnlyNotice show={readOnly} />
          <DialogHeader>
            <DialogTitle>{editing ? "Editar categoria" : "Nova categoria"}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const r = categorySchema.safeParse({
                name: form.name,
                slug: form.slug || slugify(form.name),
                parent_id: form.parent_id || null,
              });
              if (!r.success) {
                toast.error(r.error.issues[0].message);
                return;
              }
              if (!readOnly) save.mutate(r.data);
            }}
          >
            <div>
              <Label>Nome *</Label>
              <Input
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    name: e.target.value,
                    slug: f.slug && editing ? f.slug : slugify(e.target.value),
                  }))
                }
              />
            </div>
            <div>
              <Label>Slug</Label>
              <Input
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: slugify(e.target.value) })}
              />
            </div>
            <div>
              <Label>Categoria pai</Label>
              <Select
                value={form.parent_id || "none"}
                onValueChange={(v) => setForm({ ...form, parent_id: v === "none" ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">- Nenhuma -</SelectItem>
                  {categories
                    .filter((c) => c.id !== editing?.id)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              {!readOnly && (
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? "Salvando…" : "Salvar"}
                </Button>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </ReadOnlyProvider>
    </Dialog>
  );
}

/* ============================ ARTICLES ============================ */

const attachmentSchema = z.object({
  path: z.string(),
  name: z.string(),
  size: z.number(),
  type: z.string(),
});

const articleSchema = z.object({
  title: z.string().trim().min(1, "Título obrigatório").max(200),
  slug: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1, "Conteúdo obrigatório").max(50000),
  category_id: z.string().uuid().nullable(),
  is_public: z.boolean(),
  status: z.enum(["draft", "published"]),
  attachments: z.array(attachmentSchema),
});

function ArticlesTab() {
  const access = useModulePermissions("base_conhecimento");
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Article | null>(null);
  const [toDelete, setToDelete] = useState<Article | null>(null);

  const { data: categories } = useQuery({
    queryKey: ["kb_categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("kb_categories").select("*").order("name");
      if (error) throw error;
      return data as Category[];
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["kb_articles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kb_articles")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as Article[];
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("kb_articles").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Artigo removido");
      qc.invalidateQueries({ queryKey: ["kb_articles"] });
      setToDelete(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      {access.create && (
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-1" /> Novo artigo
          </Button>
        </div>
      )}

      {isLoading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Carregando…</Card>
      ) : !data?.length ? (
        <EmptyStub
          title="Nenhum artigo publicado"
          message="Crie artigos para reduzir o volume de chamados repetitivos via deflexão."
        />
      ) : (
        <Card className="p-3">
          <ConfigurableTable<Article>
            listKey="kb-articles"
            rows={data}
            rowKey={(a) => a.id}
            columns={
              [
                {
                  key: "title",
                  label: "Título",
                  className: "font-medium",
                  cell: (a) => (
                    <>
                      <div>{a.title}</div>
                      <div className="text-xs font-mono text-muted-foreground">/{a.slug}</div>
                    </>
                  ),
                },
                {
                  key: "category",
                  label: "Categoria",
                  className: "text-sm",
                  cell: (a) => categories?.find((c) => c.id === a.category_id)?.name || "-",
                },
                {
                  key: "visibility",
                  label: "Visibilidade",
                  cell: (a) => (
                    <Badge variant={a.is_public ? "default" : "secondary"}>
                      {a.is_public ? "Pública" : "Restrita"}
                    </Badge>
                  ),
                },
                {
                  key: "status",
                  label: "Status",
                  cell: (a) => (
                    <Badge variant={a.status === "published" ? "default" : "outline"}>
                      {a.status === "published" ? "Publicado" : "Rascunho"}
                    </Badge>
                  ),
                },
              ] as ListColumn<Article>[]
            }
            rowActions={(a) => (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setEditing(a);
                    setOpen(true);
                  }}
                >
                  {access.edit ? <Pencil className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                {access.delete && (
                  <Button variant="ghost" size="icon" onClick={() => setToDelete(a)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </>
            )}
          />
        </Card>
      )}

      <ArticleDialog
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        categories={categories ?? []}
      />

      {access.delete && (
        <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remover artigo?</AlertDialogTitle>
              <AlertDialogDescription>
                <b>{toDelete?.title}</b> será removido permanentemente.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => toDelete && del.mutate(toDelete.id)}>
                Remover
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

function ArticleDialog({
  open,
  onOpenChange,
  editing,
  categories,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: Article | null;
  categories: Category[];
}) {
  const access = useModulePermissions("base_conhecimento");
  const readOnly = editing ? !access.edit : !access.create;
  const qc = useQueryClient();
  const [form, setForm] = useState({
    title: "",
    slug: "",
    body: "",
    category_id: "" as string,
    is_public: true,
    status: "draft" as "draft" | "published",
    attachments: [] as ArticleAttachment[],
  });
  const [uploading, setUploading] = useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;
    setForm({
      title: editing?.title ?? "",
      slug: editing?.slug ?? "",
      body: editing?.body ?? "",
      category_id: editing?.category_id ?? "",
      is_public: editing?.is_public ?? true,
      status: editing?.status ?? "draft",
      attachments: (editing?.attachments as ArticleAttachment[] | null) ?? [],
    });
  }, [open, editing]);

  const handleUpload = async (files: FileList | null) => {
    if (readOnly) return;
    if (!files?.length) return;
    setUploading(true);
    try {
      const tenant_id = await getTenantId();
      const added: ArticleAttachment[] = [];
      for (const file of Array.from(files)) {
        if (file.size > 20 * 1024 * 1024) {
          toast.error(`${file.name}: máximo 20MB`);
          continue;
        }
        const safe = file.name.replace(/[^\w.-]+/g, "_");
        const path = `${tenant_id}/${editing?.id ?? "drafts"}/${Date.now()}-${safe}`;
        const { error } = await supabase.storage
          .from("kb-attachments")
          .upload(path, file, { upsert: false });
        if (error) {
          toast.error(error.message);
          continue;
        }
        added.push({ path, name: file.name, size: file.size, type: file.type });
      }
      if (added.length) setForm((f) => ({ ...f, attachments: [...f.attachments, ...added] }));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeAttachment = async (att: ArticleAttachment) => {
    if (readOnly) return;
    await supabase.storage.from("kb-attachments").remove([att.path]);
    setForm((f) => ({ ...f, attachments: f.attachments.filter((a) => a.path !== att.path) }));
  };

  const getSignedUrl = async (att: ArticleAttachment) => {
    const { data, error } = await supabase.storage
      .from("kb-attachments")
      .createSignedUrl(att.path, 60 * 60 * 24 * 7);
    if (error || !data) {
      toast.error("Falha ao gerar link");
      return null;
    }
    return data.signedUrl;
  };

  const openAttachment = async (att: ArticleAttachment) => {
    const url = await getSignedUrl(att);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  const copyLink = async (att: ArticleAttachment) => {
    const url = await getSignedUrl(att);
    if (!url) return;
    await navigator.clipboard.writeText(url);
    toast.success("Link copiado (válido por 7 dias)");
  };

  const save = useMutation({
    mutationFn: async (payload: z.infer<typeof articleSchema>) => {
      if (editing && !access.edit) throw new Error("Sem permissão para editar artigos");
      if (!editing && !access.create) throw new Error("Sem permissão para criar artigos");
      const tenant_id = await getTenantId();
      const values = {
        title: payload.title,
        slug: payload.slug,
        body: payload.body,
        category_id: payload.category_id,
        is_public: payload.is_public,
        status: payload.status,
        attachments: payload.attachments,
        published_at:
          payload.status === "published"
            ? (editing?.published_at ?? new Date().toISOString())
            : null,
      };
      if (editing) {
        const { error } = await supabase.from("kb_articles").update(values).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("kb_articles").insert({
          ...values,
          tenant_id,
          created_by: getCurrentUserId(),
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Artigo atualizado" : "Artigo criado");
      qc.invalidateQueries({ queryKey: ["kb_articles"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ReadOnlyProvider readOnly={readOnly}>
        <DialogContent className="max-w-6xl w-[95vw] max-h-[95vh] p-0 flex flex-col gap-0">
          <ReadOnlyNotice show={readOnly} />
          <DialogHeader className="px-6 pt-5 pb-3 border-b shrink-0">
            <DialogTitle>{editing ? "Editar artigo" : "Novo artigo"}</DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col flex-1 min-h-0"
            onSubmit={(e) => {
              e.preventDefault();
              const r = articleSchema.safeParse({
                title: form.title,
                slug: form.slug || slugify(form.title),
                body: form.body,
                category_id: form.category_id || null,
                is_public: form.is_public,
                status: form.status,
                attachments: form.attachments,
              });
              if (!r.success) {
                toast.error(r.error.issues[0].message);
                return;
              }
              if (!readOnly) save.mutate(r.data);
            }}
          >
            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 grid grid-cols-4 gap-3">
              <div className="col-span-2">
                <Label>Título *</Label>
                <Input
                  value={form.title}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      title: e.target.value,
                      slug: f.slug && editing ? f.slug : slugify(e.target.value),
                    }))
                  }
                />
              </div>
              <div>
                <Label>Categoria</Label>
                <Select
                  value={form.category_id || "none"}
                  onValueChange={(v) => setForm({ ...form, category_id: v === "none" ? "" : v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">- Sem categoria -</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(v: "draft" | "published") => setForm({ ...form, status: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Rascunho</SelectItem>
                    <SelectItem value="published">Publicado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label>Slug</Label>
                <Input
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: slugify(e.target.value) })}
                />
              </div>
              <div className="col-span-2 flex items-center justify-between rounded-md border px-3 py-1.5">
                <div>
                  <div className="text-sm font-medium">Artigo público</div>
                  <div className="text-xs text-muted-foreground">
                    Acessível no portal sem autenticação.
                  </div>
                </div>
                <Switch
                  checked={form.is_public}
                  onCheckedChange={(v) => setForm({ ...form, is_public: v })}
                />
              </div>
              <div className="col-span-4">
                <Label>Conteúdo *</Label>
                <RichTextEditor
                  value={form.body}
                  onChange={(html) => setForm({ ...form, body: html })}
                />
              </div>
              <div className="col-span-4 space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-2">
                    <Paperclip className="h-4 w-4" /> Anexos
                  </Label>
                  {!readOnly && (
                    <div>
                      <input
                        ref={fileRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => handleUpload(e.target.files)}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={uploading}
                        onClick={() => fileRef.current?.click()}
                      >
                        <Upload className="h-3.5 w-3.5 mr-1" />{" "}
                        {uploading ? "Enviando…" : "Adicionar arquivo"}
                      </Button>
                    </div>
                  )}
                </div>
                {form.attachments.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nenhum anexo. Máx 20MB por arquivo.
                  </p>
                ) : (
                  <ul className="rounded-md border divide-y">
                    {form.attachments.map((a) => (
                      <li
                        key={a.path}
                        className="flex items-center justify-between gap-2 p-2 text-sm"
                      >
                        <button
                          type="button"
                          onClick={() => openAttachment(a)}
                          className="min-w-0 flex-1 truncate text-left text-primary hover:underline"
                          title="Abrir anexo"
                        >
                          <span className="font-medium">{a.name}</span>
                          <span className="text-xs text-muted-foreground ml-2">
                            {(a.size / 1024).toFixed(1)} KB
                          </span>
                        </button>
                        {!readOnly && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => openAttachment(a)}
                            title="Abrir"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => copyLink(a)}
                          title="Copiar link"
                        >
                          <LinkIcon className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeAttachment(a)}
                          title="Remover"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <DialogFooter className="px-6 py-3 border-t shrink-0">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              {!readOnly && (
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? "Salvando…" : "Salvar"}
                </Button>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </ReadOnlyProvider>
    </Dialog>
  );
}
