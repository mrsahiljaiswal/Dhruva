export type RunRequest = {
  source: string;
  language: string;
  tests: { name: string; input: string; expectedOutput: string }[];
  limits: { timeMs: number; memoryMb: number };
};

export type RunResult = {
  status: "passed" | "failed" | "error" | "pending_review";
  cases: { name: string; passed: boolean; message?: string }[];
};

export interface CodeRunner {
  readonly mode: "manual" | "automatic";
  run(request: RunRequest): Promise<RunResult>;
}

export const MANUAL_RUN_LIMITS = { timeMs: 2_000, memoryMb: 128 };

export class ManualReviewRunner implements CodeRunner {
  readonly mode = "manual" as const;

  async run(_request: RunRequest): Promise<RunResult> {
    return { status: "pending_review", cases: [] };
  }
}

export type ExecutionGate = {
  enabled(): boolean;
};

export const codeExecutionOff: ExecutionGate = {
  enabled() {
    return false;
  },
};
