import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import type { OutboundFetchGuardStatus } from "./outboundFetchGuard.ts";
import type { FilesystemWriteGuardStatus } from "./filesystemWriteGuardInstaller.ts";

const DEFAULT_AUDIT_DIRS = [
  "src/infra/exchange",
  "src/infra/broker",
  "src/infra/ai/mcp",
  "src/services",
] as const;

const DIRECT_TRANSPORT_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: "node_http_import", pattern: /\bfrom\s+["']node:http["']|\brequire\(["']node:http["']\)/ },
  {
    id: "node_https_import",
    pattern: /\bfrom\s+["']node:https["']|\brequire\(["']node:https["']\)/,
  },
  { id: "node_net_import", pattern: /\bfrom\s+["']node:net["']|\brequire\(["']node:net["']\)/ },
  { id: "node_tls_import", pattern: /\bfrom\s+["']node:tls["']|\brequire\(["']node:tls["']\)/ },
  { id: "bare_http_import", pattern: /\bfrom\s+["']http["']|\brequire\(["']http["']\)/ },
  { id: "bare_https_import", pattern: /\bfrom\s+["']https["']|\brequire\(["']https["']\)/ },
  { id: "native_http_request", pattern: /\b(?:http|https)\.(?:request|get)\s*\(/ },
  { id: "native_socket_connect", pattern: /\b(?:net|tls)\.connect\s*\(/ },
];

export interface NativeTransportFinding {
  file: string;
  patternId: string;
  line: number;
  snippet: string;
}

export interface NativeTransportAudit {
  ok: boolean;
  scannedFiles: number;
  findings: NativeTransportFinding[];
}

export interface TransportGuardCoverageReport {
  ok: boolean;
  fetchGuardInstalled: boolean;
  filesystemGuardInstalled: boolean;
  nativeTransportAudit: NativeTransportAudit;
  summary: string;
}

function walkTsFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const stat = statSync(current);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(current)) {
        if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
        stack.push(join(current, entry));
      }
      continue;
    }
    if (!current.endsWith(".ts")) continue;
    if (current.endsWith(".test.ts") || current.endsWith(".spec.ts")) continue;
    out.push(current);
  }
  return out.sort();
}

function scanFile(repoRoot: string, file: string): NativeTransportFinding[] {
  const content = readFileSync(file, "utf8");
  const lines = content.split(/\r?\n/);
  const findings: NativeTransportFinding[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const { id, pattern } of DIRECT_TRANSPORT_PATTERNS) {
      if (!pattern.test(line)) continue;
      findings.push({
        file: relative(repoRoot, file),
        patternId: id,
        line: i + 1,
        snippet: line.trim(),
      });
    }
  }
  return findings;
}

export function auditNativeTransportUsage(
  repoRoot = process.cwd(),
  auditDirs: readonly string[] = DEFAULT_AUDIT_DIRS,
): NativeTransportAudit {
  const files = auditDirs.flatMap((dir) => walkTsFiles(join(repoRoot, dir)));
  const findings = files.flatMap((file) => scanFile(repoRoot, file));
  return {
    ok: findings.length === 0,
    scannedFiles: files.length,
    findings,
  };
}

export function buildTransportGuardCoverageReport(input: {
  fetchGuard: Pick<OutboundFetchGuardStatus, "enabled" | "installed">;
  fsGuard: Pick<FilesystemWriteGuardStatus, "enabled" | "installed">;
  repoRoot?: string;
  auditDirs?: readonly string[];
}): TransportGuardCoverageReport {
  const nativeTransportAudit = auditNativeTransportUsage(input.repoRoot, input.auditDirs);
  const fetchGuardInstalled = input.fetchGuard.enabled && input.fetchGuard.installed;
  const filesystemGuardInstalled = input.fsGuard.enabled && input.fsGuard.installed;
  const ok = fetchGuardInstalled && filesystemGuardInstalled && nativeTransportAudit.ok;
  const summary = nativeTransportAudit.ok
    ? `No direct native HTTP/socket transports found in ${nativeTransportAudit.scannedFiles} trading transport source files; fetch callers inherit the global outbound guard.`
    : `${nativeTransportAudit.findings.length} direct native transport reference(s) found; these may bypass the global fetch guard.`;

  return {
    ok,
    fetchGuardInstalled,
    filesystemGuardInstalled,
    nativeTransportAudit,
    summary,
  };
}
