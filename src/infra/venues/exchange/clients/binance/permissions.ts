/**
 * Binance API Permission Checking
 * Verifies and validates API key permissions
 *
 * Security features:
 * - Permission caching to reduce API calls
 * - Initialization-time permission check
 * - Clear error messages for permission issues
 * - Read-only key detection and warnings
 */

import type { BinanceClient } from "./client.ts";
import type { ExchangePermissions } from "./types.ts";
import { createModuleLogger } from "../../../../logger/index.ts";

const logger = createModuleLogger("permissions");

// ============================================================================
// Permission Cache
// ============================================================================

interface CachedPermissions {
  permissions: ExchangePermissions;
  timestamp: number;
  clientId: string;
}

// Cache permissions for 5 minutes to reduce API calls
const CACHE_TTL_MS = 5 * 60 * 1000;
let permissionCache: CachedPermissions | null = null;

/**
 * Get a unique identifier for the client (based on API key prefix)
 */
function getClientId(client: BinanceClient): string {
  // Use the client's internal API key prefix as identifier
  // This is safe as we only use first 8 chars
  return (client as unknown as { apiKey: string }).apiKey?.substring(0, 8) || "unknown";
}

/**
 * Check if cached permissions are valid
 */
function isCacheValid(clientId: string): boolean {
  if (!permissionCache) return false;
  if (permissionCache.clientId !== clientId) return false;
  if (Date.now() - permissionCache.timestamp > CACHE_TTL_MS) return false;
  return true;
}

/**
 * Clear the permission cache
 */
export function clearPermissionCache(): void {
  permissionCache = null;
  logger.debug("Permission cache cleared");
}

/**
 * Verify what permissions an API key has by checking account info
 * Results are cached to reduce API calls
 */
export async function verifyPermissions(
  client: BinanceClient,
  options: { bypassCache?: boolean } = {}
): Promise<ExchangePermissions> {
  const clientId = getClientId(client);

  // Return cached result if valid
  if (!options.bypassCache && isCacheValid(clientId)) {
    logger.debug("Returning cached permissions", { clientId });
    return permissionCache!.permissions;
  }

  try {
    const accountInfo = await client.getAccountInfo();

    const permissions: ExchangePermissions = {
      read: true, // If we got here, we can read
      spotTrade: accountInfo.canTrade,
      withdraw: accountInfo.canWithdraw,
    };

    // Cache the result
    permissionCache = {
      permissions,
      timestamp: Date.now(),
      clientId,
    };

    logger.debug("Permissions verified and cached", {
      read: permissions.read,
      spotTrade: permissions.spotTrade,
      withdraw: permissions.withdraw,
    });

    return permissions;
  } catch (error) {
    logger.error("Failed to verify permissions", error instanceof Error ? error : undefined);

    // If we can't even get account info, we have no read permission
    const permissions: ExchangePermissions = {
      read: false,
      spotTrade: false,
      withdraw: false,
    };

    // Don't cache failures
    return permissions;
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

// ============================================================================
// Initialization Check
// ============================================================================

/**
 * Result of permission initialization check
 */
export interface PermissionInitResult {
  success: boolean;
  permissions: ExchangePermissions;
  validation: PermissionValidationResult;
  warnings: string[];
  errors: string[];
  isReadOnly: boolean;
}

/**
 * Check and validate permissions on client initialization
 * This should be called when the Binance client is first connected
 *
 * @param client - The Binance client to check
 * @returns Detailed result of permission check
 */
export async function checkPermissionsOnInit(
  client: BinanceClient
): Promise<PermissionInitResult> {
  const warnings: string[] = [];
  const errors: string[] = [];

  logger.info("Checking API permissions on initialization");

  // Verify permissions
  const permissions = await verifyPermissions(client, { bypassCache: true });

  // Validate permissions
  const validation = validatePermissions(permissions);

  // Check for read-only key
  const isReadOnly = permissions.read && !permissions.spotTrade;

  // Build warnings
  if (isReadOnly) {
    warnings.push(
      "API key is READ-ONLY. You can view data but cannot execute trades. " +
      "To trade, create a new API key with spot trading enabled."
    );
  }

  if (permissions.withdraw) {
    warnings.push(
      "SECURITY WARNING: API key has withdrawal permissions enabled. " +
      "This is a security risk. Please disable withdrawals for this key."
    );
  }

  // Build errors
  if (!permissions.read) {
    errors.push(
      "API key cannot read account data. Please check your API key configuration."
    );
  }

  // Log the result
  if (errors.length > 0) {
    logger.error("Permission check failed", undefined, { errors });
  } else if (warnings.length > 0) {
    logger.warn("Permission check completed with warnings", { warnings });
  } else {
    logger.info("Permission check passed", {
      read: permissions.read,
      spotTrade: permissions.spotTrade,
      withdraw: permissions.withdraw,
    });
  }

  return {
    success: validation.valid && errors.length === 0,
    permissions,
    validation,
    warnings,
    errors,
    isReadOnly,
  };
}

/**
 * Validate that a specific operation is permitted
 *
 * @param client - The Binance client
 * @param operation - The operation to check ("trade" or "read")
 * @returns Object with allowed status and error message if denied
 */
export async function validateOperation(
  client: BinanceClient,
  operation: "trade" | "read"
): Promise<{ allowed: boolean; error?: string }> {
  const permissions = await verifyPermissions(client);

  if (operation === "read") {
    if (!permissions.read) {
      return {
        allowed: false,
        error: "Permission denied: API key does not have read access.",
      };
    }
    return { allowed: true };
  }

  if (operation === "trade") {
    if (!permissions.read) {
      return {
        allowed: false,
        error: "Permission denied: API key does not have read access.",
      };
    }
    if (!permissions.spotTrade) {
      return {
        allowed: false,
        error: "Permission denied: API key does not have spot trading permission. " +
               "Your key is read-only. To trade, create a new API key with spot trading enabled.",
      };
    }
    return { allowed: true };
  }

  return { allowed: false, error: "Unknown operation" };
}
