import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2 py-[3px] text-[11.5px] font-medium leading-none whitespace-nowrap [&_svg]:size-3",
  {
    variants: {
      tone: {
        neutral: "bg-white/[0.06] text-ink-2",
        outline: "border border-line-strong text-ink-2 bg-transparent",
        critical: "bg-critical-soft text-[#ff8a8e]",
        high: "bg-high-soft text-[#ffb37a]",
        medium: "bg-medium-soft text-[#f5d27a]",
        ok: "bg-ok-soft text-[#86efac]",
        accent: "bg-accent-soft text-[#86efac]",
        night: "bg-white/[0.07] text-white/80",
        nightCritical: "bg-critical/15 text-[#ff8a8e]",
        nightOk: "bg-ok/15 text-[#5fd394]",
        nightAccent: "bg-accent/15 text-[#86efac]",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({ className, tone, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
