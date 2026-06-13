import React from "react";
import { Box, Text } from "../../ink-custom";
import {
  GORDON_LOGO,
  FULL_LOGO_MIN_COLUMNS,
} from "../../boot/banner.ts";
import {
  formatAge,
  type BootStaticInfo,
} from "../../boot/bootComposition.ts";
import type { KillSwitchKey } from "../../../infra/safety/killSwitches.ts";
import type { OutboundFetchGuardStatus } from "../../../infra/safety/outboundFetchGuard.ts";
import type { FilesystemWriteGuardStatus } from "../../../infra/safety/filesystemWriteGuardInstaller.ts";

// ============================================================================
// BootHeader — native-Ink banner + session box, committed to <Static>.
//
// In inline (non-fullscreen) mode the banner + session box used to be raw-ANSI
// printed to scrollback before Ink mounted (src/tui/index.tsx). When the live
// region overflows the terminal (e.g. a tall slash-command menu), Ink's
// clamped cursor-up redraw overwrites the topmost scrollback lines — the banner
// vanished while the lower session box partially survived. Rendering them as
// native Ink children inside <Static> makes Ink commit them to scrollback once
// and exclude them from the live-frame erase math, so they survive scroll-up.
//
// Embedded ANSI inside <Text> is NOT reliable in this fork (the SGR passes
// through but the glyphs are dropped), so every colour here is a native Text
// prop — we do not reuse the raw-ANSI renderBanner/renderBootStaticRows output.
// ============================================================================

const TEAL = "rgb(52,238,176)";

const MODE_COLOR: Record<string, string | undefined> = {
  auto: "red",
  ask: TEAL,
  strict: "green",
  paper: undefined,
  observe: "magenta",
  plan: "blue",
};

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

function keyToString(key: KillSwitchKey): string {
  return key.id ? `${key.scope}:${key.id}` : key.scope;
}

function truncateStart(value: string, maxVisible: number): string {
  if (maxVisible <= 0) return "";
  if (value.length <= maxVisible) return value;
  if (maxVisible === 1) return "…";
  return `…${value.slice(-(maxVisible - 1))}`;
}

function Banner({ columns, version }: { columns: number; version: string }): React.JSX.Element {
  if (columns >= FULL_LOGO_MIN_COLUMNS) {
    return (
      <Box flexDirection="column">
        {GORDON_LOGO.map((line, i) => (
          <Text key={i} color={TEAL}>{` ${line}`}</Text>
        ))}
        <Box>
          <Text color={TEAL} bold>{`  v${version}`}</Text>
          <Text dimColor>{" · The Frontier Trading Agent · General Liquidity, Inc."}</Text>
        </Box>
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={TEAL} bold>{"  ≫ GORDON"}</Text>
        <Text dimColor>{`  v${version}`}</Text>
      </Box>
      <Text dimColor>{"  The Frontier Trading Agent · General Liquidity, Inc."}</Text>
    </Box>
  );
}

function GuardValue({ name, status }: {
  name: string;
  status: OutboundFetchGuardStatus | FilesystemWriteGuardStatus;
}): React.JSX.Element {
  if (status.enabled && !status.installed) {
    return (
      <>
        <Text>{name} </Text>
        <Text color="red" bold>✗ NOT INSTALLED</Text>
      </>
    );
  }
  if (!status.enabled) {
    return (
      <>
        <Text>{name} </Text>
        <Text color="yellow">✗ off</Text>
      </>
    );
  }
  return (
    <>
      <Text>{name} </Text>
      <Text color={TEAL}>✓</Text>
      <Text dimColor> {status.mode}</Text>
    </>
  );
}

function SwitchesValue({ info }: { info: BootStaticInfo }): React.JSX.Element {
  if (info.trippedSwitches.length === 0) return <Text dimColor>none tripped</Text>;
  const firm = info.trippedSwitches.find((entry) => entry.key.scope === "firm");
  if (firm) return <Text color="red" bold>HALTED: firm — {firm.reason}</Text>;
  return (
    <Text color="red" bold>
      tripped: {info.trippedSwitches.map((entry) => keyToString(entry.key)).join(", ")}
    </Text>
  );
}

function RadarValue({ info }: { info: BootStaticInfo }): React.JSX.Element {
  const { radar } = info;
  if (!radar.running) {
    return <Text dimColor>off — set GORDON_PROACTIVE_AUTO_START=1 or /radar start</Text>;
  }
  if (radar.lastCardAgeMs === null) {
    return <Text>{radar.producerCount} producers · warming up</Text>;
  }
  return <Text>{radar.producerCount} producers · last card {formatAge(radar.lastCardAgeMs)} ago</Text>;
}

function SessionBox({ info, columns }: { info: BootStaticInfo; columns: number }): React.JSX.Element {
  const title = "session";
  const boxWidth = Math.min(columns - 1, 64);
  const topFill = "─".repeat(Math.max(0, boxWidth - title.length - 5));
  const valueBudget = Math.max(0, boxWidth - 2 - 2 - 10);
  const showHints = columns >= 70;

  const isPaper = info.permissionMode === "paper";
  const modeColor = MODE_COLOR[info.permissionMode] ?? TEAL;
  const modelValue = `${info.model}${info.effort ? ` ${info.effort}` : ""}`;

  return (
    <Box flexDirection="column">
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
        <Row label="model">
          <Text>{modelValue}</Text>
          {showHints && <Text dimColor>  /model to change</Text>}
        </Row>
        <Row label="mode">
          <Text color={modeColor}>{info.permissionMode}</Text>
          {isPaper && <Text color="yellow" bold> [PAPER]</Text>}
          {showHints && <Text dimColor>  {isPaper ? "/live to exit" : "/auto to change"}</Text>}
        </Row>
        <Row label="thread">
          <Text>{info.threadDisplay}</Text>
        </Row>
        <Row label="cwd">
          <Text>{truncateStart(info.cwd, valueBudget)}</Text>
        </Row>
        <Row label="guards">
          <GuardValue name="fetch" status={info.fetchGuard} />
          <Text dimColor> · </Text>
          <GuardValue name="fs" status={info.fsGuard} />
        </Row>
        <Row label="switches">
          <SwitchesValue info={info} />
        </Row>
        <Row label="radar">
          <RadarValue info={info} />
        </Row>
      </Box>
    </Box>
  );
}

/** Banner + session box as one native-Ink block. Render inside <Static>. */
export function BootHeader({ info, columns }: { info: BootStaticInfo; columns: number }): React.JSX.Element {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Banner columns={columns} version={info.version} />
      <Box marginTop={1}>
        <SessionBox info={info} columns={columns} />
      </Box>
    </Box>
  );
}
