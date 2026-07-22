// Scheduled jobs (docs/spec/05-ai-pipeline.md §1 "embed" — "Backfill cron sweeps
// rows where version ≠ current"; Phase M Task 3). Only one job exists today.
import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

/**
 * Hourly embed backfill: catches rows created before embedding existed, rows
 * whose EMBED_VERSION bumped (model/dimension change), and any row whose
 * fire-and-forget embed silently failed (05 §5 — a missing embedding is a legal,
 * tolerated state, not an outage). Batched at ≤50 rows/tick (see convex/ai/embed.ts's
 * BACKFILL_BATCH_SIZE scale note) — cheap and sufficient at this app's scale;
 * a larger corpus would want a bigger batch or a sub-hourly cadence, not a
 * different design.
 */
crons.hourly('embed backfill sweep', { minuteUTC: 5 }, internal.ai.embed.sweep);

export default crons;
