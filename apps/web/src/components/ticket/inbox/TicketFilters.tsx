import type { RefObject } from "react";
import { ChevronDown, LayoutGrid, List, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { TicketChannel } from "@/components/ticket/ChannelIcon";
import type { TicketPriority } from "@/components/ticket/PriorityBadge";
import type { TicketStatus } from "@/components/ticket/TicketBadge";
import { CHANNEL_OPTIONS, PRIORITY_OPTIONS, STATUS_OPTIONS } from "@/lib/ticket-inbox";
import { cn } from "@/lib/utils";

export type TicketFilterState = {
  status: TicketStatus[];
  priority: TicketPriority[];
  assignee: string[];
  channel: TicketChannel[];
  department: string[];
  search: string;
};

export function TicketFilters({
  filters,
  onFiltersChange,
  departments,
  agents,
  view,
  onViewChange,
  canCreate,
  onCreate,
  triggerRef,
}: {
  filters: TicketFilterState;
  onFiltersChange: (filters: TicketFilterState) => void;
  departments: { id: string; name: string }[];
  agents: { id: string; name: string }[];
  view: "list" | "kanban";
  onViewChange: (view: "list" | "kanban") => void;
  canCreate: boolean;
  onCreate: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const set = <Key extends keyof TicketFilterState>(key: Key, value: TicketFilterState[Key]) =>
    onFiltersChange({ ...filters, [key]: value });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Label htmlFor="ticket-search" className="sr-only">
          Buscar tickets
        </Label>
        <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          id="ticket-search"
          value={filters.search}
          onChange={(event) => set("search", event.target.value)}
          placeholder="Buscar nº, assunto, cliente…"
          className="h-7 w-56 pl-7 text-xs"
        />
      </div>
      <MultiFilter
        triggerRef={triggerRef}
        label="Departamento"
        values={filters.department}
        onChange={(value) => set("department", value)}
        options={departments.map((department) => ({
          value: department.id,
          label: department.name,
        }))}
      />
      <MultiFilter
        label="Status"
        values={filters.status}
        onChange={(value) => set("status", value)}
        options={STATUS_OPTIONS}
      />
      <MultiFilter
        label="Prioridade"
        values={filters.priority}
        onChange={(value) => set("priority", value)}
        options={PRIORITY_OPTIONS}
      />
      <MultiFilter
        label="Técnico"
        values={filters.assignee}
        onChange={(value) => set("assignee", value)}
        options={agents.map((agent) => ({ value: agent.id, label: agent.name }))}
      />
      <MultiFilter
        label="Canal"
        values={filters.channel}
        onChange={(value) => set("channel", value)}
        options={CHANNEL_OPTIONS}
      />

      <div className="ml-auto flex items-center gap-1">
        <div className="flex rounded-md border p-0.5">
          <button
            type="button"
            onClick={() => onViewChange("list")}
            aria-pressed={view === "list"}
            aria-label="Exibir tickets em lista"
            className={cn(
              "flex h-6 items-center gap-1 rounded-sm px-2 text-xs",
              view === "list" && "bg-accent",
            )}
          >
            <List className="h-3 w-3" /> Lista
          </button>
          <button
            type="button"
            onClick={() => onViewChange("kanban")}
            aria-pressed={view === "kanban"}
            aria-label="Exibir tickets em kanban"
            className={cn(
              "flex h-6 items-center gap-1 rounded-sm px-2 text-xs",
              view === "kanban" && "bg-accent",
            )}
          >
            <LayoutGrid className="h-3 w-3" /> Kanban
          </button>
        </div>
        {canCreate && (
          <Button size="sm" className="h-7 gap-1 text-xs" onClick={onCreate}>
            <Plus className="h-3.5 w-3.5" /> Novo ticket
          </Button>
        )}
      </div>
    </div>
  );
}

function MultiFilter<T extends string>({
  label,
  values,
  onChange,
  options,
  triggerRef,
}: {
  label: string;
  values: T[];
  onChange: (values: T[]) => void;
  options: { value: T; label: string }[];
  triggerRef?: RefObject<HTMLButtonElement | null>;
}) {
  const toggle = (value: T) => {
    onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  };
  const summary = values.length === 0 ? `${label}: todos` : `${label}: ${values.length}`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          className="h-7 min-w-[140px] justify-between gap-2 px-2 text-xs font-normal"
        >
          <span className="truncate">{summary}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="start">
        <div className="flex items-center justify-between border-b px-2 py-1.5 text-xs">
          <span className="text-muted-foreground">
            {values.length === 0 ? "Todos" : `${values.length} selecionado(s)`}
          </span>
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => onChange(values.length > 0 ? [] : options.map((option) => option.value))}
          >
            {values.length > 0 ? "Limpar" : "Todos"}
          </button>
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          {options.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted"
            >
              <Checkbox
                checked={values.includes(option.value)}
                onCheckedChange={() => toggle(option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
