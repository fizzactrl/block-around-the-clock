import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] text-[13px] font-medium transition-all duration-200 ease-out select-none disabled:pointer-events-none disabled:opacity-45 active:scale-[0.98] [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-accent text-on-ink font-semibold shadow-[0_1px_0_rgba(255,255,255,0.35)_inset,0_0_0_1px_rgba(74,222,128,0.4),0_8px_24px_-8px_rgba(74,222,128,0.55)] hover:bg-[#6ee7a0] hover:shadow-[0_1px_0_rgba(255,255,255,0.35)_inset,0_0_0_1px_rgba(74,222,128,0.6),0_10px_30px_-6px_rgba(74,222,128,0.7)]",
        secondary: "bg-white/[0.03] text-ink border border-line-strong shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:bg-white/[0.06] hover:border-white/15",
        ghost: "text-ink-2 hover:bg-white/[0.05] hover:text-ink",
        danger: "bg-critical text-white shadow-[0_1px_0_rgba(255,255,255,0.2)_inset,0_8px_24px_-8px_rgba(242,85,90,0.6)] hover:bg-[#ff6b70]",
        accent: "bg-accent text-on-ink shadow-[0_0_0_1px_rgba(74,222,128,0.4)] hover:bg-[#6ee7a0]",
        night: "bg-white/[0.06] text-white border border-white/10 hover:bg-white/[0.1]",
        nightPrimary: "bg-accent text-on-ink font-semibold hover:bg-[#6ee7a0] shadow-[0_8px_24px_-8px_rgba(74,222,128,0.55)]",
      },
      size: {
        sm: "h-8 px-3 text-[12.5px]",
        md: "h-9 px-4",
        lg: "h-11 px-5 text-[14px] rounded-xl",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, loading, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} {...props}>
        {asChild ? children : (<>{loading && <Loader2 className="animate-spin" />}{children}</>)}
      </Comp>
    );
  },
);
Button.displayName = "Button";
