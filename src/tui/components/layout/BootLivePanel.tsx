import React from "react";
import { Box, Text, useStdout } from "../../ink-custom/index.ts";
import {
  BOOT_TICKER_REFRESH_MS,
  loadBootLiveData,
  refreshBootTicker,
  type BootLiveData,
} from "../../boot/bootLiveData.ts";

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

function formatTickerPrice(value: number | null): string {
  if (value === null) return "—";
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
      {data.venue.paper ? (
        <Text>(paper)</Text>
      ) : (
        <Text color="red" bold>
          (live)
        </Text>
      )}
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
  if (data.audit.state === "broken")
    return (
      <Text color="red" bold>
        CHAIN BROKEN — run /audit verify
      </Text>
    );
  return <Text dimColor>unavailable</Text>;
}

function TickerLine({ data }: { data: BootLiveData | null }): React.JSX.Element {
  if (!data) return <Text dimColor>fetching market data...</Text>;
  if (!data.ticker || data.ticker.length === 0)
    return <Text dimColor>market data unavailable</Text>;

  return (
    <Box>
      {data.ticker.map((item, index) => {
        const change =
          item.changePercent24h === null
            ? "—"
            : `${item.changePercent24h >= 0 ? "+" : ""}${item.changePercent24h.toFixed(1)}%`;
        const changeColor =
          item.changePercent24h === null ? undefined : item.changePercent24h >= 0 ? "green" : "red";
        return (
          <React.Fragment key={`${item.kind}:${item.symbol}`}>
            {index > 0 && <Text> </Text>}
            <Text bold>{item.symbol}</Text>
            <Text> {formatTickerPrice(item.priceUsd)} </Text>
            {changeColor ? (
              <Text color={changeColor}>{change}</Text>
            ) : (
              <Text dimColor>{change}</Text>
            )}
          </React.Fragment>
        );
      })}
      {data.tickerExtra > 0 ? <Text dimColor> +{data.tickerExtra}</Text> : null}
    </Box>
  );
}

export function BootLivePanel({ hint }: Props): React.JSX.Element | null {
  const { stdout } = useStdout();
  const columns = stdout?.columns;
  const [data, setData] = React.useState<BootLiveData | null>(null);

  React.useEffect(() => {
    let mounted = true;
    let tickerTimer: ReturnType<typeof setInterval> | undefined;
    let tickerRefreshInFlight = false;

    const refreshTicker = async (symbols: BootLiveData["tickerSymbols"]) => {
      if (tickerRefreshInFlight || symbols.length === 0) return;
      tickerRefreshInFlight = true;
      try {
        const ticker = await refreshBootTicker(symbols);
        if (mounted && ticker) {
          setData((previous) => (previous ? { ...previous, ticker } : previous));
        }
      } finally {
        tickerRefreshInFlight = false;
      }
    };

    void loadBootLiveData().then((loaded) => {
      if (!mounted) return;
      setData(loaded);
      if (loaded.tickerSymbols.length > 0) {
        tickerTimer = setInterval(() => {
          void refreshTicker(loaded.tickerSymbols);
        }, BOOT_TICKER_REFRESH_MS);
      }
    });
    return () => {
      mounted = false;
      if (tickerTimer) clearInterval(tickerTimer);
    };
  }, []);

  if (!columns) return null;

  const title = "trading preflight";
  // -1 terminal safety margin, capped so the box matches the session box scale.
  const boxWidth = Math.min(columns - 1, 64);
  // Top border is drawn manually so the section title sits in it
  // (`┌─ trading preflight ─…┐`) — ink boxes have no title support.
  const topFill = "─".repeat(Math.max(0, boxWidth - title.length - 5));
  const dividerWidth = Math.max(0, boxWidth - 4);
  const showEquity = data?.venue.connectivity !== "none";

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="gray">{"┌─ "}</Text>
        <Text dimColor>{title}</Text>
        <Text color="gray">{` ${topFill}┐`}</Text>
      </Box>
      <Box
        flexDirection="column"
        width={boxWidth}
        borderStyle="single"
        borderColor="gray"
        borderTop={false}
      >
        <Row label="venue">
          <VenueValue data={data} />
        </Row>
        {showEquity && (
          <Row label="equity">
            {data?.equityUsd != null ? (
              <Text>{formatCurrency(data.equityUsd)}</Text>
            ) : (
              <Text dimColor>—</Text>
            )}
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
    </Box>
  );
}
