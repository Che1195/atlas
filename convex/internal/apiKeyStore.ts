// Insert path for convex/apiKeys.ts's action-based `create` (Phase M Task 5).
// Internal only — explicit userId first param (08 §2); the action already
// resolved and hashed everything, this just writes the row.
import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';

const scopeValidator = v.union(v.literal('read'), v.literal('capture'), v.literal('propose'));

export const insert = internalMutation({
  args: {
    userId: v.id('users'),
    name: v.string(),
    keyHash: v.string(),
    prefix: v.string(),
    scopes: v.array(scopeValidator),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('apiKeys', {
      userId: args.userId,
      name: args.name,
      keyHash: args.keyHash,
      prefix: args.prefix,
      scopes: args.scopes,
    });
  },
});
