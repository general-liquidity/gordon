// ============================================================================
// Voice Input Service — Voice-to-text for hands-free trading commands
// ============================================================================
// "buy 0.5 ETH at market", "set stop-loss at 1800"
// Supports: SoX (sox/rec), arecord (Linux), or native audio
// STT: OpenAI Whisper API or local faster-whisper

import { execSync, spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ============================================================================
// Types
// ============================================================================

export interface VoiceConfig {
  enabled: boolean;
  backend: "sox" | "arecord" | "native";
  sttProvider: "openai" | "local";
  language: string;
  silenceThresholdMs: number;
}

export interface VoiceStatus {
  recording: boolean;
  duration: number;
  backend: string;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: VoiceConfig = {
  enabled: false,
  backend: "sox",
  sttProvider: "openai",
  language: "en",
  silenceThresholdMs: 2000,
};

const TRADING_PROMPT =
  "buy, sell, long, short, stop-loss, take-profit, limit order, market order, " +
  "BTC, ETH, SOL, DOGE, XRP, USDT, USDC, Bitcoin, Ethereum, " +
  "position size, leverage, liquidation, margin, portfolio, rebalance";

// ============================================================================
// VoiceInputService
// ============================================================================

export class VoiceInputService {
  private config: VoiceConfig;
  private recording = false;
  private recordProcess: ChildProcess | null = null;
  private recordStart = 0;
  private tempFile: string;

  constructor(config?: Partial<VoiceConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.tempFile = path.join(os.tmpdir(), `gordon-voice-${process.pid}.wav`);
  }

  // --------------------------------------------------------------------------
  // Availability check
  // --------------------------------------------------------------------------

  isAvailable(): boolean {
    return this.detectBackend() !== null;
  }

  private detectBackend(): "sox" | "arecord" | null {
    // sox is cross-platform — works on macOS, Linux, and Windows
    if (this.commandExists("rec") || this.commandExists("sox")) return "sox";
    // arecord is Linux only (ALSA)
    if (process.platform === "linux" && this.commandExists("arecord")) return "arecord";
    return null;
  }

  /**
   * Cross-platform binary detection. Uses `where` on Windows, `which`
   * elsewhere. Previous implementation called `which` unconditionally
   * which silently failed on Windows even when sox was installed.
   */
  private commandExists(cmd: string): boolean {
    try {
      const lookup = process.platform === "win32" ? "where" : "which";
      execSync(`${lookup} ${cmd}`, { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  // --------------------------------------------------------------------------
  // Recording
  // --------------------------------------------------------------------------

  startRecording(): void {
    if (this.recording) return;

    const backend = this.detectBackend();
    if (!backend) throw new Error("No audio recording backend found. Install sox or arecord.");

    this.config.backend = backend;
    this.recording = true;
    this.recordStart = Date.now();

    // Clean up previous temp file
    try { fs.unlinkSync(this.tempFile); } catch { /* noop */ }

    const silenceSecs = this.config.silenceThresholdMs / 1000;

    if (backend === "sox") {
      // rec: 16kHz, mono, 16-bit PCM WAV with silence detection
      this.recordProcess = spawn("rec", [
        "-r", "16000", "-c", "1", "-b", "16",
        this.tempFile,
        "silence", "1", "0.1", "1%",
        "1", String(silenceSecs), "1%",
      ], { stdio: "ignore" });
    } else {
      // arecord: 16kHz, mono, S16_LE WAV
      this.recordProcess = spawn("arecord", [
        "-f", "S16_LE", "-r", "16000", "-c", "1",
        "-t", "wav",
        this.tempFile,
      ], { stdio: "ignore" });
    }

    this.recordProcess.on("exit", () => {
      this.recording = false;
      this.recordProcess = null;
    });
  }

  async stopRecording(): Promise<string> {
    if (!this.recording || !this.recordProcess) {
      throw new Error("Not currently recording");
    }

    // Gracefully stop the recording process
    this.recordProcess.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const proc = this.recordProcess;
      if (!proc) { resolve(); return; }
      proc.on("exit", () => resolve());
      setTimeout(() => { proc.kill("SIGKILL"); resolve(); }, 3000);
    });

    this.recording = false;
    this.recordProcess = null;

    // Check that we got a file
    if (!fs.existsSync(this.tempFile)) {
      throw new Error("Recording file not found");
    }

    // Transcribe
    const transcript = await this.transcribe(this.tempFile);

    // Clean up
    try { fs.unlinkSync(this.tempFile); } catch { /* noop */ }

    return transcript;
  }

  isRecording(): boolean {
    return this.recording;
  }

  getStatus(): VoiceStatus {
    return {
      recording: this.recording,
      duration: this.recording ? Date.now() - this.recordStart : 0,
      backend: this.config.backend,
    };
  }

  // --------------------------------------------------------------------------
  // Speech-to-text
  // --------------------------------------------------------------------------

  private async transcribe(filePath: string): Promise<string> {
    if (this.config.sttProvider === "local") {
      return this.transcribeLocal(filePath);
    }
    return this.transcribeOpenAI(filePath);
  }

  private async transcribeOpenAI(filePath: string): Promise<string> {
    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) throw new Error("OPENAI_API_KEY not set — required for Whisper STT");

    const fileBuffer = fs.readFileSync(filePath);
    const blob = new Blob([fileBuffer], { type: "audio/wav" });

    const form = new FormData();
    form.append("file", blob, "recording.wav");
    form.append("model", "whisper-1");
    form.append("language", this.config.language);
    form.append("prompt", TRADING_PROMPT);

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Whisper API error ${res.status}: ${body}`);
    }

    const data = (await res.json()) as { text: string };
    return data.text.trim();
  }

  private async transcribeLocal(filePath: string): Promise<string> {
    if (!this.commandExists("faster-whisper")) {
      throw new Error("faster-whisper CLI not found. Install with: pip install faster-whisper");
    }

    return new Promise<string>((resolve, reject) => {
      const proc = spawn("faster-whisper", [
        filePath,
        "--language", this.config.language,
        "--initial_prompt", TRADING_PROMPT,
      ]);

      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

      proc.on("exit", (code) => {
        if (code !== 0) {
          reject(new Error(`faster-whisper exited with code ${code}: ${stderr}`));
        } else {
          resolve(stdout.trim());
        }
      });
    });
  }
}
