import { Box, Text } from "../../ink-custom";

// ============================================================================
// CapabilitiesSection — Summary of what an MCP server exposes
//
// ● 45 tools    get_price, place_order, get_balance, +42 more
// ● 3 resources  market_data, account, positions
// ○ 0 prompts
// ============================================================================

interface Capability {
  type: "tools" | "resources" | "prompts";
  count: number;
  examples?: string[];
}

interface Props {
  serverName: string;
  capabilities: Capability[];
}

const MAX_EXAMPLES = 3;

const TYPE_LABEL: Record<Capability["type"], string> = {
  tools: "tools",
  resources: "resources",
  prompts: "prompts",
};

function formatExamples(examples: string[] | undefined, count: number): string {
  if (!examples || examples.length === 0) return "";
  const shown = examples.slice(0, MAX_EXAMPLES);
  const remainder = count - shown.length;
  const base = shown.join(", ");
  return remainder > 0 ? `${base}, +${remainder} more` : base;
}

export function CapabilitiesSection({ serverName, capabilities }: Props) {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>{serverName}</Text>
        <Text dimColor> capabilities:</Text>
      </Box>

      {capabilities.map((cap) => {
        const hasAny = cap.count > 0;
        const icon = hasAny ? "●" : "○";
        const examplesStr = formatExamples(cap.examples, cap.count);

        return (
          <Box key={cap.type}>
            <Text color={hasAny ? "cyanBright" : "gray"}>
              {"  "}
              {icon}{" "}
            </Text>
            <Text bold={hasAny} color={hasAny ? undefined : "gray"}>
              {String(cap.count).padStart(2)} {TYPE_LABEL[cap.type].padEnd(12)}
            </Text>
            {examplesStr ? <Text dimColor>{examplesStr}</Text> : null}
          </Box>
        );
      })}
    </Box>
  );
}
