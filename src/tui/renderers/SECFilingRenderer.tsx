import React from "react";
import { Box, Text } from "ink";
import {
  DataTable,
  timeAgo,
  type Column,
} from "../components/DataTable.js";

/**
 * SECFilingRenderer -- SEC filing search results table
 * DATE(12) FORM(8) COMPANY(24) DESCRIPTION(30)
 *
 * Detail view shows first 50 lines of filing text in a collapsible block.
 */

interface FilingRow {
  filedDate: string;
  formType: string;
  companyName: string;
  description: string;
  accessionNumber: string;
  url: string;
}

interface Props {
  data: FilingRow[];
  /** Optional full-text detail for a selected filing */
  detail?: { accessionNumber: string; fullText: string } | null;
}

const COLUMNS: Column<FilingRow>[] = [
  {
    key: "filedDate",
    header: "DATE",
    width: 12,
    align: "left",
    format: (v) => {
      const s = String(v);
      // Show relative time if parseable, otherwise raw date
      if (s && s !== "unknown") {
        try {
          return new Date(s).toISOString().slice(0, 10);
        } catch {
          return s.slice(0, 10);
        }
      }
      return s;
    },
  },
  {
    key: "formType",
    header: "FORM",
    width: 8,
    align: "left",
    color: (v) => {
      const form = String(v);
      if (form === "10-K") return "cyan";
      if (form === "10-Q") return "blue";
      if (form === "8-K") return "yellow";
      return undefined;
    },
  },
  {
    key: "companyName",
    header: "COMPANY",
    width: 24,
    align: "left",
    format: (v) => {
      const s = String(v);
      return s.length > 23 ? s.slice(0, 22) + "\u2026" : s;
    },
  },
  {
    key: "description",
    header: "DESCRIPTION",
    width: 30,
    align: "left",
    format: (v) => {
      const s = String(v);
      return s.length > 29 ? s.slice(0, 28) + "\u2026" : s;
    },
  },
];

export function SECFilingRenderer({ data, detail }: Props) {
  return (
    <Box flexDirection="column">
      <DataTable
        columns={COLUMNS as unknown as Column<Record<string, unknown>>[]}
        data={data as unknown as Record<string, unknown>[]}
      />

      {detail && detail.fullText && (
        <Box
          flexDirection="column"
          marginTop={1}
          paddingLeft={2}
          borderStyle="single"
          borderColor="gray"
        >
          <Text bold color="cyan">
            Filing Detail: {detail.accessionNumber}
          </Text>
          <Box marginTop={1}>
            <Text dimColor wrap="wrap">
              {detail.fullText
                .split("\n")
                .slice(0, 50)
                .join("\n")}
            </Text>
          </Box>
          {detail.fullText.split("\n").length > 50 && (
            <Text dimColor italic>
              ... ({detail.fullText.split("\n").length - 50} more lines)
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}
