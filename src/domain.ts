export type FinancialEvaluation = {
  conditionMet: boolean;
  observed: string;
  shortfall: string;
  threshold: string;
  variance: string;
};

function toCents(value: string): bigint {
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(value);
  if (!match) throw new Error("INVALID_DECIMAL_MONEY");
  const cents = BigInt(match[2]) * 100n + BigInt(match[3]);
  return match[1] === "-" ? -cents : cents;
}

function fromCents(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
}

export function evaluateGteCondition(threshold: string, observed: string): FinancialEvaluation {
  const thresholdCents = toCents(threshold);
  const observedCents = toCents(observed);
  const varianceCents = observedCents - thresholdCents;
  return {
    conditionMet: observedCents >= thresholdCents,
    observed: fromCents(observedCents),
    shortfall: fromCents(varianceCents < 0n ? -varianceCents : 0n),
    threshold: fromCents(thresholdCents),
    variance: fromCents(varianceCents),
  };
}
