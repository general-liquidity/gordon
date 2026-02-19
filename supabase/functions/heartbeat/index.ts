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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-gordon-token",
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const token = req.headers.get("x-gordon-token");

    if (!token) {
      return new Response(
        JSON.stringify({ error: "Missing x-gordon-token header." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { events = [], cliVersion } = await req.json();

    // Use service_role key to bypass RLS
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
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (activation.status === "revoked") {
      return new Response(
        JSON.stringify({ error: "Access revoked." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
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

    // --- Ingest telemetry events ---

    if (events.length > 0) {
      const rows = events.map((e: { type: string; metadata?: Record<string, unknown>; timestamp?: string }) => ({
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
        // Non-fatal — don't fail the heartbeat for telemetry issues
      }
    }

    // --- Announcements ---
    // Add announcements here when needed (e.g., update notices)
    const announcements: string[] = [];

    return new Response(
      JSON.stringify({ ok: true, announcements }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Heartbeat error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
