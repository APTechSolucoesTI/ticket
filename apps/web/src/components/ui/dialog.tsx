"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { DialogWindowHeader, DialogWindowSurface } from "./dialog-window";
import { DialogStateContext, WindowTitleContext, useDialogWindow } from "./dialog-window-state";
import { DialogResourcesContext, useDialogResources } from "./dialog-resources";
export { DialogWindowDock } from "./dialog-window";

function Dialog({
  open,
  defaultOpen = false,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const currentOpen = open ?? internalOpen;
  const requestOpen = React.useCallback(
    (next: boolean) => {
      if (open === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [open, onOpenChange],
  );
  return (
    <DialogStateContext.Provider value={{ open: currentOpen, requestOpen }}>
      <DialogPrimitive.Root {...props} open={currentOpen} onOpenChange={requestOpen} />
    </DialogStateContext.Provider>
  );
}

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

type DialogContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  windowControls?: boolean;
  showCloseButton?: boolean;
};

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(
  (
    {
      className,
      children,
      windowControls = true,
      showCloseButton = true,
      style,
      onOpenAutoFocus,
      onCloseAutoFocus,
      onFocusCapture,
      ...props
    },
    ref,
  ) => {
    const contentRef = React.useRef<HTMLDivElement | null>(null);
    const state = useDialogWindow(contentRef);
    const { open } = React.useContext(DialogStateContext);
    const resources = useDialogResources(open, state.minimizedRef);
    const assignRef = React.useCallback(
      (element: HTMLDivElement | null) => {
        contentRef.current = element;
        if (typeof ref === "function") ref(element);
        else if (ref) ref.current = element;
      },
      [ref],
    );
    const titleContext = React.useMemo(
      () => ({ enabled: windowControls, setTitle: state.setTitle }),
      [windowControls, state.setTitle],
    );
    return (
      <DialogResourcesContext.Provider value={resources}>
        <WindowTitleContext.Provider value={titleContext}>
          <React.Activity mode={state.minimized && windowControls ? "hidden" : "visible"}>
            <DialogPortal>
              <DialogOverlay />
              <DialogPrimitive.Content
                ref={assignRef}
                className={cn(
                  "fixed left-[50%] top-[50%] z-50 grid max-h-[calc(100dvh-2rem)] min-w-0 w-[calc(100vw-2rem)] max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 overflow-x-hidden overflow-y-auto border bg-background p-6 text-sm shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:rounded-lg [&>*]:min-w-0",
                  className,
                  windowControls &&
                    "flex flex-col gap-0 overflow-hidden p-0 transition-none motion-reduce:animate-none",
                )}
                {...props}
                data-dialog-window={windowControls ? "" : undefined}
                // Hidden portal hosts remain mounted. Keep them out of an
                // ancestor modal's aria-hidden bookkeeping until reactivation.
                aria-live={state.minimized && windowControls ? "off" : props["aria-live"]}
                style={{ ...style, ...(windowControls ? state.style : {}) }}
                onFocusCapture={(event) => {
                  onFocusCapture?.(event);
                  state.rememberFocus(event);
                }}
                onOpenAutoFocus={(event) => {
                  onOpenAutoFocus?.(event);
                  if (!event.defaultPrevented) state.restoreFocus(event);
                }}
                onCloseAutoFocus={(event) => {
                  // Activity cleans up modal effects without closing the caller's form.
                  if (state.minimizedRef.current) event.preventDefault();
                  else onCloseAutoFocus?.(event);
                }}
              >
                {windowControls ? (
                  <>
                    <DialogWindowHeader state={state} showCloseButton={showCloseButton} />
                    <div
                      className={cn(
                        "grid min-h-0 min-w-0 flex-1 gap-4 overflow-x-hidden overflow-y-auto p-6",
                        className,
                        "relative! inset-auto! m-0! w-full! max-w-none! max-h-none! h-auto! translate-none! transform-none! rounded-none! border-0! shadow-none!",
                      )}
                    >
                      {children}
                    </div>
                    <div data-dialog-dock-slot="" className="shrink-0 empty:hidden" />
                    <DialogWindowSurface id={state.id} contentRef={contentRef} />
                  </>
                ) : (
                  children
                )}
                {!windowControls && showCloseButton && (
                  <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background cursor-pointer transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
                    <X className="h-4 w-4" />
                    <span className="sr-only">Fechar janela</span>
                  </DialogPrimitive.Close>
                )}
              </DialogPrimitive.Content>
            </DialogPortal>
          </React.Activity>
        </WindowTitleContext.Provider>
      </DialogResourcesContext.Provider>
    );
  },
);
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) => {
  const { enabled } = React.useContext(WindowTitleContext);
  const titleOnly = React.Children.toArray(children).every(
    (child) => React.isValidElement(child) && child.type === DialogTitle,
  );
  return (
    <div
      className={cn(
        "flex flex-col space-y-1.5 text-center sm:text-left",
        className,
        enabled && titleOnly && "contents",
      )}
      {...props}
    >
      {children}
    </div>
  );
};
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, children, ...props }, ref) => {
  const { enabled, setTitle } = React.useContext(WindowTitleContext);
  const titleRef = React.useRef<HTMLHeadingElement | null>(null);
  const assignRef = React.useCallback(
    (element: HTMLHeadingElement | null) => {
      titleRef.current = element;
      if (typeof ref === "function") ref(element);
      else if (ref) ref.current = element;
    },
    [ref],
  );
  React.useLayoutEffect(() => {
    const element = titleRef.current;
    if (!enabled || !element) return;
    const update = () => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const parts: string[] = [];
      while (walker.nextNode()) {
        const text = walker.currentNode.textContent?.trim();
        if (text) parts.push(text);
      }
      setTitle(parts.join(" ") || "Cadastro");
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(element, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, [enabled, setTitle]);
  return (
    <DialogPrimitive.Title
      ref={assignRef}
      className={cn(
        "text-lg font-bold leading-none tracking-wide uppercase text-primary border-l-4 border-primary bg-primary/5 rounded-lg px-4 py-3",
        className,
        enabled && "sr-only border-0 bg-transparent p-0",
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Title>
  );
});
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
