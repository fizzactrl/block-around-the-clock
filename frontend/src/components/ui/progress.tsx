import { motion } from "motion/react";
import { cn } from "@/lib/utils";

export function Progress({ value, className, barClassName }: { value: number; className?: string; barClassName?: string }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-subtle", className)}>
      <motion.div className={cn("h-full rounded-full bg-accent", barClassName)} initial={false}
        animate={{ width: `${Math.max(0, Math.min(100, value))}%` }} transition={{ type: "spring", stiffness: 120, damping: 22 }} />
    </div>
  );
}
