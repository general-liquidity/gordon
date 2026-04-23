/**
 * Shared sandbox-override state.
 *
 * A single module-level flag lets both the gateway context resolver (reader)
 * and the set_permission_mode tool (writer) coordinate without a circular
 * import dependency between src/gateway and src/infra.
 *
 *   null  — use whatever sandbox flag the active venue config specifies
 *   true  — force sandbox/paper on every venue adapter rebuild
 *   false — force live on every venue adapter rebuild
 */

let _override: boolean | null = null;

export function getSandboxOverride(): boolean | null {
  return _override;
}

export function setSandboxOverride(v: boolean | null): void {
  _override = v;
}
