import { afterEach, describe, expect, it } from "bun:test";
import { ServiceContainer, setContainer } from "./container.ts";

describe("ServiceContainer", () => {
  afterEach(() => {
    setContainer(new ServiceContainer());
  });

  it("initializes core services and repositories", async () => {
    const container = new ServiceContainer();
    await container.initialize({ logLevel: "error" });

    expect(container.isInitialized).toBe(true);
    expect(container.plansRepo).toBeDefined();
    expect(container.tradesRepo).toBeDefined();
    expect(container.eventBus).toBeDefined();
    expect(container.priceCache).toBeDefined();
    expect(container.exchange).toBeNull();
  });

  it("reset clears initialized state", async () => {
    const container = new ServiceContainer();
    await container.initialize({ logLevel: "error" });
    container.reset();
    expect(container.isInitialized).toBe(false);
  });
});