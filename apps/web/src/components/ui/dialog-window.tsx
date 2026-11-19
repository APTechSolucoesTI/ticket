"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Maximize2, Minimize2, Minus, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";
import { cn } from "@/lib/utils";

import {
  getWindowSnapshot,
  getServerWindowSnapshot,
  subscribeWindows,
  registerWindowSurface,
  type DialogWindowController,
} from "./dialog-window-state";
/** Activity cleans up this registration while preserving the form subtree. */
export function DialogWindowSurface({
  id,
  contentRef,
}: {
  id: string;
  contentRef: React.RefObject<HTMLDivElement | null>;
}) {
  React.useLayoutEffect(() => {
    // Descendant layout effects precede attachment of the Content host ref.
    let disposed = false;
    let unregister = () => {};
    queueMicrotask(() => {
      if (!disposed && contentRef.current)
        unregister = registerWindowSurface(id, contentRef.current);
    });
    return () => {
      disposed = true;
      unregister();
    };
  }, [id, contentRef]);
  return null;
}
export function DialogWindowDock() {
  const state = React.useSyncExternalStore(
    subscribeWindows,
    getWindowSnapshot,
    getServerWindowSnapshot,
  );
  if (!state.docks.length) return null;
  const slot = state.surfaces.at(-1)?.element.querySelector("[data-dialog-dock-slot]");
  return createPortal(
    <nav
      aria-label="Cadastros minimizados"
      className={cn(
        "flex flex-wrap gap-2 p-2",
        slot
          ? "border-t bg-muted/50"
          : "fixed inset-x-2 bottom-2 z-50 max-h-[30dvh] overflow-y-auto rounded-lg border bg-card shadow-lg sm:inset-x-4 sm:bottom-4",
      )}
    >
      {state.docks.map((entry) => (
        <div
          key={entry.id}
          className="flex min-w-0 max-w-full items-center rounded-md border bg-card text-card-foreground shadow-sm"
        >
          <button
            type="button"
            data-dialog-restore={entry.id}
            aria-label={`Restaurar ${entry.title}`}
            title={`Restaurar ${entry.title}`}
            onClick={entry.restore}
            className="flex h-11 min-w-0 items-center gap-2 rounded-l-md px-3 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9"
          >
            <Maximize2 className="size-4 shrink-0" aria-hidden="true" />
            <span className="max-w-56 truncate">{entry.title}</span>
          </button>
          <button
            type="button"
            aria-label={`Fechar ${entry.title}`}
            title={`Fechar ${entry.title}`}
            onClick={entry.close}
            className="flex size-11 shrink-0 items-center justify-center rounded-r-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-9"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ))}
    </nav>,
    slot ?? document.body,
  );
}

export function DialogWindowHeader({
  state,
  showCloseButton,
}: {
  state: DialogWindowController;
  showCloseButton: boolean;
}) {
  const hint = React.useId();
  const controls = [
    { label: "Minimizar janela", icon: Minus, action: state.minimize },
    {
      label: state.maximized ? "Restaurar tamanho" : "Maximizar janela",
      icon: state.maximized ? Minimize2 : Maximize2,
      action: state.toggleMaximized,
    },
    ...(showCloseButton ? [{ label: "Fechar janela", icon: X, action: state.close }] : []),
  ];
  return (
    <div
      data-dialog-window-header=""
      role="group"
      aria-label={`Mover janela ${state.title}`}
      aria-describedby={hint}
      tabIndex={0}
      {...state.headerEvents}
      className="flex shrink-0 touch-none select-none items-center gap-3 bg-window-header px-3 py-1 text-window-header-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:cursor-move"
    >
      <span
        className="min-w-0 flex-1 truncate text-sm font-semibold"
        title={state.title}
        aria-hidden="true"
      >
        {state.title}
      </span>
      <span id={hint} className="sr-only">
        Arraste pelo cabeçalho ou use as setas para mover. Shift e setas movem mais rapidamente.
      </span>
      <TooltipProvider delayDuration={300}>
        <div className="flex shrink-0 items-center gap-1">
          {controls.map(({ label, icon: Icon, action }) => (
            <Tooltip key={label}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={label}
                  onClick={action}
                  className="flex size-11 items-center justify-center rounded-md hover:bg-window-header-foreground/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-current sm:size-8"
                >
                  <Icon className="size-4" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      </TooltipProvider>
    </div>
  );
}
