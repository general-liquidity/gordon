import { useRef, useCallback } from "react";

export type ScrollDevice = "keyboard" | "touchpad" | "mouse";

const MOUSE_INTERVAL_MS = 16;     // < 16ms between events = hardware mouse wheel
const TOUCHPAD_INTERVAL_MS = 80;  // 16-80ms = touchpad or key-repeat
// > 80ms = deliberate keyboard press

const MULTIPLIERS: Record<ScrollDevice, number> = {
  keyboard: 1,
  touchpad: 1.5,
  mouse: 3,
};

export function useScrollDevice() {
  const lastEventMs = useRef(0);
  const deviceRef = useRef<ScrollDevice>("keyboard");

  const detectDevice = useCallback((): ScrollDevice => {
    const now = Date.now();
    const interval = now - lastEventMs.current;
    lastEventMs.current = now;

    if (interval < MOUSE_INTERVAL_MS) {
      deviceRef.current = "mouse";
    } else if (interval < TOUCHPAD_INTERVAL_MS) {
      deviceRef.current = "touchpad";
    } else {
      deviceRef.current = "keyboard";
    }
    return deviceRef.current;
  }, []);

  const getMultiplier = useCallback((): number => {
    return MULTIPLIERS[deviceRef.current];
  }, []);

  return { detectDevice, getMultiplier, deviceRef };
}
