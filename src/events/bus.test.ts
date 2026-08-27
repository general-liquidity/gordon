import { describe, test, expect } from "bun:test";
import { EventBus, emitEvent, getEventBus, setEventBus } from "./bus.ts";
import type { EventData } from "./types.ts";

function systemStartedEvent(
  permissionMode: "auto" | "ask" | "strict" = "ask",
): EventData<"system:started"> {
  return {
    type: "system:started",
    timestamp: new Date().toISOString(),
    permissionMode,
  };
}

function systemModeChangedEvent(
  permissionMode: "auto" | "ask" | "strict" = "auto",
): EventData<"system:permission_mode_changed"> {
  return {
    type: "system:permission_mode_changed",
    timestamp: new Date().toISOString(),
    permissionMode,
  };
}

describe("EventBus", () => {
  test("emits to typed handlers in priority order", async () => {
    const bus = new EventBus();
    const calls: string[] = [];

    bus.on("system:started", () => {
      calls.push("low");
    });
    bus.on(
      "system:started",
      () => {
        calls.push("high");
      },
      { priority: 10 },
    );

    await bus.emit(systemStartedEvent());
    expect(calls).toEqual(["high", "low"]);
  });

  test("supports once handlers and unsubscribe", async () => {
    const bus = new EventBus();
    let onceCount = 0;
    let normalCount = 0;

    bus.once("system:started", () => {
      onceCount++;
    });
    const unsubscribe = bus.on("system:started", () => {
      normalCount++;
    });

    await bus.emit(systemStartedEvent());
    await bus.emit(systemStartedEvent());
    unsubscribe();
    await bus.emit(systemStartedEvent());

    expect(onceCount).toBe(1);
    expect(normalCount).toBe(2);
  });

  test("supports wildcard handlers and continues on handler errors", async () => {
    const bus = new EventBus();
    const seenTypes: string[] = [];
    let typedCalled = false;

    bus.on("system:started", () => {
      throw new Error("intentional failure");
    });
    bus.on("system:started", () => {
      typedCalled = true;
    });
    bus.onAny((event) => {
      seenTypes.push(event.type);
    });

    await bus.emit(systemStartedEvent());

    expect(typedCalled).toBe(true);
    expect(seenTypes).toEqual(["system:started"]);
  });

  test("tracks history with limit, filtering, and clear", async () => {
    const bus = new EventBus(2);

    await bus.emit(systemStartedEvent("ask"));
    await bus.emit(systemModeChangedEvent());
    await bus.emit(systemStartedEvent("auto"));

    const allHistory = bus.getHistory();
    expect(allHistory).toHaveLength(2);
    expect(allHistory[0]?.type).toBe("system:permission_mode_changed");
    expect(allHistory[1]?.type).toBe("system:started");

    const started = bus.getHistory("system:started");
    expect(started).toHaveLength(1);
    expect((started[0] as { permissionMode: "auto" | "ask" | "strict" }).permissionMode).toBe(
      "auto",
    );

    bus.clearHistory();
    expect(bus.getHistory()).toHaveLength(0);
  });

  test("send auto-populates timestamp and type", async () => {
    const bus = new EventBus();
    let receivedType: EventData<"system:started">["type"] | null = null;
    let receivedMode: EventData<"system:started">["permissionMode"] | null = null;
    let hasTimestamp = false;

    bus.on("system:started", (event) => {
      receivedType = event.type;
      receivedMode = event.permissionMode;
      hasTimestamp = typeof event.timestamp === "string";
    });

    await bus.send("system:started", { permissionMode: "ask" });

    expect(receivedType === "system:started").toBe(true);
    expect(receivedMode === "ask").toBe(true);
    expect(hasTimestamp).toBe(true);
  });

  test("clear removes listeners and history", async () => {
    const bus = new EventBus();
    bus.on("system:started", () => undefined);
    bus.onAny(() => undefined);

    await bus.emit(systemStartedEvent());
    expect(bus.listenerCount("system:started")).toBe(1);
    expect(bus.listenerCount("*")).toBe(1);
    expect(bus.getHistory()).toHaveLength(1);

    bus.clear();

    expect(bus.listenerCount("system:started")).toBe(0);
    expect(bus.listenerCount("*")).toBe(0);
    expect(bus.getHistory()).toHaveLength(0);
  });
});

describe("default bus helpers", () => {
  test("emitEvent sends to configured default bus", async () => {
    const customBus = new EventBus();
    setEventBus(customBus);

    let called = false;
    customBus.on("system:started", () => {
      called = true;
    });

    await emitEvent("system:started", { permissionMode: "ask" });
    expect(called).toBe(true);
    expect(getEventBus()).toBe(customBus);
  });
});
