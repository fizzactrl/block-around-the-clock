import { describe, expect, it } from "vitest";
import { detect, tokenizeLocal } from "./tokenizer";

const SAMPLE = "Maya Chen at Wells Fargo, 415-555-0198, SSN 512-44-8890, code 482913, account 99887766, " +
  "card 4111 1111 1111 1111, maya.chen@example.com";

describe("edge tokenizer (shared policy parity with Flask validator)", () => {
  it("detects every category the server detects", () => {
    const types = new Set(detect(SAMPLE).map((d) => d.type));
    for (const t of ["PERSON", "BANK", "PHONE", "SSN", "OTP", "ACCOUNT", "CARD", "EMAIL"]) expect(types).toContain(t);
  });

  it("removes all raw values and is idempotent", async () => {
    const r = await tokenizeLocal(SAMPLE);
    expect(r.text).not.toMatch(/512-44-8890|415-555-0198|482913|Maya Chen|4111/);
    expect(detect(r.text)).toHaveLength(0);
  });

  it("is deterministic within a session", async () => {
    const a = await tokenizeLocal("SSN 512-44-8890");
    const b = await tokenizeLocal("SSN 512 44 8890");
    expect(a.text).toBe(b.text);
  });

  it("rejects non-Luhn card-like numbers", () => {
    expect(detect("ref 1234 5678 9012 3456").some((d) => d.type === "CARD")).toBe(false);
  });
});
