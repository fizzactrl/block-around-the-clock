/**
 * Edge tokenizer — runs entirely in the browser BEFORE anything leaves the device.
 * Uses the same shared policy as the Flask validator (shared/privacy-policy.json).
 * Tokens are HMAC-SHA-256 with a per-session key held only in memory, so the same
 * value maps to the same token within a session, and no reverse map exists anywhere.
 */
import policyJson from "@shared/privacy-policy.json";

export const privacyPolicy = policyJson;

export interface Detection { type: string; label: string; start: number; end: number; value: string; token: string }
export interface TokenizeOutput { text: string; detections: Detection[]; counts: Record<string, number>; total: number }

const TOKEN_RE = /\[[A-Z]+_[0-9A-F]{6}\]/g;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const dictPattern = (words: string[]) => [...words].sort((a, b) => b.length - a.length).map(escapeRe).join("|");

interface Compiled { type: string; label: string; re: RegExp; group: number; luhn: boolean }

const compiled: Compiled[] = policyJson.detectors.map((d) => {
  const det = d as typeof d & { pattern?: string; dictionary?: string; group?: number; luhn?: boolean; flags?: string };
  let source = det.pattern ?? "";
  if (det.dictionary === "banks") source = `\\b(?:${dictPattern(policyJson.dictionaries.banks)})(?![A-Za-z])`;
  if (det.dictionary === "names") {
    const f = dictPattern(policyJson.dictionaries.first_names);
    const l = dictPattern(policyJson.dictionaries.last_names);
    source = `\\b(?:(?:${f})(?: [A-Z][a-z]+)?|(?:${l}))\\b`;
  }
  const flags = "gd" + (det.flags?.includes("i") ? "i" : "");
  return { type: det.type, label: det.label, re: new RegExp(source, flags), group: det.group ?? 0, luhn: !!det.luhn };
});

function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function normalize(type: string, value: string): string {
  if (["CARD", "SSN", "PHONE", "ACCOUNT", "OTP"].includes(type)) {
    const digits = value.replace(/\D/g, "");
    return type === "PHONE" ? digits.slice(-10) : digits;
  }
  return value.trim().toLowerCase();
}

let keyPromise: Promise<CryptoKey | null> | null = null;
function sessionKey(): Promise<CryptoKey | null> {
  if (!keyPromise) {
    keyPromise = (async () => {
      if (!globalThis.crypto?.subtle) return null;
      const raw = crypto.getRandomValues(new Uint8Array(32));
      return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    })();
  }
  return keyPromise;
}

// Fallback for non-secure contexts without SubtleCrypto: FNV-1a with a session salt.
const salt = Math.random().toString(36).slice(2);
function fnv(input: string): string {
  let h = 0x811c9dc5;
  for (const ch of salt + input) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

async function makeToken(type: string, value: string): Promise<string> {
  const msg = `${type}:${normalize(type, value)}`;
  const key = await sessionKey();
  let hex: string;
  if (key) {
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
    hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } else {
    hex = fnv(msg);
  }
  return `[${type}_${hex.slice(0, 6).toUpperCase()}]`;
}

/** Synchronous detection (used for live highlighting). */
export function detect(text: string): Omit<Detection, "token">[] {
  const taken: [number, number][] = [...text.matchAll(TOKEN_RE)].map((m) => [m.index!, m.index! + m[0].length]);
  const free = (s: number, e: number) => taken.every(([ts, te]) => e <= ts || s >= te);
  const out: Omit<Detection, "token">[] = [];
  for (const c of compiled) {
    c.re.lastIndex = 0;
    for (const m of text.matchAll(c.re)) {
      const span = (m as RegExpMatchArray & { indices?: [number, number][] }).indices?.[c.group];
      if (!span) continue;
      const [s, e] = span;
      const value = m[c.group];
      if (!free(s, e)) continue;
      if (c.luhn && !luhn(value.replace(/\D/g, ""))) continue;
      taken.push([s, e]);
      out.push({ type: c.type, label: c.label, start: s, end: e, value });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export async function tokenizeLocal(text: string): Promise<TokenizeOutput> {
  const found = detect(text);
  const detections: Detection[] = await Promise.all(found.map(async (d) => ({ ...d, token: await makeToken(d.type, d.value) })));
  let out = "";
  let cursor = 0;
  for (const d of detections) { out += text.slice(cursor, d.start) + d.token; cursor = d.end; }
  out += text.slice(cursor);
  const counts: Record<string, number> = {};
  for (const d of detections) counts[d.type] = (counts[d.type] ?? 0) + 1;
  return { text: out, detections, counts, total: detections.length };
}

export function mergeCounts(...maps: Record<string, number>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of maps) for (const [k, v] of Object.entries(m)) out[k] = (out[k] ?? 0) + v;
  return out;
}

export const PII_LABELS: Record<string, string> = Object.fromEntries(policyJson.detectors.map((d) => [d.type, d.label]));
