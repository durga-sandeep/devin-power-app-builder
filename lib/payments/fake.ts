/**
 * Fake payment provider. Sleeps 200ms and returns an externalRef. Amounts ending in 13 cents
 * throw so the FAILED path is testable. `calls` records every invocation for idempotency tests.
 * Like a real provider it is idempotent on `idempotencyKey`: a repeated key returns the first result.
 */
export type RefundInstruction = { amountCents: number; currency: string; idempotencyKey: string };

export class PaymentProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentProviderError";
  }
}

export const fakePayments = {
  calls: [] as RefundInstruction[],
  seen: new Map<string, { externalRef: string }>(),

  async refund(instruction: RefundInstruction): Promise<{ externalRef: string }> {
    this.calls.push(instruction);
    await new Promise((r) => setTimeout(r, 200));
    const prior = this.seen.get(instruction.idempotencyKey);
    if (prior) return prior;
    if (instruction.amountCents % 100 === 13) {
      throw new PaymentProviderError("Provider declined: amount ends in .13 (simulated failure)");
    }
    const result = { externalRef: `fake_${instruction.idempotencyKey.slice(0, 8)}_${Date.now().toString(36)}` };
    this.seen.set(instruction.idempotencyKey, result);
    return result;
  },
};
