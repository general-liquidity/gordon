import { describe, expect, it } from "bun:test";
import {
  computeASIntensityCalibration,
  computeASStationaryReservation,
} from "./as-market-making.ts";

describe("computeASIntensityCalibration", () => {
  it("derives Λ, A=Λ/α, k=α/κ from order-flow stats", () => {
    const r = computeASIntensityCalibration({
      dailyVolume: 1_000_000,
      avgOrderSize: 1000,
      sizeExponentAlpha: 1.5,
      impactCoef: 0.5,
    });
    expect(r.marketOrderFrequency).toBe(1000); // 1e6 / 1000
    expect(r.A).toBeCloseTo(666.67, 1); // Λ/α = 1000/1.5
    expect(r.k).toBeCloseTo(3.0, 6); // α/κ = 1.5/0.5
  });

  it("returns zeros on invalid input", () => {
    const r = computeASIntensityCalibration({
      dailyVolume: 1000,
      avgOrderSize: 10,
      sizeExponentAlpha: 1.5,
      impactCoef: 0,
    });
    expect(r.A).toBe(0);
    expect(r.k).toBe(0);
  });
});

describe("computeASStationaryReservation", () => {
  it("is ~symmetric around mid at zero inventory", () => {
    const r = computeASStationaryReservation({
      midPrice: 100,
      inventory: 0,
      gamma: 0.1,
      sigma: 2,
      qMax: 5,
    });
    expect(r.valid).toBe(true);
    expect(r.reservationMid).toBeCloseTo(100, 1);
    expect(Math.abs(r.inventorySkew!)).toBeLessThan(0.1);
    expect(r.atCap).toBe(false);
  });

  it("shifts the reservation DOWN when long (encourage selling)", () => {
    const r = computeASStationaryReservation({
      midPrice: 100,
      inventory: 3,
      gamma: 0.1,
      sigma: 2,
      qMax: 5,
    });
    expect(r.valid).toBe(true);
    expect(r.inventorySkew!).toBeLessThan(0); // long → quote below mid
    expect(r.reservationMid!).toBeLessThan(100);
  });

  it("shifts the reservation UP when short", () => {
    const r = computeASStationaryReservation({
      midPrice: 100,
      inventory: -3,
      gamma: 0.1,
      sigma: 2,
      qMax: 5,
    });
    expect(r.inventorySkew!).toBeGreaterThan(0);
  });

  it("flags the cap — one side's reservation diverges at q = qMax", () => {
    const r = computeASStationaryReservation({
      midPrice: 100,
      inventory: 5,
      gamma: 0.1,
      sigma: 2,
      qMax: 5,
    });
    expect(r.atCap).toBe(true);
    expect(r.reservationBid).toBeNull(); // long cap → stop quoting the bid
  });

  it("invalid on bad inputs", () => {
    expect(
      computeASStationaryReservation({ midPrice: 100, inventory: 0, gamma: 0, sigma: 2, qMax: 5 })
        .valid,
    ).toBe(false);
  });
});
