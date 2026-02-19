/**
 * Supabase Edge Function: activate
 *
 * Validates an invite code and creates an activation record.
 * Returns a unique token that the CLI caches locally.
 *
 * POST /functions/v1/activate
 * Body: { code, machineId, displayName?, cliVersion, os, arch }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { code, machineId, displayName, cliVersion, os, arch } = await req.json();

    if (!code || !machineId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: code, machineId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Use service_role key to bypass RLS
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // --- Validate invite code ---

    const { data: invite, error: inviteError } = await supabase
      .from("invite_codes")
      .select("*")
      .eq("code", code)
      .single();

    if (inviteError || !invite) {
      return new Response(
        JSON.stringify({ error: "Invalid invite code." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Check expiry
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: "Invite code has expired." }),
        { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Check max uses
    if (invite.current_uses >= invite.max_uses) {
      return new Response(
        JSON.stringify({ error: "Invite code has already been used." }),
        { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- Create activation ---

    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");

    const { error: activationError } = await supabase
      .from("activations")
      .insert({
        invite_code: code,
        machine_id: machineId,
        display_name: displayName || null,
        token,
        cli_version: cliVersion,
        os,
        arch,
      });

    if (activationError) {
      console.error("Activation insert failed:", activationError);
      return new Response(
        JSON.stringify({ error: "Activation failed. Please try again." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Increment usage count
    await supabase
      .from("invite_codes")
      .update({ current_uses: invite.current_uses + 1 })
      .eq("id", invite.id);

    return new Response(
      JSON.stringify({
        token,
        message: "Welcome to Gordon. You're in.",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Activate error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
