import { describe, expect, it } from "bun:test";
import { createAppStore, createInitialAppState } from "./AppStore.ts";
import { OVERLAY_NONE } from "../overlayState.ts";

describe("AppStore", () => {
  it("publishes state updates through the external store", () => {
    const store = createAppStore(createInitialAppState({
      setupMode: "advanced",
      setupSection: null,
      overlay: OVERLAY_NONE,
    }));

    let notified = 0;
    const unsubscribe = store.subscribe(() => {
      notified += 1;
    });

    store.patchState({ isLoading: true });
    expect(store.getState().isLoading).toBe(true);
    expect(notified).toBe(1);

    store.setState((previous) => ({
      ...previous,
      activityStatus: "Running",
    }));
    expect(store.getState().activityStatus).toBe("Running");
    expect(notified).toBe(2);

    unsubscribe();
  });
});
