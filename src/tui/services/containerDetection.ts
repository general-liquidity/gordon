// ============================================================================
// Container Detection — Detect Docker/container environments
//
// Detect if running inside a container and apply appropriate settings.
// Checks common markers: /.dockerenv, /run/.containerenv, cgroup,
// WSL_DISTRO_NAME, KUBERNETES_SERVICE_HOST.
// ============================================================================

import { existsSync, readFileSync } from "fs";

export interface ContainerInfo {
  isContainer: boolean;
  runtime: "docker" | "podman" | "kubernetes" | "wsl" | "none";
  hasNetwork: boolean;
  hasFileSystem: boolean;
}

export function detectContainer(): ContainerInfo {
  // Check Kubernetes first (most specific)
  if (process.env["KUBERNETES_SERVICE_HOST"]) {
    return {
      isContainer: true,
      runtime: "kubernetes",
      hasNetwork: true,
      hasFileSystem: true,
    };
  }

  // Check Docker
  if (existsSync("/.dockerenv")) {
    return {
      isContainer: true,
      runtime: "docker",
      hasNetwork: checkNetwork(),
      hasFileSystem: true,
    };
  }

  // Check Podman
  if (existsSync("/run/.containerenv")) {
    return {
      isContainer: true,
      runtime: "podman",
      hasNetwork: checkNetwork(),
      hasFileSystem: true,
    };
  }

  // Check cgroup for container indicators
  try {
    const cgroup = readFileSync("/proc/1/cgroup", "utf-8");
    if (cgroup.includes("docker") || cgroup.includes("containerd")) {
      return {
        isContainer: true,
        runtime: "docker",
        hasNetwork: checkNetwork(),
        hasFileSystem: true,
      };
    }
  } catch {
    // Not available — likely not Linux or no permissions
  }

  // Check WSL
  if (process.env["WSL_DISTRO_NAME"]) {
    return {
      isContainer: false,
      runtime: "wsl",
      hasNetwork: true,
      hasFileSystem: true,
    };
  }

  return {
    isContainer: false,
    runtime: "none",
    hasNetwork: true,
    hasFileSystem: true,
  };
}

function checkNetwork(): boolean {
  try {
    const resolv = readFileSync("/etc/resolv.conf", "utf-8");
    return resolv.includes("nameserver");
  } catch {
    return false;
  }
}

export function isDocker(): boolean {
  const info = detectContainer();
  return info.runtime === "docker";
}

export function isWSL(): boolean {
  return !!process.env["WSL_DISTRO_NAME"];
}

export function isKubernetes(): boolean {
  return !!process.env["KUBERNETES_SERVICE_HOST"];
}
