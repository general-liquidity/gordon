import { describe, expect, test } from "bun:test";
import { pickerTransition } from "./MultiStepPicker.tsx";

describe("pickerTransition", () => {
  test("go pushes history and back pops it", () => {
    const a = { stepId: "action", history: [] };
    const b = pickerTransition(a, { type: "go", stepId: "broker" });
    expect(b).toEqual({ stepId: "broker", history: ["action"] });
    const c = pickerTransition(b, { type: "back" });
    expect(c).toEqual(a);
  });

  test("back at root is a no-op", () => {
    const state = { stepId: "action", history: [] };
    expect(pickerTransition(state, { type: "back" })).toBe(state);
  });

  test("walks an exchange-shaped graph", () => {
    let state = { stepId: "action", history: [] as string[] };
    for (const stepId of ["add-sandbox-pick", "cred-apikey", "cred-apisecret"]) {
      state = pickerTransition(state, { type: "go", stepId });
    }
    expect(state.stepId).toBe("cred-apisecret");
    expect(state.history).toEqual(["action", "add-sandbox-pick", "cred-apikey"]);
    state = pickerTransition(state, { type: "back" });
    state = pickerTransition(state, { type: "back" });
    state = pickerTransition(state, { type: "back" });
    expect(state).toEqual({ stepId: "action", history: [] });
  });
});
