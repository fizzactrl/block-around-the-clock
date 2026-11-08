import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Switch = React.forwardRef<React.ElementRef<typeof SwitchPrimitive.Root>, React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>>(
  ({ className, ...props }, ref) => (
    <SwitchPrimitive.Root ref={ref} className={cn(
      "peer inline-flex h-[20px] w-[34px] shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors duration-200 data-[state=checked]:bg-accent data-[state=unchecked]:bg-line-strong disabled:opacity-50",
      className)} {...props}>
      <SwitchPrimitive.Thumb className="pointer-events-none block size-4 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-transform duration-200 data-[state=checked]:translate-x-[15px] data-[state=unchecked]:translate-x-[1px]" />
    </SwitchPrimitive.Root>
  ),
);
Switch.displayName = "Switch";
