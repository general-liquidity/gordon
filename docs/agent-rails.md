# Agent Rails

Gordon now has a first-class `agentRails` layer for three finance-native integrations:

- `Helius`
  - Native Solana wallet, transaction, and token metadata queries
  - Optional MCP fast path via the built-in `helius` plugin manifest
- `MoonPay`
  - Native hosted wallet funding, sell, and swap link generation with signed widget URLs
  - Native quote, limits, transaction, customer-limits, virtual-account, and webhook-verification support
  - Optional MCP fast path via the built-in `moonpay` plugin manifest
- `Polygon x402`
  - Native Gordon payment-intent and header generation for paid APIs and agent-to-agent payments

## Config Model

`agentRails` lives in Gordon config alongside exchanges and brokers.

Provider buckets:

- `walletProviders`
- `chainProviders`
- `paymentProviders`

Each provider supports:

- `authMode`: `native`, `mcp`, or `hybrid`
- `enabled`
- `isDefault`
- `mcpServerId` for built-in MCP sync where applicable

If `agentRails` is empty, Gordon infers defaults from environment variables:

- `HELIUS_API_KEY` or Helius RPC URL -> default Helius chain provider
- `MOONPAY_*` vars -> default MoonPay wallet provider
- `POLYGON_X402_*` vars -> default Polygon payment provider

## Environment Variables

Helius:

- `HELIUS_API_KEY`
- `SOLANA_RPC_URL`
- `JUPITER_REFERRAL_ACCOUNT`
- `JUPITER_FEE_BPS`

MoonPay:

- `MOONPAY_API_KEY`
- `MOONPAY_SECRET_KEY`
- `MOONPAY_WIDGET_URL`
- `MOONPAY_WEBHOOK_API_KEY`
- `MOONPAY_VIRTUAL_ACCOUNTS_PRIVATE_KEY`

Polygon x402:

- `POLYGON_X402_PRIVATE_KEY`
- `POLYGON_X402_RECIPIENT`
- `POLYGON_X402_CHAIN_ID`
- `POLYGON_X402_FACILITATOR_URL`

## Gordon Tool Surface

New Gordon-native tools:

- `get_agent_rails_status`
- `helius_wallet_overview`
- `helius_recent_transactions`
- `helius_token_metadata`
- `moonpay_funding_link`
- `moonpay_swap_link`
- `moonpay_currency_limits`
- `moonpay_quote`
- `moonpay_swap_pairs`
- `moonpay_transactions`
- `moonpay_customer_limits`
- `moonpay_virtual_accounts`
- `moonpay_virtual_account_transactions`
- `moonpay_verify_webhook`
- `polygon_payment_intent`

## Slash Commands

New command surfaces:

- `/wallet`
- `/fund`
- `/pay`
- `/rails`

## Safety

- External payment-intent signing respects `agentRails.requireApprovalForExternalActions`
- When approvals are required, signing a Polygon payment intent is blocked unless Gordon is `ARMED`
- MoonPay execution in Gordon remains approval-safe: Gordon prepares signed links, quotes, limits, and transaction context, but MoonPay still owns the end-user checkout/KYC/payment flow

## MCP Fast Path

When `agentRails.autoSyncMcpPlugins` is enabled, Gordon installs/enables built-in manifests for:

- `helius`
- `moonpay`

These manifests route into the existing Gordon MCP + routing system so the fast path stays productized instead of ad hoc.
