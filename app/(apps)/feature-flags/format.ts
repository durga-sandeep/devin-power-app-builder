import type { StateChange } from "./service";

/** Form values -> StateChange. Range/consistency rules live in validateState() on the server. */
export function parseStateChange(enabled: FormDataEntryValue | null, rolloutPercent: FormDataEntryValue | null): StateChange {
  if (enabled !== "true" && enabled !== "false") throw new Error("enabled must be true or false");
  const raw = String(rolloutPercent ?? "").trim();
  if (!/^\d+$/.test(raw)) throw new Error("rolloutPercent must be a whole number from 0 to 100");
  return { enabled: enabled === "true", rolloutPercent: Number(raw) };
}

export function describeState(s: { enabled: boolean; rolloutPercent: number }) {
  return s.enabled ? `ON ${s.rolloutPercent}%` : s.rolloutPercent > 0 ? `OFF (${s.rolloutPercent}% kept)` : "OFF";
}

export function formatDate(d: Date | string | null | undefined) {
  if (!d) return "";
  return new Date(d).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}
