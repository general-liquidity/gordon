// ============================================================================
// ASCIICast Recorder — Records terminal sessions in asciicast v2 format
// ============================================================================

import { writeFileSync, appendFileSync } from "fs";

export class AsciicastRecorder {
  private filePath: string | null = null;
  private startTime = 0;
  private buffer: string[] = [];
  private originalWrite: typeof process.stdout.write | null = null;
  private flushInterval: ReturnType<typeof setInterval> | null = null;

  start(filePath: string): void {
    this.filePath = filePath;
    this.startTime = Date.now();
    this.buffer = [];

    const header = JSON.stringify({
      version: 2, width: process.stdout.columns ?? 80,
      height: process.stdout.rows ?? 24, timestamp: Math.floor(this.startTime / 1000),
    });
    writeFileSync(filePath, header + "\n");

    this.originalWrite = process.stdout.write.bind(process.stdout);
    const self = this;
    process.stdout.write = function (chunk: any, ...args: any[]): boolean {
      const str = typeof chunk === "string" ? chunk : chunk.toString();
      const relTime = (Date.now() - self.startTime) / 1000;
      self.buffer.push(JSON.stringify([relTime, "o", str]));
      return self.originalWrite!.call(process.stdout, chunk, ...args as [any]);
    } as any;

    this.flushInterval = setInterval(() => this.flush(), 500);
  }

  stop(): void {
    this.flush();
    if (this.originalWrite) {
      process.stdout.write = this.originalWrite as any;
      this.originalWrite = null;
    }
    if (this.flushInterval) { clearInterval(this.flushInterval); this.flushInterval = null; }
    this.filePath = null;
  }

  isRecording(): boolean { return this.filePath !== null; }

  private flush(): void {
    if (!this.filePath || this.buffer.length === 0) return;
    appendFileSync(this.filePath, this.buffer.join("\n") + "\n");
    this.buffer = [];
  }
}
