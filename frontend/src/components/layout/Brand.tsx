import { useId } from "react";
import { cn } from "@/lib/utils";

const UPPER = "M155 148C155 114 172 84 202 82L276 82C313 82 335 107 330 138C326 165 307 184 290 197C286 169 267 148 240 148Z";
const LOWER = "M95 290L95 206C95 171 121 148 155 148L155 248C192 226 240 211 290 197C292 251 233 285 176 299L106 300C99 300 95 296 95 290Z";
const SHEEN = "M155 148C155 114 172 84 202 82L276 82C313 82 335 107 330 138C328 150 322 160 314 168C300 120 240 110 160 140Z";
const FOLD = "M155 148L155 248C162 243 170 238 178 233L178 160C178 154 172 148 166 148Z";

/** Brand mark: two overlapping petals around a speech-bubble cut-out (scams start with a conversation),
 *  rendered with a bevel light, specular sheen and soft mint glow. */
export function BrandMark({ size = 28, glow = true }: { size?: number; glow?: boolean }) {
  const u = useId().replace(/:/g, "");
  const small = size < 40;
  return (
    <svg width={size} height={size} viewBox="78 62 268 268" aria-label="BlockAroundTheClock" role="img" className="shrink-0 overflow-visible">
      <defs>
        <linearGradient id={`u${u}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2fa889" /><stop offset=".55" stopColor="#4cc9a6" /><stop offset="1" stopColor="#8af2d2" />
        </linearGradient>
        <linearGradient id={`l${u}`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#9df7da" /><stop offset=".5" stopColor="#5fd8b5" /><stop offset="1" stopColor="#2a9d81" />
        </linearGradient>
        <linearGradient id={`s${u}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".55" /><stop offset=".45" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <filter id={`b${u}`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur in="SourceAlpha" stdDeviation={small ? 6 : 4} result="blur" />
          <feSpecularLighting in="blur" surfaceScale="5" specularConstant="0.9" specularExponent="22" lightingColor="#ffffff" result="spec">
            <fePointLight x="120" y="40" z="160" />
          </feSpecularLighting>
          <feComposite in="spec" in2="SourceAlpha" operator="in" result="spec2" />
          <feComposite in="SourceGraphic" in2="spec2" operator="arithmetic" k1="0" k2="1" k3="0.55" k4="0" />
        </filter>
        <filter id={`d${u}`} x="-30%" y="-30%" width="160%" height="170%">
          <feDropShadow dx="0" dy="10" stdDeviation="9" floodColor="#000" floodOpacity=".55" />
          {glow && <feDropShadow dx="0" dy="0" stdDeviation="14" floodColor="#34d399" floodOpacity=".35" />}
        </filter>
      </defs>
      <g filter={`url(#d${u})`}>
        <g filter={`url(#b${u})`}>
          <path d={UPPER} fill={`url(#u${u})`} />
          <path d={LOWER} fill={`url(#l${u})`} />
        </g>
        <path d={SHEEN} fill={`url(#s${u})`} />
        <path d={FOLD} fill="#1f7a63" fillOpacity=".35" />
      </g>
    </svg>
  );
}

/** Wordmark in the same green-screen terminal face as the hero, with a blinking caret. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("wordmark-term inline-flex items-center whitespace-nowrap leading-none text-[#d9ffe9]", className)}>
      BlockAround<span className="text-accent">TheClock</span><span className="wordmark-caret" aria-hidden />
    </span>
  );
}
