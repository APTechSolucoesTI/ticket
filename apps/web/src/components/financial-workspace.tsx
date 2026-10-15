import { useId, type ComponentProps, type ReactNode } from "react";
import { PageHeader } from "@/components/empty-stub";

/** Shared page framing and compact visual scale for the financial modules. */
export function FinancialWorkspace({
  children,
  id,
  titleId,
  ...header
}: ComponentProps<typeof PageHeader> & { children: ReactNode; id?: string }) {
  const generatedId = useId();
  const headingId = titleId ?? generatedId;
  return (
    <section
      id={id}
      className="financial-workspace min-w-0 space-y-4 sm:p-6"
      aria-labelledby={headingId}
    >
      <PageHeader {...header} titleId={headingId} />
      {children}
    </section>
  );
}
