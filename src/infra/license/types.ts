/**
 * License System Types & Constants
 *
 * Supabase-backed invite code activation + heartbeat telemetry.
 * The anon key is safe to embed — RLS policies restrict access.
 */

// ============================================================================
// Supabase Configuration
// Replace these with your actual Supabase project values.
// ============================================================================

export const SUPABASE_URL = process.env.GORDON_LICENSE_URL ?? "https://qnizqvmzhmhlczvivrzl.supabase.co";
export const SUPABASE_ANON_KEY = process.env.GORDON_LICENSE_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFuaXpxdm16aG1obGN6dml2cnpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1MjEwMTMsImV4cCI6MjA4NzA5NzAxM30.UQJYTB3HvMawctIBHFZxEazxJvsU9Aw-iMAQRhXb98s";

// ============================================================================
// License File Schema
// ============================================================================

export interface LicenseFile {
  token: string;
  activatedAt: string;
  lastValidated: string;
  displayName: string;
}

// ============================================================================
// API Types
// ============================================================================

export interface ActivateRequest {
  code: string;
  machineId: string;
  displayName?: string;
  cliVersion: string;
  os: string;
  arch: string;
}

export interface ActivateResponse {
  token: string;
  message: string;
}

export interface HeartbeatRequest {
  events: TelemetryEvent[];
  cliVersion: string;
}

export interface HeartbeatResponse {
  ok: boolean;
  announcements?: string[];
}

export interface TelemetryEvent {
  type: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

// ============================================================================
// Constants
// ============================================================================

/** How long a cached token is considered fresh (no network call needed) */
export const TOKEN_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** How often to flush batched telemetry events */
export const HEARTBEAT_INTERVAL_MS = 60 * 1000; // 60 seconds

/** Timeout for API calls */
export const API_TIMEOUT_MS = 5000;
