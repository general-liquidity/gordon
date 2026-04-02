export type OverlayKind =
  | "none"
  | "quick-actions"
  | "shortcuts"
  | "symbol-jump"
  | "review-desk";

export interface OverlayState {
  kind: OverlayKind;
}

export const OVERLAY_NONE: OverlayState = { kind: "none" };

export function openOverlay(kind: Exclude<OverlayKind, "none">): OverlayState {
  return { kind };
}

export function isOverlayOpen(
  overlay: OverlayState,
  kind?: Exclude<OverlayKind, "none">,
): boolean {
  if (kind) {
    return overlay.kind === kind;
  }

  return overlay.kind !== "none";
}
