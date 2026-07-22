// Centralized model selection (docs/spec/05-ai-pipeline.md §2). Changing a model
// for a task is a one-line change here; aiRuns records make A/B comparison possible.

/** distill, connect, ask — high-volume, structured, cost-sensitive. */
export const DISTILL_MODEL = 'gpt-5.6-terra';
export const DISTILL_REASONING_EFFORT = 'medium' as const;
