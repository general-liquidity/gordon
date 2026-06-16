import { describe, it, expect } from "bun:test";
import {
  buildBatchJsonl,
  judgeTrajectoriesBatch,
  parseOutputJsonl,
  type BatchJudgeRequest,
  type BatchOutputLine,
  type DoublewordBatchClient,
} from "./doublewordBatchJudge.ts";
import type { EvalScenario, EvalTrajectory, JudgeRequest } from "./types.ts";

function makeScenario(id: string): EvalScenario {
  return {
    id,
    tags: [],
    systemPrompt: `system prompt for ${id}`,
    userInput: `user input for ${id}`,
  };
}

function makeTraj(id: string, content: string): EvalTrajectory {
  return { id, messages: [{ role: "assistant", content }] };
}

describe("buildBatchJsonl", () => {
  it("produces one line per request with the OpenAI Batch fields", () => {
    const requests: BatchJudgeRequest[] = [
      {
        customId: "scenario-a",
        model: "anthropic/claude-sonnet-4-6",
        messages: [
          { role: "system", content: "grader" },
          { role: "user", content: "rank these" },
        ],
      },
      {
        customId: "scenario-b",
        model: "anthropic/claude-sonnet-4-6",
        messages: [{ role: "user", content: "rank those" }],
      },
    ];

    const jsonl = buildBatchJsonl(requests);
    const lines = jsonl.split("\n");
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]!);
    expect(first.custom_id).toBe("scenario-a");
    expect(first.method).toBe("POST");
    expect(first.url).toBe("/v1/chat/completions");
    expect(first.body.model).toBe("anthropic/claude-sonnet-4-6");
    expect(first.body.response_format).toEqual({ type: "json_object" });
    expect(first.body.messages).toEqual([
      { role: "system", content: "grader" },
      { role: "user", content: "rank these" },
    ]);

    const second = JSON.parse(lines[1]!);
    expect(second.custom_id).toBe("scenario-b");
    expect(second.body.messages).toHaveLength(1);
  });

  it("emits empty string for no requests", () => {
    expect(buildBatchJsonl([])).toBe("");
  });
});

describe("parseOutputJsonl", () => {
  it("parses lines and skips blanks", () => {
    const text = `{"custom_id":"a","response":{}}\n\n{"custom_id":"b","response":{}}\n`;
    const lines = parseOutputJsonl(text);
    expect(lines.map((l) => l.custom_id)).toEqual(["a", "b"]);
  });
});

/** Build a mock client returning canned output lines (built from a scores map). */
function makeMockClient(
  scoresByScenario: Record<string, Array<{ id: string; score: number }>>,
): { client: DoublewordBatchClient; uploaded: { jsonl?: string } } {
  const uploaded: { jsonl?: string } = {};
  const outputLines: BatchOutputLine[] = Object.entries(scoresByScenario).map(
    ([scenarioId, scores]) => ({
      custom_id: scenarioId,
      response: {
        status_code: 200,
        body: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  scores: scores.map((s) => ({
                    trajectory_id: s.id,
                    score: s.score,
                    explanation: `score ${s.score}`,
                  })),
                }),
              },
            },
          ],
        },
      },
    }),
  );

  const client: DoublewordBatchClient = {
    async createFile(jsonl: string) {
      uploaded.jsonl = jsonl;
      return { id: "file-123" };
    },
    async createBatch(inputFileId: string) {
      expect(inputFileId).toBe("file-123");
      return { id: "batch-123", status: "completed", output_file_id: "out-456" };
    },
    async retrieveBatch(batchId: string) {
      return { id: batchId, status: "completed", output_file_id: "out-456" };
    },
    async getResults(outputFileId: string) {
      expect(outputFileId).toBe("out-456");
      return outputLines;
    },
  };

  return { client, uploaded };
}

describe("judgeTrajectoriesBatch", () => {
  it("maps canned batch results by custom_id and preserves input order", async () => {
    const requests: JudgeRequest[] = [
      {
        scenario: makeScenario("scn-alpha"),
        trajectories: [makeTraj("a", "answer a"), makeTraj("b", "answer b")],
      },
      {
        scenario: makeScenario("scn-beta"),
        trajectories: [makeTraj("x", "answer x"), makeTraj("y", "answer y")],
      },
    ];

    // Note: scores deliberately out of input order to prove mapping by id.
    const { client, uploaded } = makeMockClient({
      "scn-beta": [
        { id: "y", score: 0.2 },
        { id: "x", score: 0.9 },
      ],
      "scn-alpha": [
        { id: "a", score: 0.3 },
        { id: "b", score: 0.8 },
      ],
    });

    const results = await judgeTrajectoriesBatch(requests, {}, client);

    // Returned in INPUT order regardless of output-file order.
    expect(results.map((r) => r.scenarioId)).toEqual(["scn-alpha", "scn-beta"]);

    // scn-alpha: b (0.8) outranks a (0.3).
    const alpha = results[0]!;
    expect(alpha.scored.find((s) => s.id === "a")!.score).toBeCloseTo(0.3);
    expect(alpha.scored.find((s) => s.id === "b")!.score).toBeCloseTo(0.8);
    expect(alpha.scored[0]!.id).toBe("b");
    expect(alpha.scored[0]!.rank).toBe(1);
    expect(alpha.fallback).toBeUndefined();

    // scn-beta: x (0.9) outranks y (0.2).
    const beta = results[1]!;
    expect(beta.scored[0]!.id).toBe("x");
    expect(beta.scored.find((s) => s.id === "y")!.score).toBeCloseTo(0.2);

    // The uploaded JSONL should be one line per scenario with the shared fields.
    const uploadedLines = uploaded.jsonl!.split("\n");
    expect(uploadedLines).toHaveLength(2);
    const parsed = JSON.parse(uploadedLines[0]!);
    expect(parsed.custom_id).toBe("scn-alpha");
    expect(parsed.body.response_format).toEqual({ type: "json_object" });
    expect(parsed.body.messages[0].role).toBe("system");
    expect(parsed.body.messages[1].content).toContain("system prompt for scn-alpha");
  });

  it("degrades a missing output line to a fallback JudgeResult", async () => {
    const requests: JudgeRequest[] = [
      {
        scenario: makeScenario("present"),
        trajectories: [makeTraj("a", "x"), makeTraj("b", "y")],
      },
      {
        scenario: makeScenario("missing"),
        trajectories: [makeTraj("c", "z")],
      },
    ];

    // Only return a line for "present".
    const { client } = makeMockClient({
      present: [
        { id: "a", score: 0.7 },
        { id: "b", score: 0.4 },
      ],
    });

    const results = await judgeTrajectoriesBatch(requests, {}, client);
    expect(results).toHaveLength(2);
    expect(results[0]!.fallback).toBeUndefined();
    expect(results[1]!.scenarioId).toBe("missing");
    expect(results[1]!.fallback).toBeDefined();
    expect(results[1]!.scored[0]!.score).toBe(0.5);
  });

  it("returns empty array for no requests", async () => {
    const { client } = makeMockClient({});
    expect(await judgeTrajectoriesBatch([], {}, client)).toEqual([]);
  });
});
