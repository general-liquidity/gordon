import { describe, expect, it } from "bun:test";
import { isPermanentSubscribeError } from "./ccxt-websocket.ts";

// Fabricate a CCXT-shaped error: a subclass whose constructor.name matches
// the CCXT error class (e.g. "BadSymbol"), the way ccxt instances expose it.
function ccxtError(className: string, message = ""): Error {
  const ctor = { [className]: class extends Error {} }[className] as new (
    m?: string,
  ) => Error;
  return new ctor(message);
}

describe("isPermanentSubscribeError", () => {
  it("treats BadSymbol class as permanent", () => {
    expect(isPermanentSubscribeError(ccxtError("BadSymbol"))).toBe(true);
  });

  it("treats a does-not-have-market message as permanent", () => {
    const err = new Error(
      "binance does not have market symbol GORDONTEST/USDT",
    );
    expect(isPermanentSubscribeError(err)).toBe(true);
  });

  it("treats AuthenticationError class as permanent", () => {
    expect(isPermanentSubscribeError(ccxtError("AuthenticationError"))).toBe(
      true,
    );
  });

  it("treats BadRequest / ArgumentsRequired / PermissionDenied / NotSupported as permanent", () => {
    expect(isPermanentSubscribeError(ccxtError("BadRequest"))).toBe(true);
    expect(isPermanentSubscribeError(ccxtError("ArgumentsRequired"))).toBe(true);
    expect(isPermanentSubscribeError(ccxtError("PermissionDenied"))).toBe(true);
    expect(isPermanentSubscribeError(ccxtError("NotSupported"))).toBe(true);
  });

  it("treats NetworkError class as transient", () => {
    expect(isPermanentSubscribeError(ccxtError("NetworkError"))).toBe(false);
  });

  it("treats RequestTimeout class as transient", () => {
    expect(isPermanentSubscribeError(ccxtError("RequestTimeout"))).toBe(false);
  });

  it("treats a generic socket-hang-up Error as transient", () => {
    expect(isPermanentSubscribeError(new Error("socket hang up"))).toBe(false);
  });

  it("treats generic ExchangeError as transient", () => {
    expect(isPermanentSubscribeError(ccxtError("ExchangeError"))).toBe(false);
  });

  it("treats unknown / non-error values as transient", () => {
    expect(isPermanentSubscribeError({})).toBe(false);
    expect(isPermanentSubscribeError("something odd")).toBe(false);
    expect(isPermanentSubscribeError(null)).toBe(false);
    expect(isPermanentSubscribeError(undefined)).toBe(false);
  });
});
