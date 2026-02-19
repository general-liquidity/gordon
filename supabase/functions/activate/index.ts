/**
 * Supabase Edge Function: activate
 *
 * Validates an invite code and creates an activation record.
 * Returns a unique token that the CLI caches locally.
 *
 * Requires the `claim_invite` Postgres function (see schema.sql).
 *
 * POST /functions/v1/activate
 * Body: { code, machineId, displayName?, cliVersion, os, arch }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const { code, machineId, displayName, cliVersion, os, arch } = await req.json();

    if (!code || !machineId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: code, machineId" }),
        { status: 400, headers: responseHeaders },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // --- Atomic invite code claim ---
    // The RPC function atomically increments current_uses only if < max_uses
    // and the code hasn't expired. Prevents race conditions.
    const { data: claimed, error: rpcError } = await supabase.rpc("claim_invite", {
      p_code: code,
    });

    // claim_invite may return null, empty array [], or a row object.
    // Handle all falsy/empty cases.
    const claimSucceeded = !rpcError && claimed &&
      !(Array.isArray(claimed) && claimed.length === 0);

    if (!claimSucceeded) {
      // Claim failed — determine why for a helpful error message
      const { data: invite } = await supabase
        .from("invite_codes")
        .select("code, current_uses, max_uses, expires_at")
        .eq("code", code)
        .single();

      if (!invite) {
        return new Response(
          JSON.stringify({ error: "Invalid invite code." }),
          { status: 400, headers: responseHeaders },
        );
      }

      if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
        return new Response(
          JSON.stringify({ error: "Invite code has expired." }),
          { status: 410, headers: responseHeaders },
        );
      }

      if (invite.current_uses >= invite.max_uses) {
        return new Response(
          JSON.stringify({ error: "Invite code has already been used." }),
          { status: 410, headers: responseHeaders },
        );
      }

      return new Response(
        JSON.stringify({ error: "Activation failed. Please try again." }),
        { status: 500, headers: responseHeaders },
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

      // Compensate: decrement current_uses so the invite code isn't permanently consumed
      await supabase.rpc("unclaim_invite", { p_code: code }).catch(() => {});

      return new Response(
        JSON.stringify({ error: "Activation failed. Please try again." }),
        { status: 500, headers: responseHeaders },
      );
    }

    return new Response(
      JSON.stringify({
        token,
        message: "Welcome to Gordon. You're in.",
      }),
      { status: 200, headers: responseHeaders },
    );
  } catch (err) {
    console.error("Activate error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error." }),
      { status: 500, headers: responseHeaders },
    );
  }
});
