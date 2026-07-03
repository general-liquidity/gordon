/**
 * Supabase Edge Function: heartbeat
 *
 * Validates token, updates last_seen, ingests batched telemetry events.
 * Returns announcements (e.g., update available, maintenance notice).
 *
 * POST /functions/v1/heartbeat
 * Headers: x-gordon-token: <token>
 * Body: { events: [{ type, metadata?, timestamp }], cliVersion }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAX_EVENTS_PER_BATCH = 100;
const MAX_METADATA_SIZE = 4096;
const MAX_EVENT_TYPE_LENGTH = 128;

// No wildcard CORS — this is a CLI-only endpoint
const responseHeaders = {
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  // Reject browser preflight — CLI doesn't send OPTIONS
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 405 });
  }

  try {
    const token = req.headers.get("x-gordon-token");

    if (!token) {
      return new Response(
        JSON.stringify({ error: "Missing x-gordon-token header." }),
        { status: 401, headers: responseHeaders },
      );
    }

    const { events = [], cliVersion } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // --- Validate token ---

    const { data: activation, error: lookupError } = await supabase
      .from("activations")
      .select("id, status")
      .eq("token", token)
      .single();

    if (lookupError || !activation) {
      return new Response(
        JSON.stringify({ error: "Invalid token." }),
        { status: 401, headers: responseHeaders },
      );
    }

    if (activation.status === "revoked") {
      return new Response(
        JSON.stringify({ error: "Access revoked." }),
        { status: 403, headers: responseHeaders },
      );
    }

    // --- Update last_seen ---

    await supabase
      .from("activations")
      .update({
        last_seen_at: new Date().toISOString(),
        cli_version: cliVersion || undefined,
      })
      .eq("id", activation.id);

    // --- Ingest telemetry events (with validation) ---

    if (Array.isArray(events) && events.length > 0) {
      // Cap batch size and validate each event
      const validatedEvents = events
        .slice(0, MAX_EVENTS_PER_BATCH)
        .filter((e: unknown): e is { type: string; metadata?: Record<string, unknown>; timestamp?: string } => {
          if (!e || typeof e !== "object") return false;
          const evt = e as Record<string, unknown>;
          if (typeof evt.type !== "string" || evt.type.length > MAX_EVENT_TYPE_LENGTH) return false;
          if (evt.metadata) {
            try {
              if (JSON.stringify(evt.metadata).length > MAX_METADATA_SIZE) return false;
            } catch {
              return false; // circular reference or other serialization error
            }
          }
          return true;
        });

      if (validatedEvents.length > 0) {
        const rows = validatedEvents.map((e) => ({
          activation_id: activation.id,
          event_type: e.type,
          metadata: e.metadata || {},
          cli_version: cliVersion,
          created_at: e.timestamp || new Date().toISOString(),
        }));

        const { error: insertError } = await supabase
          .from("telemetry_events")
          .insert(rows);

        if (insertError) {
          console.error("Telemetry insert failed:", insertError);
        }
      }
    }

    // --- Announcements ---
    const announcements: string[] = [];

    return new Response(
      JSON.stringify({ ok: true, announcements }),
      { status: 200, headers: responseHeaders },
    );
  } catch (err) {
    console.error("Heartbeat error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error." }),
      { status: 500, headers: responseHeaders },
    );
  }
});
