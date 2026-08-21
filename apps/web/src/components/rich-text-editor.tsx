import { lazy, Suspense } from "react";
import { useReadOnly } from "@/lib/permission-ui";

type Props = {
  value: string;
  onChange: (html: string) => void;
  className?: string;
};

// TipTap (~150KB) só é baixado quando algum formulário com editor é aberto.
const LazyEditor = lazy(() =>
  import("./rich-text-editor-impl").then((m) => ({ default: m.RichTextEditor })),
);

export function RichTextEditor(props: Props) {
  const readOnly = useReadOnly();
  return (
    <Suspense
      fallback={
        <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground animate-pulse">
          Carregando editor…
        </div>
      }
    >
      <LazyEditor {...props} readOnly={readOnly} />
    </Suspense>
  );
}

export default RichTextEditor;
