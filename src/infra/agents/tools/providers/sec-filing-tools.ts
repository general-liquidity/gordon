/**
 * SEC Filing-Text Tool
 *
 * Surfaces real EDGAR filing text to the agent — the "diff layer" input that
 * was previously a dead-step (the SEC provider returned the filing index page
 * truncated to 5KB, not the document body). Two modes:
 *
 *   - text mode (default): the section body (Risk Factors / MD&A / full),
 *     capped to a model-readable size, for filing-analysis — the agent reads
 *     the REAL language instead of inventing it.
 *   - diff mode (compareToPriorYear): fetch current + prior same-form filing,
 *     extract the section from both, and diff SERVER-SIDE — returns only the
 *     small added/removed segments. The forensic "single best read", without
 *     round-tripping 60KB of filing text through the model.
 *
 * US SEC registrants only. Cold-tier (specialist DD tool).
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { getSECFilingsClient } from "../../../data/providers/sec/sec-filings.ts";
import {
  extractSection,
  diffNamedSection,
  SECTION_MARKERS,
} from "../../../../core/alpha/filing-section-diff.ts";

export const getFilingTextTool = createTool({
  id: "get_filing_text",
  description:
    "Fetch the REAL text of a US company's latest SEC filing (10-K/10-Q/8-K) from EDGAR — never invent filing language. " +
    "section: 'risk_factors' (default) | 'mdna' | 'full'. " +
    "Set compareToPriorYear:true for the year-over-year section DIFF (new/removed language vs the prior same-form filing), computed server-side — the forensic 'single best read'. " +
    "Text mode returns the section body (capped); diff mode returns only the changed segments. US SEC registrants only.",
  inputSchema: z.object({
    ticker: z.string().describe("US-listed ticker, e.g. AAPL"),
    form: z.enum(["10-K", "10-Q", "8-K"]).optional().describe("Default 10-K"),
    section: z.enum(["risk_factors", "mdna", "full"]).optional().describe("Default risk_factors"),
    compareToPriorYear: z
      .boolean()
      .optional()
      .describe("If true, return the YoY diff of the section vs the prior same-form filing"),
    maxChars: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Cap on returned text (text mode). Default 16000 (section) / 12000 (full)."),
  }),
  outputSchema: z.object({
    ticker: z.string(),
    form: z.string(),
    section: z.string(),
    mode: z.enum(["text", "diff"]),
    found: z.boolean(),
    accessionNumber: z.string().optional(),
    filingDate: z.string().optional(),
    url: z.string().optional(),
    // text mode
    text: z.string().optional(),
    truncated: z.boolean().optional(),
    charCount: z.number().optional(),
    // diff mode
    priorAccessionNumber: z.string().optional(),
    priorFilingDate: z.string().optional(),
    added: z.array(z.string()).optional(),
    removed: z.array(z.string()).optional(),
    addedCount: z.number().optional(),
    removedCount: z.number().optional(),
    unchangedCount: z.number().optional(),
    summary: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({
    ticker,
    form,
    section,
    compareToPriorYear,
    maxChars,
  }: {
    ticker: string;
    form?: "10-K" | "10-Q" | "8-K";
    section?: "risk_factors" | "mdna" | "full";
    compareToPriorYear?: boolean;
    maxChars?: number;
  }) => {
    const f = form ?? "10-K";
    const wantSection = section ?? "risk_factors";
    const sec = getSECFilingsClient();
    const base = { ticker: ticker.toUpperCase(), form: f, section: wantSection };

    try {
      const current = await sec.getFilingDocument(ticker, f, 0);
      if (!current) {
        return {
          ...base,
          mode: "text" as const,
          found: false,
          error: `No ${f} found for ${ticker.toUpperCase()} (US SEC registrants only).`,
        };
      }

      if (compareToPriorYear) {
        // Full-text diff is too noisy/large; restrict to a named section.
        const diffSection = wantSection === "mdna" ? "mdna" : "risk_factors";
        const prior = await sec.getFilingDocument(ticker, f, 1);
        if (!prior) {
          return {
            ...base,
            section: diffSection,
            mode: "diff" as const,
            found: true,
            accessionNumber: current.accessionNumber,
            filingDate: current.filingDate,
            url: current.url,
            error: `Only one ${f} available for ${ticker.toUpperCase()} — no prior filing to diff.`,
          };
        }
        const d = diffNamedSection(prior.text, current.text, diffSection);
        return {
          ...base,
          section: diffSection,
          mode: "diff" as const,
          found: true,
          accessionNumber: current.accessionNumber,
          filingDate: current.filingDate,
          url: current.url,
          priorAccessionNumber: prior.accessionNumber,
          priorFilingDate: prior.filingDate,
          added: d.added,
          removed: d.removed,
          addedCount: d.addedCount,
          removedCount: d.removedCount,
          unchangedCount: d.unchangedCount,
          summary: d.summary,
        };
      }

      // Text mode.
      let body = current.text;
      if (wantSection !== "full") {
        const m = wantSection === "mdna" ? SECTION_MARKERS.mdna : SECTION_MARKERS.risk_factors;
        const extracted = extractSection(current.text, m.start, m.end);
        if (!extracted) {
          return {
            ...base,
            mode: "text" as const,
            found: true,
            accessionNumber: current.accessionNumber,
            filingDate: current.filingDate,
            url: current.url,
            text: "",
            truncated: false,
            charCount: 0,
            error: `Section '${wantSection}' not located in ${ticker.toUpperCase()} ${f} (${current.filingDate}). Try section:'full'.`,
          };
        }
        body = extracted;
      }
      const cap = maxChars ?? (wantSection === "full" ? 12000 : 16000);
      const truncated = body.length > cap;
      const text = truncated ? body.slice(0, cap) : body;
      return {
        ...base,
        mode: "text" as const,
        found: true,
        accessionNumber: current.accessionNumber,
        filingDate: current.filingDate,
        url: current.url,
        text,
        truncated,
        charCount: text.length,
      };
    } catch (err) {
      return {
        ...base,
        mode: "text" as const,
        found: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});

export const secFilingTools = { get_filing_text: getFilingTextTool };
