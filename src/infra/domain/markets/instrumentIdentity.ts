export type InstrumentRoute = "exchange" | "broker";

function literalSymbol(symbol: string | undefined): string {
  return (symbol ?? "").trim().toUpperCase();
}

function ccxtSpotPair(symbol: string): string | null {
  const match = /^([A-Z0-9]+)\/([A-Z0-9]+)$/.exec(symbol);
  return match ? `${match[1]}${match[2]}` : null;
}

/**
 * Compare venue symbols without erasing punctuation that may identify a
 * different contract or share class. CCXT's unambiguous `BASE/QUOTE` spot
 * spelling may match a venue's compact `BASEQUOTE` spelling; every other
 * punctuation difference remains distinct and therefore fails closed.
 */
export function sameVenueInstrumentSymbol(
  left: string | undefined,
  right: string | undefined,
  route: InstrumentRoute,
): boolean {
  const leftLiteral = literalSymbol(left);
  const rightLiteral = literalSymbol(right);
  if (!leftLiteral || !rightLiteral) return false;
  if (leftLiteral === rightLiteral) return true;
  if (route === "broker") return false;

  const leftSpotPair = ccxtSpotPair(leftLiteral);
  const rightSpotPair = ccxtSpotPair(rightLiteral);
  return (
    (leftSpotPair !== null && (leftSpotPair === rightLiteral || leftSpotPair === rightSpotPair)) ||
    (rightSpotPair !== null && rightSpotPair === leftLiteral)
  );
}
