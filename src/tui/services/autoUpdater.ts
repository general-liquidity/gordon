// ============================================================================
// Auto-Updater — Background version polling with channel support
//
// Checks npm registry every 30 minutes. Supports stable/beta channels.
// Shows notification banner when new version available.
// ============================================================================

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  channel: string;
  releaseNotes?: string;
  updateAvailable: boolean;
}

export class AutoUpdateChecker {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private currentVersion: string;
  private channel: string;
  private lastCheck: UpdateInfo | null = null;

  constructor(currentVersion?: string, channel = "latest") {
    this.currentVersion = currentVersion ?? this.readPackageVersion();
    this.channel = channel;
  }

  async checkForUpdate(): Promise<UpdateInfo | null> {
    try {
      const tag = this.channel === "beta" ? "beta" : "latest";
      const response = await fetch(`https://registry.npmjs.org/gordon-cli/${tag}`, {
        signal: AbortSignal.timeout(5000),
        headers: { Accept: "application/json" },
      });

      if (!response.ok) return null;

      const data = (await response.json()) as { version?: string; description?: string };
      const latestVersion = data.version ?? "0.0.0";

      const result: UpdateInfo = {
        currentVersion: this.currentVersion,
        latestVersion,
        channel: this.channel,
        releaseNotes: data.description,
        updateAvailable: this.isNewer(latestVersion, this.currentVersion),
      };

      this.lastCheck = result;
      return result.updateAvailable ? result : null;
    } catch {
      return null;
    }
  }

  schedulePeriodicCheck(intervalMs = 30 * 60 * 1000): void {
    this.stopPeriodicCheck();
    // Initial check after 10 seconds
    setTimeout(() => this.checkForUpdate(), 10_000);
    this.intervalId = setInterval(() => this.checkForUpdate(), intervalMs);
  }

  stopPeriodicCheck(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  getLastCheck(): UpdateInfo | null {
    return this.lastCheck;
  }

  private isNewer(latest: string, current: string): boolean {
    const l = latest.split(".").map(Number);
    const c = current.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      if ((l[i] ?? 0) > (c[i] ?? 0)) return true;
      if ((l[i] ?? 0) < (c[i] ?? 0)) return false;
    }
    return false;
  }

  private readPackageVersion(): string {
    try {
      const pkg = require("../../../package.json");
      return pkg.version ?? "0.0.0";
    } catch {
      return "0.0.0";
    }
  }
}
