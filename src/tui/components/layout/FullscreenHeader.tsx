import React from "react";
import { Box, Text } from "../../ink-custom/index.ts";
import { useTheme } from "../../themes/ThemeProvider.tsx";
import type { GordonTheme } from "../../themes/themes.ts";
import { GORDON_LOGO, FULL_LOGO_MIN_COLUMNS } from "../../boot/banner.ts";
import {
  collectBootStaticInfo,
  formatAge,
  type BootStaticInfo,
} from "../../boot/bootComposition.ts";
import { BootLivePanel } from "./BootLivePanel.tsx";

// ============================================================================
// FullscreenHeader — the SCROLL-ORIGIN top chrome of the fullscreen screen model
//
// banner (GORDON logo / compact wordmark) + boxed `session` info + the
// live `trading preflight` panel. In inline mode the first two are printed
// pre-Ink as raw ANSI (boot/banner.ts + boot/bootComposition.ts); here the
// SAME data renders as Ink components. Rather than pin them, the fullscreen
// chat viewport renders this header as the FIRST entry of its windowed
// content (VirtualMessageList) so it sits at the top of scroll: the default
// view sticks to the bottom (latest messages) and scrolling up reaches the
// banner + boxes at the session's scroll origin. Data comes from
// collectBootStaticInfo() — not the ANSI strings.
// ============================================================================

export type HeaderVariant = "full" | "compact";

// Row estimates per variant (banner + session box + preflight + margins).
// The session + preflight boxes are ALWAYS rendered — the header is the
// scroll origin (you scroll up to reach it), not a pinned region competing
// with the chat for screen rows, so terminal HEIGHT never shrinks it. Only
// the banner art flexes by terminal WIDTH (full block logo vs one-line
// wordmark). Used by App.tsx to size the chat viewport window.
const FULL_HEADER_ROWS = 26; // 7 logo+version + 9 session box + 9 preflight + 1 margin
const COMPACT_HEADER_ROWS = 20; // 1 wordmark + 9 session box + 9 preflight + 1 margin

/**
 * Width-driven only: the full block logo needs a wide terminal; below that
 * the banner collapses to the one-line wordmark. Both variants keep the
 * session + preflight boxes — they are scroll content, never dropped.
 */
export function resolveHeaderVariant(_rows: number, columns: number): HeaderVariant {
  return columns >= FULL_LOGO_MIN_COLUMNS ? "full" : "compact";
}

/** Approximate rows the header occupies — used to size the chat window. */
export function estimateHeaderRows(variant: HeaderVariant): number {
  return variant === "full" ? FULL_HEADER_ROWS : COMPACT_HEADER_ROWS;
}

function truncateStart(value: string, maxVisible: number): string {
  if (maxVisible <= 0) return "";
  if (value.length <= maxVisible) return value;
  if (maxVisible === 1) return "…";
  return `…${value.slice(-(maxVisible - 1))}`;
}

function truncateEnd(value: string, maxVisible: number): string {
  if (maxVisible <= 0) return "";
  if (value.length <= maxVisible) return value;
  if (maxVisible === 1) return "…";
  return `${Array.from(value).slice(0, maxVisible - 1).join("")}…`;
}

function modeColor(mode: string, theme: GordonTheme): string | undefined {
  switch (mode) {
    case "auto":
      return theme.riskDanger;
    case "ask":
      return theme.uiBrand;
    case "strict":
      return theme.riskSafe;
    case "observe":
      return theme.agentPlanner;
    case "plan":
      return theme.uiInfo;
    case "paper":
      return undefined;
    default:
      return theme.uiBrand;
  }
}

function BannerFull({ version, theme }: { version: string; theme: GordonTheme }): React.JSX.Element {
  return (
    <Box flexDirection="column">
      {GORDON_LOGO.map((line, idx) => (
        <Text key={idx} color={theme.uiBrand}>
          {` ${line}`}
        </Text>
      ))}
      <Box paddingLeft={2}>
        <Text color={theme.uiBrand} bold>{`v${version}`}</Text>
        <Text dimColor>{" · The Frontier Trading Agent · General Liquidity, Inc."}</Text>
      </Box>
    </Box>
  );
}

function BannerWordmark({ version, theme }: { version: string; theme: GordonTheme }): React.JSX.Element {
  return (
    <Box paddingLeft={1}>
      <Text color={theme.uiBrand} bold>{"≫ GORDON"}</Text>
      <Text dimColor>{`  v${version}`}</Text>
    </Box>
  );
}

function SessionRow({
  label,
  children,
  hint,
  showHint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  showHint?: boolean;
}): React.JSX.Element {
  return (
    <Box paddingLeft={2}>
      <Box width={10} flexShrink={0}>
        <Text dimColor>{label}</Text>
      </Box>
      <Box>{children}</Box>
      {hint && showHint ? <Text dimColor>{`  ${hint}`}</Text> : null}
    </Box>
  );
}

function GuardValue({
  name,
  status,
  theme,
}: {
  name: string;
  status: BootStaticInfo["fetchGuard"];
  theme: GordonTheme;
}): React.JSX.Element {
  if (status.enabled && !status.installed) {
    return (
      <>
        <Text>{name} </Text>
        <Text color={theme.riskDanger} bold>✗ NOT INSTALLED</Text>
      </>
    );
  }
  if (!status.enabled) {
    return (
      <>
        <Text>{name} </Text>
        <Text color={theme.riskWarning}>✗ off</Text>
      </>
    );
  }
  return (
    <>
      <Text>{name} </Text>
      <Text color={theme.uiBrand}>✓</Text>
      <Text dimColor> {status.mode}</Text>
    </>
  );
}

function SwitchesValue({ info, theme }: { info: BootStaticInfo; theme: GordonTheme }): React.JSX.Element {
  const switches = info.trippedSwitches;
  if (switches.length === 0) return <Text dimColor>none tripped</Text>;

  const firm = switches.find((entry) => entry.key.scope === "firm");
  if (firm) {
    return (
      <Text color={theme.riskDanger} bold>
        {`HALTED: firm — ${truncateEnd(firm.reason, 60)}`}
      </Text>
    );
  }
  const keys = switches
    .map((entry) => (entry.key.id ? `${entry.key.scope}:${entry.key.id}` : entry.key.scope))
    .join(", ");
  return (
    <Text color={theme.riskDanger} bold>{`tripped: ${keys}`}</Text>
  );
}

function radarText(info: BootStaticInfo): { text: string; dim: boolean } {
  const { radar } = info;
  if (!radar.running) {
    return { text: "off — set GORDON_PROACTIVE_AUTO_START=1 or /radar start", dim: true };
  }
  if (radar.lastCardAgeMs === null) {
    return { text: `${radar.producerCount} producers · warming up`, dim: false };
  }
  return {
    text: `${radar.producerCount} producers · last card ${formatAge(radar.lastCardAgeMs)} ago`,
    dim: false,
  };
}

/** Boxed `session` info — Ink rendering of renderBootStaticRows' 7 rows. */
function SessionBox({
  info,
  columns,
  theme,
}: {
  info: BootStaticInfo;
  columns: number;
  theme: GordonTheme;
}): React.JSX.Element {
  const title = "session";
  const boxWidth = Math.min(columns - 1, 64);
  const topFill = "─".repeat(Math.max(0, boxWidth - title.length - 5));
  const showHints = columns >= 70;
  const isPaper = info.permissionMode === "paper";
  const radar = radarText(info);
  const cwdBudget = Math.max(8, boxWidth - 16);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={theme.uiBorder}>{"┌─ "}</Text>
        <Text dimColor>{title}</Text>
        <Text color={theme.uiBorder}>{` ${topFill}┐`}</Text>
      </Box>
      <Box
        flexDirection="column"
        width={boxWidth}
        borderStyle="single"
        borderColor={theme.uiBorder}
        borderTop={false}
      >
        <SessionRow label="model" hint="/model to change" showHint={showHints}>
          <Text>{`${info.model}${info.effort ? ` ${info.effort}` : ""}`}</Text>
        </SessionRow>
        <SessionRow
          label="mode"
          hint={isPaper ? "/live to exit" : "/auto to change"}
          showHint={showHints}
        >
          <Text color={modeColor(info.permissionMode, theme)}>{info.permissionMode}</Text>
          {isPaper ? (
            <Text color={theme.riskWarning} bold>{" [PAPER]"}</Text>
          ) : null}
        </SessionRow>
        <SessionRow label="thread">
          <Text>{info.threadDisplay}</Text>
        </SessionRow>
        <SessionRow label="cwd">
          <Text>{truncateStart(info.cwd, cwdBudget)}</Text>
        </SessionRow>
        <SessionRow label="guards">
          <GuardValue name="fetch" status={info.fetchGuard} theme={theme} />
          <Text dimColor> · </Text>
          <GuardValue name="fs" status={info.fsGuard} theme={theme} />
        </SessionRow>
        <SessionRow label="switches">
          <SwitchesValue info={info} theme={theme} />
        </SessionRow>
        <SessionRow label="radar">
          {radar.dim ? <Text dimColor>{radar.text}</Text> : <Text>{radar.text}</Text>}
        </SessionRow>
      </Box>
    </Box>
  );
}

interface Props {
  rows: number;
  columns: number;
  /** Session tip forwarded to BootLivePanel. */
  hint: string;
}

export function FullscreenHeader({ rows, columns, hint }: Props): React.JSX.Element {
  const theme = useTheme();
  // Static boot info: sync fs/config reads — gather once per mount, same
  // lifecycle as the pre-Ink print in inline mode.
  const info = React.useMemo(() => collectBootStaticInfo(), []);
  const variant = resolveHeaderVariant(rows, columns);

  // Both variants render the session + preflight boxes — only the banner
  // art differs by width. The boxes are the scroll origin; never dropped.
  return (
    <Box flexDirection="column">
      {variant === "full" ? (
        <BannerFull version={info.version} theme={theme} />
      ) : (
        <BannerWordmark version={info.version} theme={theme} />
      )}
      <SessionBox info={info} columns={columns} theme={theme} />
      <BootLivePanel hint={hint} />
    </Box>
  );
}
