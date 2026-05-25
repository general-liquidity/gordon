/**
 * Agent-facing quote-verification tool.
 *
 * Wraps `verifyQuote` from src/infra/platform/audit/quoteVerification.ts
 * so the model can self-check a quoted snippet against a source text
 * before stating it as fact. Surfaced to Gordon + Researcher (read-only
 * agents that extract content from external text).
 *
 * Typical use: the agent extracts a quote from a news article, SEC
 * filing, or transcript; before persisting or surfacing the quote as a
 * citation, the agent calls `verify_quote_in_text` with the quote and
 * the article body. The tool returns whether the quote actually
 * appears in the source.
 *
 * Method options:
 *   - "string_match" (default): normalized substring match — handles
 *     whitespace reflow, accents, casing.
 *   - "regex": caller-provided pattern. Malformed regex returns false.
 *   - "manual": caller asserts verified out-of-band (audit-only label).
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  verifyQuote,
  verifyQuotes,
  summarizeQuoteVerifications,
} from "../../../platform/audit/quoteVerification.ts";

export const verifyQuoteInTextTool = createTool({
  id: "verify_quote_in_text",
  description: [
    "Verify that a quoted snippet actually appears in a source text.",
    "Returns true when the quote is grounded, false when the model",
    "hallucinated or paraphrased instead of quoting verbatim.",
    "",
    "Use BEFORE persisting any 'the article says X' / 'the filing",
    "states Y' claim. Substring match is normalized for whitespace,",
    "accents, and case — copy-paste from a PDF still verifies.",
    "",
    "For a batch of quotes against the same source, pass `quotes` (array)",
    "instead of `quote` (single). Mutually exclusive — exactly one of",
    "`quote` or `quotes` must be supplied.",
  ].join("\n"),
  inputSchema: z
    .object({
      quote: z.string().min(1).optional().describe("Single quote to verify."),
      quotes: z
        .array(z.string().min(1))
        .optional()
        .describe("Batch of quotes to verify against the same source."),
      sourceText: z
        .string()
        .min(1)
        .describe("The full source text the quote was extracted from."),
      method: z
        .enum(["string_match", "regex", "manual"])
        .optional()
        .describe("Verification method. Default 'string_match'."),
    })
    .refine((d) => (d.quote === undefined) !== (d.quotes === undefined), {
      message: "Supply exactly one of `quote` or `quotes`.",
    }),
  outputSchema: z.object({
    verified: z.boolean().optional(),
    method: z.string(),
    batch: z
      .object({
        total: z.number(),
        verified: z.number(),
        unverified: z.number(),
        verifiedRate: z.number(),
        outcomes: z.array(
          z.object({
            quote: z.string(),
            verified: z.boolean(),
          }),
        ),
      })
      .optional(),
  }),
  execute: async ({
    quote,
    quotes,
    sourceText,
    method,
  }: {
    quote?: string;
    quotes?: string[];
    sourceText: string;
    method?: "string_match" | "regex" | "manual";
  }) => {
    const resolvedMethod = method ?? "string_match";
    if (quotes !== undefined) {
      const outcomes = verifyQuotes(quotes, sourceText, { method: resolvedMethod });
      const summary = summarizeQuoteVerifications(outcomes);
      return {
        method: resolvedMethod,
        batch: {
          ...summary,
          outcomes: outcomes.map((o) => ({ quote: o.quote, verified: o.verified })),
        },
      };
    }
    return {
      verified: verifyQuote(quote!, sourceText, { method: resolvedMethod }),
      method: resolvedMethod,
    };
  },
});

export const quoteVerifyTools = {
  verify_quote_in_text: verifyQuoteInTextTool,
};
