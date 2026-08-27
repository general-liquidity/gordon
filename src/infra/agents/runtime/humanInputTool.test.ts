import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync, existsSync, readFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isHumanInputToolEnabled,
  defaultHumanInputPath,
  createRequest,
  loadAllRequests,
  listPending,
  answerRequest,
  cancelRequest,
  waitForAnswer,
  formatPending,
  requestToPayload,
  responseToPayload,
  resetIdCounterForTesting,
  resetWaitersForTesting,
  RequestNotFoundError,
  RequestNotPendingError,
  RequestTimeoutError,
  HUMAN_INPUT_FLAG_ENV,
  HUMAN_INPUT_PATH_ENV,
} from "./humanInputTool.ts";

let tempDir: string;
let logPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gordon-human-input-test-"));
  logPath = join(tempDir, "requests.jsonl");
  resetIdCounterForTesting();
  resetWaitersForTesting();
});

describe("isHumanInputToolEnabled", () => {
  it("respects the flag", () => {
    expect(isHumanInputToolEnabled({})).toBe(false);
    expect(isHumanInputToolEnabled({ [HUMAN_INPUT_FLAG_ENV]: "1" })).toBe(true);
    expect(isHumanInputToolEnabled({ [HUMAN_INPUT_FLAG_ENV]: "true" })).toBe(true);
  });
});

describe("defaultHumanInputPath", () => {
  it("honors env override", () => {
    expect(defaultHumanInputPath({ [HUMAN_INPUT_PATH_ENV]: "/x.jsonl" })).toBe("/x.jsonl");
  });
  it("falls back to home-dir default", () => {
    expect(defaultHumanInputPath({})).toContain("human-input-requests.jsonl");
  });
});

describe("createRequest", () => {
  it("appends to JSONL with a unique id", () => {
    const a = createRequest({ agentId: "exec", question: "X?" }, logPath);
    const b = createRequest({ agentId: "exec", question: "Y?" }, logPath);
    expect(a.id).not.toBe(b.id);
    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    expect(lines.length).toBe(2);
  });

  it("defaults format to free_text and urgency to normal", () => {
    const r = createRequest({ agentId: "exec", question: "X?" }, logPath);
    expect(r.format).toBe("free_text");
    expect(r.urgency).toBe("normal");
  });

  it("honors caller-supplied format / urgency / options", () => {
    const r = createRequest(
      {
        agentId: "exec",
        question: "Close ETH long or hold?",
        format: "choose",
        urgency: "high",
        options: [
          { id: "close", label: "close now" },
          { id: "hold", label: "hold" },
        ],
      },
      logPath,
    );
    expect(r.format).toBe("choose");
    expect(r.urgency).toBe("high");
    expect(r.options).toHaveLength(2);
  });

  it("creates parent dir if missing", () => {
    const nested = join(tempDir, "a", "b", "c.jsonl");
    createRequest({ agentId: "exec", question: "X?" }, nested);
    expect(existsSync(nested)).toBe(true);
  });
});

describe("loadAllRequests — reduction", () => {
  it("returns empty for missing file", () => {
    expect(loadAllRequests(join(tempDir, "no.jsonl"))).toEqual([]);
  });

  it("reduces request + answer into status=answered", () => {
    const r = createRequest({ agentId: "exec", question: "X?" }, logPath);
    answerRequest(r.id, "yes", { path: logPath });
    const all = loadAllRequests(logPath);
    expect(all.length).toBe(1);
    expect(all[0]!.status).toBe("answered");
    expect(all[0]!.response?.answer).toBe("yes");
  });

  it("reduces request + cancel into status=cancelled", () => {
    const r = createRequest({ agentId: "exec", question: "X?" }, logPath);
    cancelRequest(r.id, "no longer relevant", { path: logPath });
    const all = loadAllRequests(logPath);
    expect(all[0]!.status).toBe("cancelled");
    expect(all[0]!.cancelReason).toBe("no longer relevant");
  });

  it("tolerates malformed lines", () => {
    createRequest({ agentId: "exec", question: "X?" }, logPath);
    appendFileSync(logPath, "not-json{\n");
    createRequest({ agentId: "exec", question: "Y?" }, logPath);
    expect(loadAllRequests(logPath).length).toBe(2);
  });

  it("sorts newest-first", () => {
    createRequest({ agentId: "exec", question: "old", now: "2026-01-01T00:00:00Z" }, logPath);
    createRequest({ agentId: "exec", question: "new", now: "2026-05-01T00:00:00Z" }, logPath);
    const all = loadAllRequests(logPath);
    expect(all[0]!.request.question).toBe("new");
  });
});

describe("listPending", () => {
  it("only returns pending requests", () => {
    const a = createRequest({ agentId: "exec", question: "A" }, logPath);
    createRequest({ agentId: "exec", question: "B" }, logPath);
    answerRequest(a.id, "yes", { path: logPath });
    const pending = listPending({}, logPath);
    expect(pending.length).toBe(1);
    expect(pending[0]!.request.question).toBe("B");
  });

  it("filters by threadId", () => {
    createRequest({ agentId: "exec", question: "A", threadId: "t1" }, logPath);
    createRequest({ agentId: "exec", question: "B", threadId: "t2" }, logPath);
    expect(listPending({ threadId: "t1" }, logPath).length).toBe(1);
  });

  it("filters by urgency", () => {
    createRequest({ agentId: "exec", question: "A", urgency: "high" }, logPath);
    createRequest({ agentId: "exec", question: "B", urgency: "low" }, logPath);
    expect(listPending({ urgency: "high" }, logPath).length).toBe(1);
  });

  it("respects limit", () => {
    for (let i = 0; i < 5; i++) {
      createRequest({ agentId: "exec", question: `q${i}` }, logPath);
    }
    expect(listPending({ limit: 2 }, logPath).length).toBe(2);
  });
});

describe("answerRequest", () => {
  it("returns a response object with the answer", () => {
    const r = createRequest({ agentId: "exec", question: "X?" }, logPath);
    const resp = answerRequest(r.id, "yes", { path: logPath, now: "2026-05-13T10:00:00Z" });
    expect(resp.requestId).toBe(r.id);
    expect(resp.answer).toBe("yes");
    expect(resp.answeredAt).toBe("2026-05-13T10:00:00Z");
  });

  it("supports optionId for choose-format", () => {
    const r = createRequest({ agentId: "exec", question: "?", format: "choose" }, logPath);
    const resp = answerRequest(r.id, "close now", { optionId: "close", path: logPath });
    expect(resp.optionId).toBe("close");
  });

  it("throws RequestNotFoundError for unknown id", () => {
    expect(() => answerRequest("ghost", "x", { path: logPath })).toThrow(RequestNotFoundError);
  });

  it("throws RequestNotPendingError on second answer", () => {
    const r = createRequest({ agentId: "exec", question: "X?" }, logPath);
    answerRequest(r.id, "first", { path: logPath });
    expect(() => answerRequest(r.id, "second", { path: logPath })).toThrow(RequestNotPendingError);
  });

  it("throws RequestNotPendingError when answering a cancelled request", () => {
    const r = createRequest({ agentId: "exec", question: "X?" }, logPath);
    cancelRequest(r.id, "cancelled", { path: logPath });
    expect(() => answerRequest(r.id, "x", { path: logPath })).toThrow(RequestNotPendingError);
  });
});

describe("cancelRequest", () => {
  it("flips status to cancelled", () => {
    const r = createRequest({ agentId: "exec", question: "X?" }, logPath);
    cancelRequest(r.id, "ttl expired", { path: logPath });
    const all = loadAllRequests(logPath);
    expect(all[0]!.status).toBe("cancelled");
  });

  it("throws when cancelling an answered request", () => {
    const r = createRequest({ agentId: "exec", question: "X?" }, logPath);
    answerRequest(r.id, "yes", { path: logPath });
    expect(() => cancelRequest(r.id, "x", { path: logPath })).toThrow(RequestNotPendingError);
  });
});

describe("waitForAnswer — in-process resolution", () => {
  it("resolves when answer arrives", async () => {
    const r = createRequest({ agentId: "exec", question: "X?" }, logPath);
    const waiter = waitForAnswer(r.id, { path: logPath });
    // Answer in a microtask
    queueMicrotask(() => answerRequest(r.id, "yes", { path: logPath }));
    const resp = await waiter;
    expect(resp.answer).toBe("yes");
  });

  it("returns immediately if already answered on disk", async () => {
    const r = createRequest({ agentId: "exec", question: "X?" }, logPath);
    answerRequest(r.id, "prev", { path: logPath });
    const resp = await waitForAnswer(r.id, { path: logPath });
    expect(resp.answer).toBe("prev");
  });

  it("rejects on RequestNotFoundError", async () => {
    await expect(waitForAnswer("ghost", { path: logPath })).rejects.toThrow(RequestNotFoundError);
  });

  it("rejects on cancellation", async () => {
    const r = createRequest({ agentId: "exec", question: "X?" }, logPath);
    const waiter = waitForAnswer(r.id, { path: logPath });
    queueMicrotask(() => cancelRequest(r.id, "stop", { path: logPath }));
    await expect(waiter).rejects.toThrow("cancelled");
  });

  it("times out after timeoutMs", async () => {
    const r = createRequest({ agentId: "exec", question: "X?" }, logPath);
    await expect(waitForAnswer(r.id, { path: logPath, timeoutMs: 30 })).rejects.toThrow(
      RequestTimeoutError,
    );
  });
});

describe("formatPending", () => {
  it("says 'No pending' for empty", () => {
    expect(formatPending([])).toContain("No pending");
  });

  it("includes urgency, format, and question per entry", () => {
    createRequest({ agentId: "e", question: "Close BTC long?", urgency: "high" }, logPath);
    const out = formatPending(listPending({}, logPath));
    expect(out).toContain("[high]");
    expect(out).toContain("free_text");
    expect(out).toContain("Close BTC long?");
  });

  it("includes options for choose-format", () => {
    createRequest(
      {
        agentId: "e",
        question: "X",
        format: "choose",
        options: [
          { id: "a", label: "first" },
          { id: "b", label: "second" },
        ],
      },
      logPath,
    );
    const out = formatPending(listPending({}, logPath));
    expect(out).toContain("a=first");
    expect(out).toContain("b=second");
  });
});

describe("payload helpers", () => {
  it("requestToPayload emits stable shape", () => {
    const r = createRequest({ agentId: "exec", question: "X?", urgency: "high" }, logPath);
    const p = requestToPayload(r);
    expect(p.kind).toBe("human_input.request_recorded");
    expect(p.urgency).toBe("high");
  });

  it("responseToPayload emits stable shape", () => {
    const r = createRequest({ agentId: "exec", question: "X?" }, logPath);
    const resp = answerRequest(r.id, "yes", { path: logPath });
    const p = responseToPayload(resp);
    expect(p.kind).toBe("human_input.response_recorded");
    expect(p.requestId).toBe(r.id);
  });
});

describe("Trading scenario — agent asks about exit timing", () => {
  it("end-to-end: agent creates request, operator answers, agent resumes", async () => {
    // Agent side: open the question.
    const r = createRequest(
      {
        agentId: "executor",
        threadId: "session-1",
        question: "BTC just hit my stop level; close now or wait for daily candle close?",
        context: "stop is 49500, current price 49480; daily candle closes in 22 minutes",
        format: "choose",
        urgency: "high",
        options: [
          { id: "close_now", label: "close now (market order)" },
          { id: "wait_daily", label: "wait for daily candle close" },
        ],
      },
      logPath,
    );

    // Agent waits in parallel.
    const waiter = waitForAnswer(r.id, { path: logPath });

    // Operator answers.
    queueMicrotask(() =>
      answerRequest(r.id, "wait for daily candle close", {
        optionId: "wait_daily",
        path: logPath,
      }),
    );

    const resp = await waiter;
    expect(resp.optionId).toBe("wait_daily");
    expect(resp.answer).toContain("wait");
  });
});
