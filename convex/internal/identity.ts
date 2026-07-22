// Shared identity resolution for action-based public functions (Phase M Task 5:
// convex/apiKeys.ts's `create`, convex/oauth/grants.ts's `approveGrant`). Both
// need to turn the caller's Clerk identity into a userId from an ActionCtx,
// which has no ctx.db of its own — mirrors convex/lib/auth.ts's requireUser
// lookup exactly, just split across an action (identity + this query) instead
// of one query/mutation handler.
import { v } from 'convex/values';
import { internalQuery } from '../_generated/server';

export const resolveUserId = internalQuery({
  args: { clerkId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query('users')
      .withIndex('by_clerkId', (q) => q.eq('clerkId', args.clerkId))
      .unique();
    return user?._id ?? null;
  },
});
