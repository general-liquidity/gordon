import React from "react";
import { Box, Text, useStdout } from "../../ink-custom/index.ts";
import { loadBootLiveData, type BootLiveData } from "../../boot/bootLiveData.ts";

interface Props {
  hint: string;
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <Box paddingLeft={2}>
      <Box width={10}>
        <Text dimColor>{label}</Text>
      </Box>
      <Box>{children}</Box>
    </Box>
  );
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatTickerPrice(value: number): string {
  return `$${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 1_000 ? 0 : 2,
  }).format(value)}`;
}

function VenueValue({ data }: { data: BootLiveData | null }): React.JSX.Element {
  if (!data) return <Text dimColor>connecting...</Text>;
  if (data.venue.connectivity === "none") {
    return <Text dimColor>no venue — /configure exchange to connect</Text>;
  }

  const label = data.venue.label ?? "venue";
  return (
    <>
      <Text>{label}</Text>
      <Text> </Text>
      {data.venue.paper ? <Text>(paper)</Text> : <Text color="red" bold>(live)</Text>}
      <Text dimColor> · </Text>
      {data.venue.connectivity === "connected" ? (
        <>
          <Text>connected </Text>
          <Text color="rgb(52,238,176)">✓</Text>
        </>
      ) : data.venue.connectivity === "offline" ? (
        <Text color="yellow">offline — /doctor to diagnose</Text>
      ) : (
        <Text dimColor>connecting...</Text>
      )}
    </>
  );
}

function AuditValue({ data }: { data: BootLiveData | null }): React.JSX.Element {
  if (!data || data.audit.state === "checking") return <Text dimColor>verifying chain...</Text>;
  if (data.audit.state === "ok") return <Text>chain ok ({data.audit.checked} traces)</Text>;
  if (data.audit.state === "broken") return <Text color="red" bold>CHAIN BROKEN — run /audit verify</Text>;
  return <Text dimColor>unavailable</Text>;
}

function TickerLine({ data }: { data: BootLiveData | null }): React.JSX.Element {
  if (!data) return <Text dimColor>fetching market data...</Text>;
  if (!data.ticker || data.ticker.length === 0) return <Text dimColor>market data unavailable</Text>;

  return (
    <Box>
      {data.ticker.map((item, index) => {
        const change = `${item.changePercent24h >= 0 ? "+" : ""}${item.changePercent24h.toFixed(1)}%`;
        return (
          <React.Fragment key={item.symbol}>
            {index > 0 && <Text>    </Text>}
            <Text bold>{item.symbol}</Text>
            <Text> {formatTickerPrice(item.priceUsd)} </Text>
            <Text color={item.changePercent24h >= 0 ? "green" : "red"}>{change}</Text>
          </React.Fragment>
        );
      })}
    </Box>
  );
}

export function BootLivePanel({ hint }: Props): React.JSX.Element | null {
  const { stdout } = useStdout();
  const columns = stdout?.columns;
  const [data, setData] = React.useState<BootLiveData | null>(null);

  React.useEffect(() => {
    let mounted = true;
    void loadBootLiveData().then((loaded) => {
      if (mounted) setData(loaded);
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (!columns) return null;

  const dividerWidth = Math.min(columns, 60);
  const showEquity = !data || data.venue.connectivity !== "none";

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Row label="venue">
        <VenueValue data={data} />
      </Row>
      {showEquity && (
        <Row label="equity">
          {data?.equityUsd != null ? <Text>{formatCurrency(data.equityUsd)}</Text> : <Text dimColor>—</Text>}
        </Row>
      )}
      <Row label="audit">
        <AuditValue data={data} />
      </Row>
      <Box paddingLeft={2}>
        <Text dimColor>{"─".repeat(dividerWidth)}</Text>
      </Box>
      <Box paddingLeft={2}>
        <TickerLine data={data} />
      </Box>
      <Box paddingLeft={2}>
        <Text dimColor>Tip: {hint}</Text>
      </Box>
    </Box>
  );
}
