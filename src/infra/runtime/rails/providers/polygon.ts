import { randomUUID } from "node:crypto";
import { Wallet } from "ethers";

import type { PaymentHeadersResult, PaymentIntent, PaymentProvider, SignedPaymentIntent } from "../types.ts";
import type { PaymentProviderConfig } from "../../../types/index.ts";

export class PolygonX402Provider implements PaymentProvider {
  readonly id = "polygon" as const;
  readonly config: PaymentProviderConfig;
  private readonly privateKey?: string;
  private readonly defaultRecipient?: string;
  private readonly defaultFacilitatorUrl?: string;

  constructor(config: PaymentProviderConfig) {
    this.config = config;
    this.privateKey = process.env.POLYGON_X402_PRIVATE_KEY;
    this.defaultRecipient = process.env.POLYGON_X402_RECIPIENT || config.recipient;
    this.defaultFacilitatorUrl = process.env.POLYGON_X402_FACILITATOR_URL || config.facilitatorUrl;
  }

  getStatus() {
    const warnings: string[] = [];
    if (!this.defaultRecipient) {
      warnings.push("POLYGON_X402_RECIPIENT is not configured; payment intents need an explicit recipient.");
    }
    if (!this.privateKey) {
      warnings.push("POLYGON_X402_PRIVATE_KEY is not configured; Gordon can generate unsigned payment intents only.");
    }
    const transport: "native" | "mcp" | "hybrid" =
      this.config.authMode === "hybrid" ? "hybrid" : this.config.authMode;
    return {
      id: this.id,
      kind: "payment" as const,
      configured: Boolean(this.defaultRecipient || this.privateKey),
      enabled: this.config.enabled,
      authMode: this.config.authMode,
      transport,
      mcpServerId: this.config.mcpServerId,
      warnings,
      details: {
        network: this.config.network,
        facilitatorUrl: this.defaultFacilitatorUrl,
      },
    };
  }

  async createPaymentIntent(input: {
    resource: string;
    amountUsd: string;
    currency?: string;
    recipient?: string;
    description?: string;
    expiresInMinutes?: number;
  }): Promise<PaymentIntent> {
    const recipient = input.recipient || this.defaultRecipient;
    if (!recipient) {
      throw new Error("Polygon x402 recipient is not configured.");
    }

    const wallet = this.privateKey ? new Wallet(this.privateKey) : null;
    const issuedAt = new Date();
    const expiresAt = typeof input.expiresInMinutes === "number"
      ? new Date(issuedAt.getTime() + input.expiresInMinutes * 60_000).toISOString()
      : undefined;

    return {
      provider: "polygon",
      network: this.config.network || process.env.POLYGON_X402_CHAIN_ID || "polygon",
      resource: input.resource,
      recipient,
      amountUsd: input.amountUsd,
      currency: input.currency || "USDC",
      payer: wallet?.address,
      facilitatorUrl: this.defaultFacilitatorUrl,
      description: input.description,
      nonce: randomUUID(),
      issuedAt: issuedAt.toISOString(),
      expiresAt,
    };
  }

  async signPaymentIntent(intent: PaymentIntent): Promise<SignedPaymentIntent | PaymentIntent> {
    if (!this.privateKey) {
      return intent;
    }

    const wallet = new Wallet(this.privateKey);
    const signaturePayload = JSON.stringify({
      provider: intent.provider,
      network: intent.network,
      resource: intent.resource,
      recipient: intent.recipient,
      amountUsd: intent.amountUsd,
      currency: intent.currency,
      payer: intent.payer || wallet.address,
      nonce: intent.nonce,
      issuedAt: intent.issuedAt,
      expiresAt: intent.expiresAt,
      description: intent.description,
    });
    const signature = await wallet.signMessage(signaturePayload);

    return {
      ...intent,
      payer: intent.payer || wallet.address,
      signature,
      signatureType: "eip191",
    };
  }

  buildPaymentHeaders(intent: SignedPaymentIntent | PaymentIntent): PaymentHeadersResult {
    const headers: Record<string, string> = {
      "x-gordon-payment-resource": intent.resource,
      "x-gordon-payment-network": intent.network,
      "x-gordon-payment-amount-usd": intent.amountUsd,
      "x-gordon-payment-currency": intent.currency,
      "x-gordon-payment-recipient": intent.recipient,
      "x-gordon-payment-nonce": intent.nonce,
      "x-gordon-payment-issued-at": intent.issuedAt,
    };

    if (intent.payer) {
      headers["x-gordon-payment-payer"] = intent.payer;
    }
    if (intent.expiresAt) {
      headers["x-gordon-payment-expires-at"] = intent.expiresAt;
    }
    if ("signature" in intent) {
      headers["x-gordon-payment-signature"] = intent.signature;
      headers["x-gordon-payment-signature-type"] = intent.signatureType;
    }
    if (intent.facilitatorUrl) {
      headers["x-gordon-payment-facilitator"] = intent.facilitatorUrl;
    }

    return {
      provider: "polygon",
      headers,
      intent,
    };
  }
}
