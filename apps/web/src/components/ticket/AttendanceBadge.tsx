import { CircleDollarSign } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export type AttendanceType = "contratual" | "avulso";

export function AttendanceBadge({ type }: { type: AttendanceType }) {
  if (type !== "avulso") return null;
  return (
    <Badge
      variant="outline"
      className="gap-1 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
    >
      <CircleDollarSign className="size-3" aria-hidden="true" />
      Avulso
    </Badge>
  );
}
