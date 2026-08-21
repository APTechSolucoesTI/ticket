/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, type ReactNode } from "react";
import { Eye } from "lucide-react";
import { usePermissions } from "@/lib/use-permissions";

export type PermissionAction = "view" | "create" | "edit" | "delete";

export function useModulePermissions(module: string) {
  const permissions = usePermissions();
  return {
    loading: permissions.loading,
    view: permissions.has(module, "view"),
    create: permissions.has(module, "create"),
    edit: permissions.has(module, "edit"),
    delete: permissions.has(module, "delete"),
    has: (action: PermissionAction) => permissions.has(module, action),
  };
}

const ReadOnlyContext = createContext(false);
const ModuleContext = createContext<string | null>(null);

export function ModulePermissionProvider({
  module,
  children,
}: {
  module: string;
  children: ReactNode;
}) {
  return <ModuleContext.Provider value={module}>{children}</ModuleContext.Provider>;
}

export function useCurrentModulePermissions() {
  const module = useContext(ModuleContext);
  if (!module) throw new Error("ModulePermissionProvider ausente");
  return useModulePermissions(module);
}

export function ReadOnlyProvider({
  readOnly,
  children,
}: {
  readOnly: boolean;
  children: ReactNode;
}) {
  return <ReadOnlyContext.Provider value={readOnly}>{children}</ReadOnlyContext.Provider>;
}

export function useReadOnly() {
  return useContext(ReadOnlyContext);
}

export function ReadOnlyNotice({ show = true }: { show?: boolean }) {
  if (!show) return null;
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-md border border-border bg-muted/45 px-3 py-2 text-xs text-muted-foreground"
    >
      <Eye className="h-3.5 w-3.5 shrink-0" />
      Modo de leitura. Você não tem permissão para editar este cadastro.
    </div>
  );
}
