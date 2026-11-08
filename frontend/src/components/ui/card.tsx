import { motion, type HTMLMotionProps } from "motion/react";
import * as React from "react";
import { TrackIn } from "@/components/motion";
import { cn } from "@/lib/utils";

/** Surface card. Rises into view on scroll; cursor spotlight comes from the global .card listener. */
export function Card({ className, ...props }: HTMLMotionProps<"div">) {
  return (
    <motion.div className={cn("card", className)} initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }} {...props} />
  );
}

export function CardHeader({ title, eyebrow, action, className, description }: {
  title: React.ReactNode; eyebrow?: React.ReactNode; action?: React.ReactNode; className?: string; description?: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col items-start justify-between gap-3 px-5 pt-5 sm:flex-row sm:gap-4", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1.5"><TrackIn from="0.45em">{eyebrow}</TrackIn></div>}
        <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h3>
        {description && <p className="mt-1 text-[13px] text-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
