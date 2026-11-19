import * as React from "react";

type Resource = { value: unknown; dispose: () => void };
type Resources = {
  entries: Map<string, Resource>;
  suspended: React.RefObject<boolean>;
  parent: Resources | null;
};
export const DialogResourcesContext = React.createContext<Resources | null>(null);

function isSuspended(resources: Resources | null): boolean {
  return !!resources && (resources.suspended.current || isSuspended(resources.parent));
}

/** Own imperative UI resources outside Activity, disposing them on real close. */
export function useDialogResources(open: boolean, suspended: React.RefObject<boolean>) {
  const parent = React.useContext(DialogResourcesContext);
  const id = React.useId();
  const entries = React.useRef(new Map<string, Resource>());
  const mounted = React.useRef(false);
  const resources = React.useMemo(
    () => ({ entries: entries.current, suspended, parent }),
    [suspended, parent],
  );
  React.useEffect(() => {
    mounted.current = true;
    const dispose = () => {
      resources.entries.forEach((entry) => entry.dispose());
      resources.entries.clear();
    };
    // An ancestor owns nested pools too: its real close must dispose them even
    // if Activity already suspended the descendant's cleanup effects.
    const key = `pool:${id}`;
    const owned: Resource = { value: resources, dispose };
    parent?.entries.set(key, owned);
    if (!open) dispose();
    return () => {
      mounted.current = false;
      if (isSuspended(parent)) return;
      queueMicrotask(() => {
        if (mounted.current) return;
        if (parent?.entries.get(key) === owned) parent.entries.delete(key);
        dispose();
      });
    };
  }, [id, open, resources, parent]);
  return resources;
}

/** Preserve an editor/widget instance on minimize, not just its React state. */
export function useRetainedDialogResource<T>(
  create: () => T,
  dispose: (value: T) => void,
): T | null {
  const resources = React.useContext(DialogResourcesContext);
  const id = React.useId();
  const callbacks = React.useRef({ create, dispose });
  callbacks.current = { create, dispose };
  const standalone = React.useRef<Resource | null>(null);
  const mounted = React.useRef(false);
  const [value, setValue] = React.useState<T | null>(null);
  React.useEffect(() => {
    mounted.current = true;
    let entry = resources ? resources.entries.get(id) : standalone.current;
    if (!entry) {
      const instance = callbacks.current.create();
      entry = { value: instance, dispose: () => callbacks.current.dispose(instance) };
      if (resources) resources.entries.set(id, entry);
      else standalone.current = entry;
    }
    setValue(() => entry.value as T);
    const owned = entry;
    return () => {
      mounted.current = false;
      if (isSuspended(resources)) return;
      // Effect replay reconnects synchronously; an actual unmount does not.
      queueMicrotask(() => {
        if (mounted.current) return;
        if (resources) {
          if (resources.entries.get(id) !== owned) return;
          resources.entries.delete(id);
        } else standalone.current = null;
        owned.dispose();
      });
    };
  }, [id, resources]);
  return value;
}
