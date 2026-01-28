/**
 * Binance API Permission Checking
 * Verifies and validates API key permissions
 */

import type { BinanceClient } from "./client.ts";
import type { ExchangePermissions } from "./types.ts";

/**
 * Verify what permissions an API key has by checking account info
 */
export async function verifyPermissions(
  client: BinanceClient
): Promise<ExchangePermissions> {
  try {
    const accountInfo = await client.getAccountInfo();

    return {
      read: true, // If we got here, we can read
      spotTrade: accountInfo.canTrade,
      withdraw: accountInfo.canWithdraw,
    };
  } catch (error) {
    // If we can't even get account info, we have no read permission
    return {
      read: false,
      spotTrade: false,
      withdraw: false,
    };
  }
}

/**
 * Validation result for permissions check
 */
export interface PermissionValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate that permissions meet the requirements for Gordon:
 * - read: must be true (needed to fetch market data and balances)
 * - spotTrade: must be true (needed to place orders)
 * - withdraw: must be false (security - Gordon should never be able to withdraw)
 */
export function validatePermissions(
  permissions: ExchangePermissions
): PermissionValidationResult {
  const errors: string[] = [];

  if (!permissions.read) {
    errors.push(
      "API key does not have read permission. Gordon needs read access to fetch market data and balances."
    );
  }

  if (!permissions.spotTrade) {
    errors.push(
      "API key does not have spot trading permission. Gordon needs spot trading access to place orders."
    );
  }

  if (permissions.withdraw) {
    errors.push(
      "API key has withdrawal permission enabled. For security, Gordon should NEVER have withdrawal access. " +
        "Please create a new API key with withdrawal disabled."
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Full permission check - verifies and validates in one call
 * Returns both the permissions found and any validation errors
 */
export async function checkAndValidatePermissions(
  client: BinanceClient
): Promise<{
  permissions: ExchangePermissions;
  validation: PermissionValidationResult;
}> {
  const permissions = await verifyPermissions(client);
  const validation = validatePermissions(permissions);

  return { permissions, validation };
}

/**
 * Format permissions for display
 */
export function formatPermissionsDisplay(
  permissions: ExchangePermissions
): string {
  const status = (enabled: boolean, desired: boolean): string => {
    if (enabled === desired) {
      return enabled ? "[OK] Enabled" : "[OK] Disabled";
    }
    return enabled ? "[!!] Enabled (should be disabled)" : "[!!] Disabled (should be enabled)";
  };

  return [
    "API Key Permissions:",
    `  Read:       ${status(permissions.read, true)}`,
    `  Spot Trade: ${status(permissions.spotTrade, true)}`,
    `  Withdraw:   ${status(permissions.withdraw, false)}`,
  ].join("\n");
}
