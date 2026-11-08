import { useMotionValueEvent, type MotionValue } from "motion/react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/** Typed in this order, styled like the wordmark: "BlockAround" (light) + "TheClock" (green). */
const SEGMENTS = [
  { text: "BlockAround", tone: "light" },
  { text: "TheClock", tone: "green" },
] as const;
const TOTAL = SEGMENTS.reduce((n, s) => n + s.text.length, 0);

/**
 * Terminal-typed hero title driven by scroll progress (0 → 1).
 * Untyped letters keep their space (visibility hidden) so the layout never jumps.
 * The newest letter flashes like a fresh keystroke; a block cursor sits after it.
 */
export function TypedTitle({ progress, className }: { progress: MotionValue<number>; className?: string }) {
  const [count, setCount] = useState(0);
  useMotionValueEvent(progress, "change", (v) => setCount(Math.max(0, Math.min(TOTAL, Math.floor(v * (TOTAL + 0.999))))));

  let index = 0;
  const caretAt = Math.min(count, TOTAL - 1);
  const done = count >= TOTAL;
  return (
    <h1 className={cn("type-title", className)} aria-label="BlockAroundTheClock">
      {SEGMENTS.map((seg) => (
        <span key={seg.text} className={cn("type-seg", seg.tone === "green" ? "type-green" : "type-light")}>
          {[...seg.text].map((ch) => {
            const i = index++;
            const typed = i < count;
            return (
              <span key={i} className="relative inline-block">
                <span className={cn("type-char", typed ? "is-typed" : "is-pending", typed && i === count - 1 && "is-fresh")}>{ch}</span>
                {i === caretAt && <span className={cn("type-caret", (count === 0 || done) && "is-blinking")} style={{ left: typed ? "100%" : 0 }} aria-hidden />}
              </span>
            );
          })}
        </span>
      ))}
    </h1>
  );
}
