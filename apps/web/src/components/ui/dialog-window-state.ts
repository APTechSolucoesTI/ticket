"use client";
import * as React from "react";
export const DialogStateContext = React.createContext({
  open: false,
  requestOpen: (_open: boolean) => {},
});
export const WindowTitleContext = React.createContext({
  enabled: false,
  setTitle: (_title: string) => {},
});

type DockEntry = { id: string; title: string; restore: () => void; close: () => void };
type Surface = { id: string; element: HTMLDivElement };
const emptySnapshot: { docks: DockEntry[]; surfaces: Surface[] } = { docks: [], surfaces: [] };
let snapshot = emptySnapshot;
const listeners = new Set<() => void>();
function publish(next: typeof snapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}
function removeDock(id: string) {
  if (snapshot.docks.some((entry) => entry.id === id))
    publish({ ...snapshot, docks: snapshot.docks.filter((entry) => entry.id !== id) });
}
function registerDock(entry: DockEntry) {
  const current = snapshot.docks.findIndex((item) => item.id === entry.id);
  const docks = [...snapshot.docks];
  if (current < 0) docks.push(entry);
  else docks[current] = entry;
  publish({ ...snapshot, docks });
  return () => removeDock(entry.id);
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getWindowSnapshot = () => snapshot;
export const getServerWindowSnapshot = () => emptySnapshot;
export const subscribeWindows = subscribe;
export function registerWindowSurface(id: string, element: HTMLDivElement) {
  publish({
    ...snapshot,
    surfaces: [...snapshot.surfaces.filter((item) => item.id !== id), { id, element }],
  });
  return () =>
    publish({ ...snapshot, surfaces: snapshot.surfaces.filter((item) => item.id !== id) });
}
type Point = { x: number; y: number };
const margin = 8;
function clampPosition(point: Point, element: HTMLElement): Point {
  return {
    x: Math.max(margin, Math.min(point.x, window.innerWidth - element.offsetWidth - margin)),
    y: Math.max(margin, Math.min(point.y, window.innerHeight - element.offsetHeight - margin)),
  };
}

export function useDialogWindow(contentRef: React.RefObject<HTMLDivElement | null>) {
  const { open, requestOpen } = React.useContext(DialogStateContext);
  const id = React.useId();
  const [title, setTitle] = React.useState("Cadastro");
  const [minimized, setMinimized] = React.useState(false);
  const [maximized, setMaximized] = React.useState(false);
  const [position, setPosition] = React.useState<Point | null>(null);
  const minimizedRef = React.useRef(minimized);
  minimizedRef.current = minimized;
  const lastField = React.useRef<HTMLElement | null>(null);
  const restoring = React.useRef(false);
  const drag = React.useRef<{ pointer: number; start: Point; origin: Point } | null>(null);

  React.useEffect(() => {
    if (!open) {
      setMinimized(false);
      setMaximized(false);
      setPosition(null);
      lastField.current = null;
    }
  }, [open]);

  const restore = React.useCallback(() => {
    restoring.current = true;
    setMinimized(false);
  }, []);
  React.useEffect(() => {
    if (!open || !minimized) return;
    return registerDock({ id, title, restore, close: () => requestOpen(false) });
  }, [id, open, minimized, title, restore, requestOpen]);

  React.useEffect(() => {
    if (!minimized) return;
    const frame = requestAnimationFrame(() => {
      // IDs are React-generated; compare attributes without building a CSS selector.
      const button = Array.from(
        document.querySelectorAll<HTMLElement>("[data-dialog-restore]"),
      ).find((item) => item.getAttribute("data-dialog-restore") === id);
      button?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [id, minimized]);

  React.useEffect(() => {
    const resize = () => {
      const element = contentRef.current;
      if (!element || minimized || maximized) return;
      setPosition((current) => (current ? clampPosition(current, element) : null));
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [contentRef, minimized, maximized]);

  React.useLayoutEffect(() => {
    if (minimized || maximized || !contentRef.current) return;
    const element = contentRef.current;
    setPosition((current) => {
      if (!current) return null;
      const next = clampPosition(current, element);
      return next.x === current.x && next.y === current.y ? current : next;
    });
  }, [contentRef, minimized, maximized]);

  const interactiveTarget = (target: EventTarget | null) =>
    target instanceof Element &&
    !!target.closest("button, a, input, select, textarea, [role=button]");
  const canMove = () => !maximized && window.innerWidth >= 640;
  const toggleMaximized = () => setMaximized((current) => !current);
  const headerEvents = {
    onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
      if (event.button !== 0 || !canMove() || interactiveTarget(event.target)) return;
      const rect = contentRef.current?.getBoundingClientRect();
      if (!rect) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {
        pointer: event.pointerId,
        start: { x: event.clientX, y: event.clientY },
        origin: { x: rect.x, y: rect.y },
      };
    },
    onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
      const current = drag.current;
      if (!current || current.pointer !== event.pointerId || !contentRef.current) return;
      setPosition(
        clampPosition(
          {
            x: current.origin.x + event.clientX - current.start.x,
            y: current.origin.y + event.clientY - current.start.y,
          },
          contentRef.current,
        ),
      );
    },
    onPointerUp() {
      drag.current = null;
    },
    onPointerCancel() {
      drag.current = null;
    },
    onLostPointerCapture() {
      drag.current = null;
    },
    onDoubleClick(event: React.MouseEvent<HTMLDivElement>) {
      if (!interactiveTarget(event.target) && window.innerWidth >= 640) toggleMaximized();
    },
    onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
      if (event.target !== event.currentTarget || !canMove() || !event.key.startsWith("Arrow"))
        return;
      const element = contentRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const step = event.shiftKey ? 48 : 16;
      event.preventDefault();
      setPosition(
        clampPosition(
          {
            x: rect.x + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0),
            y: rect.y + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0),
          },
          element,
        ),
      );
    },
  };
  const style: React.CSSProperties | undefined = maximized
    ? {
        left: margin,
        top: margin,
        width: "calc(100vw - 16px)",
        height: "calc(100dvh - 16px)",
        maxWidth: "none",
        maxHeight: "calc(100dvh - 16px)",
        transform: "none",
        translate: "none",
      }
    : position
      ? { left: position.x, top: position.y, transform: "none", translate: "none" }
      : undefined;
  return {
    id,
    title,
    setTitle,
    minimized,
    minimizedRef,
    maximized,
    style,
    headerEvents,
    toggleMaximized,
    minimize: () => setMinimized(true),
    close: () => requestOpen(false),
    rememberFocus(event: React.FocusEvent<HTMLDivElement>) {
      if (
        event.target instanceof HTMLElement &&
        !event.target.closest("[data-dialog-window-header]")
      )
        lastField.current = event.target;
    },
    restoreFocus(event: Event) {
      if (restoring.current) {
        restoring.current = false;
        if (lastField.current?.isConnected) {
          event.preventDefault();
          lastField.current.focus();
        }
      }
    },
  };
}

export type DialogWindowController = ReturnType<typeof useDialogWindow>;
