export class StreamCancelledError extends Error {
  constructor(message: string = "Response stopped.") {
    super(message);
    this.name = "StreamCancelledError";
  }
}

interface StreamReaderLike<T> {
  read(): Promise<ReadableStreamReadResult<T>>;
  cancel(reason?: unknown): Promise<void>;
}

type ReaderReadResult<T> = ReadableStreamReadResult<T>;

async function cancelReadableStreamReader<T>(reader: StreamReaderLike<T>): Promise<void> {
  try {
    await reader.cancel("user_cancelled");
  } catch {
    // Ignore reader cancellation failures. The caller is already unwinding.
  }
}

export async function readStreamChunkWithAbort<T>(
  reader: StreamReaderLike<T>,
  signal?: AbortSignal,
): Promise<ReaderReadResult<T>> {
  if (!signal) {
    return reader.read();
  }

  if (signal.aborted) {
    await cancelReadableStreamReader(reader);
    throw new StreamCancelledError();
  }

  return new Promise<ReaderReadResult<T>>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener("abort", onAbort);
      void cancelReadableStreamReader(reader);
      reject(new StreamCancelledError());
    };

    signal.addEventListener("abort", onAbort, { once: true });
    reader.read().then(
      (result) => {
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export async function throwIfStreamAborted(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw new StreamCancelledError();
  }
}

export async function awaitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return promise;
  }

  if (signal.aborted) {
    throw new StreamCancelledError();
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener("abort", onAbort);
      reject(new StreamCancelledError());
    };

    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export type ReActStage =
  | "compaction_checked"
  | "interrupt_checked_before_thinking"
  | "thinking_complete"
  | "ui_drained"
  | "interrupt_checked_before_action"
  | "action_started"
  | "response_dispatched"
  | "persisted";

const REACT_STAGE_TRANSITIONS: Record<ReActStage, ReActStage[]> = {
  compaction_checked: ["interrupt_checked_before_thinking"],
  interrupt_checked_before_thinking: ["thinking_complete"],
  thinking_complete: ["ui_drained"],
  ui_drained: ["interrupt_checked_before_action"],
  interrupt_checked_before_action: ["action_started"],
  action_started: ["response_dispatched"],
  response_dispatched: ["persisted"],
  persisted: [],
};

export function advanceReActStage(current: ReActStage, next: ReActStage): ReActStage {
  if (!REACT_STAGE_TRANSITIONS[current].includes(next)) {
    throw new Error(`Invalid ReAct stage transition: ${current} -> ${next}`);
  }
  return next;
}
