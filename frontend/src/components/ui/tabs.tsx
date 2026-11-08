import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;

export function TabsList({ className, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn("inline-flex items-center gap-0.5 rounded-[10px] bg-white/[0.04] p-0.5 ring-1 ring-line", className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn("inline-flex h-7 items-center gap-1.5 rounded-[8px] px-3 text-[12.5px] font-medium text-muted transition-all hover:text-ink data-[state=active]:bg-white/[0.09] data-[state=active]:text-ink data-[state=active]:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] [&_svg]:size-3.5", className)}
      {...props}
    />
  );
}
