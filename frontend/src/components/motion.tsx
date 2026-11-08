/**
 * Motion system — Apple-style heading choreography.
 * Reserved for headings and display type; body copy stays still.
 */
import {
  motion, useInView, useMotionValueEvent, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue,
} from "motion/react";
import { useEffect, useMemo, useRef, useState, type ElementType, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const EASE = [0.16, 1, 0.3, 1] as const;

/* ── ConvergeText ────────────────────────────────────────────────────────────
   Letters start spread apart (and blurred) and lock together into the word.
   `progress` = scroll-linked (0 → spread, 1 → joined); otherwise plays on view. */
export function ConvergeText({ text, className, letterClassName, progress, spread = 0.9, as: Tag = "span", delay = 0 }: {
  text: string; className?: string; letterClassName?: string; progress?: MotionValue<number>; spread?: number;
  as?: ElementType; delay?: number;
}) {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10% 0px" });
  const reduce = useReducedMotion();
  const chars = useMemo(() => [...text], [text]);
  const mid = (chars.length - 1) / 2;
  return (
    <Tag ref={ref} className={cn("inline-block whitespace-pre", className)} aria-label={text}>
      {chars.map((ch, i) => {
        const offset = (i - mid) * spread; // em
        return progress && !reduce ? (
          <ScrollLetter key={i} ch={ch} offset={offset} progress={progress} className={letterClassName} />
        ) : (
          <motion.span key={i} aria-hidden className={cn("inline-block", letterClassName)}
            initial={reduce ? false : { x: `${offset}em`, opacity: 0, filter: "blur(10px)" }}
            animate={inView ? { x: "0em", opacity: 1, filter: "blur(0px)" } : undefined}
            transition={{ duration: 1.3, ease: EASE, delay: delay + Math.abs(i - mid) * 0.018 }}>
            {ch === " " ? " " : ch}
          </motion.span>
        );
      })}
    </Tag>
  );
}

function ScrollLetter({ ch, offset, progress, className }: { ch: string; offset: number; progress: MotionValue<number>; className?: string }) {
  const x = useTransform(progress, [0, 1], [`${offset}em`, "0em"]);
  const opacity = useTransform(progress, [0, 0.6, 1], [0.08, 0.7, 1]);
  const blur = useTransform(progress, [0, 1], [8, 0]);
  const filter = useTransform(blur, (b) => `blur(${b}px)`);
  return <motion.span aria-hidden className={cn("inline-block", className)} style={{ x, opacity, filter }}>{ch === " " ? " " : ch}</motion.span>;
}

/* ── ScrollWords ─────────────────────────────────────────────────────────────
   Words light up one by one as the reader scrolls. `accent` words turn signal-green. */
export function ScrollWords({ text, progress, className, accent = [], dimClass = "text-white/[0.13]" }: {
  text: string; progress: MotionValue<number>; className?: string; accent?: string[]; dimClass?: string;
}) {
  const words = text.split(" ");
  return (
    <p className={className} aria-label={text}>
      {words.map((w, i) => (
        <ScrollWord key={i} word={w} range={[i / words.length, (i + 1) / words.length]} progress={progress}
          accent={accent.some((a) => w.toLowerCase().startsWith(a.toLowerCase()))} dimClass={dimClass} />
      ))}
    </p>
  );
}

function ScrollWord({ word, range, progress, accent, dimClass }: {
  word: string; range: [number, number]; progress: MotionValue<number>; accent: boolean; dimClass: string;
}) {
  const opacity = useTransform(progress, range, [0, 1]);
  return (
    <span aria-hidden className="relative mr-[0.25em] inline-block">
      <span className={dimClass}>{word}</span>
      <motion.span style={{ opacity }} className={cn("absolute inset-0", accent ? "text-signal" : "text-ink")}>{word}</motion.span>
    </span>
  );
}

/* ── RiseWords ───────────────────────────────────────────────────────────────
   Masked word-by-word rise with a soft de-blur. Used for page titles. */
export function RiseWords({ text, className, delay = 0, as: Tag = "h1", highlight }: {
  text: string; className?: string; delay?: number; as?: ElementType; highlight?: string;
}) {
  const reduce = useReducedMotion();
  const words = text.split(" ");
  return (
    <Tag className={className} aria-label={text}>
      {words.map((w, i) => (
        <span key={i} aria-hidden className="inline-block overflow-hidden pb-[0.08em] align-bottom">
          <motion.span className={cn("inline-block", highlight && w.replace(/[.,]/g, "") === highlight && "text-signal")}
            initial={reduce ? false : { y: "105%", opacity: 0, filter: "blur(6px)" }}
            animate={{ y: "0%", opacity: 1, filter: "blur(0px)" }}
            transition={{ duration: 0.9, ease: EASE, delay: delay + i * 0.06 }}>
            {w}
          </motion.span>
          {i < words.length - 1 && " "}
        </span>
      ))}
    </Tag>
  );
}

/* ── TrackIn ─────────────────────────────────────────────────────────────────
   Wide letter-spacing tightens into place when the label enters view (eyebrows). */
export function TrackIn({ children, className, from = "0.6em", to = "0.14em" }: { children: ReactNode; className?: string; from?: string; to?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-5% 0px" });
  const reduce = useReducedMotion();
  return (
    <motion.span ref={ref} className={cn("inline-flex items-center gap-2", className)}
      initial={reduce ? false : { letterSpacing: from, opacity: 0 }}
      animate={inView ? { letterSpacing: to, opacity: 1 } : undefined}
      transition={{ duration: 1.1, ease: EASE }}>
      {children}
    </motion.span>
  );
}

/* ── Reveal ──────────────────────────────────────────────────────────────── */
export function Reveal({ children, className, delay = 0, y = 24 }: { children: ReactNode; className?: string; delay?: number; y?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className={className} initial={reduce ? false : { opacity: 0, y, filter: "blur(4px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }} viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.8, ease: EASE, delay }}>
      {children}
    </motion.div>
  );
}

/* ── Scramble ────────────────────────────────────────────────────────────────
   Morphs `from` into `to` character by character as progress goes 0 → 1. */
const GLYPHS = "ABCDEF0123456789#%&_[]";
export function Scramble({ from, to, progress, className, fromClass, toClass }: {
  from: string; to: string; progress: MotionValue<number>; className?: string; fromClass?: string; toClass?: string;
}) {
  const [p, setP] = useState(0);
  useMotionValueEvent(progress, "change", (v) => setP(Math.max(0, Math.min(1, v))));
  useEffect(() => setP(progress.get()), [progress]);
  const len = Math.max(from.length, to.length);
  const settled = Math.floor(p * (len + 4)) - 4;
  let out = "";
  for (let i = 0; i < len; i++) {
    if (i < settled) out += to[i] ?? "";
    else if (i < settled + 4 && p > 0.02) out += GLYPHS[(i * 7 + Math.floor(p * 60)) % GLYPHS.length];
    else out += from[i] ?? "";
  }
  const done = p >= 0.98;
  return <span className={cn("font-mono transition-colors duration-300", className, done ? toClass : p > 0.02 ? "text-ink-2" : fromClass)}>{done ? to : out.trimEnd()}</span>;
}

/* ── Sticky section helper: returns a smoothed 0→1 progress across a tall section ── */
export function useSectionProgress(offset: ["start start", "end end"] | ["start end", "end start"] | ["start end", "center center"] | ["start end", "end end"] = ["start start", "end end"]) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset });
  const smooth = useSpring(scrollYProgress, { stiffness: 140, damping: 30, mass: 0.4 });
  return { ref, progress: smooth, raw: scrollYProgress };
}

/* ── Cursor spotlight for every .card (one global listener) ── */
export function installSpotlight() {
  const onMove = (e: PointerEvent) => {
    const card = (e.target as HTMLElement | null)?.closest?.(".card") as HTMLElement | null;
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${e.clientX - r.left}px`);
    card.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  window.addEventListener("pointermove", onMove, { passive: true });
  return () => window.removeEventListener("pointermove", onMove);
}
