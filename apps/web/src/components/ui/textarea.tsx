import * as React from "react";

import { cn } from "@/lib/utils";
import { useReadOnly } from "@/lib/permission-ui";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    const contextReadOnly = useReadOnly();
    return (
      <textarea
        className={cn(
          "flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
        readOnly={contextReadOnly || props.readOnly}
        aria-readonly={contextReadOnly || props.readOnly || undefined}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
