export function formatMoney(amountCents: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountCents / 100);
}

/** "12.34" -> 1234. Rejects anything that is not a positive amount with at most 2 decimals. */
export function parseAmountToCents(input: string): number {
  const m = /^\s*\$?(\d+)(?:\.(\d{1,2}))?\s*$/.exec(input);
  if (!m) throw new Error("Amount must be a positive number with at most 2 decimals, e.g. 125.00");
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
  if (cents <= 0) throw new Error("Amount must be greater than zero");
  return cents;
}

export function formatDate(d: Date | string | null | undefined) {
  if (!d) return "";
  return new Date(d).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}
