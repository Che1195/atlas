import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { currentUser } from './lib/auth';
import { requireNonEmpty, requireValidTimezone } from './lib/validate';

/**
 * Lazy provisioning (docs/spec/09 §2): first authenticated call upserts the
 * users row from the Clerk JWT. displayName and email come from the identity
 * claims (required at signup — playbook identity rule); the args are
 * fallbacks only, used when the Convex integration token omits the claim.
 */
export const ensureUser = mutation({
  args: {
    timezone: v.string(),
    displayName: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      throw new ConvexError({ code: 'unauthenticated', message: 'Sign in required.' });
    }
    const timezone = requireValidTimezone(args.timezone);
    const displayName = identity.name ?? args.displayName;
    if (displayName === undefined) {
      throw new ConvexError({ code: 'invalid_input', message: 'Display name is required.' });
    }
    const email = identity.email ?? args.email;

    const existing = await ctx.db
      .query('users')
      .withIndex('by_clerkId', (q) => q.eq('clerkId', identity.subject))
      .unique();

    if (existing !== null) {
      // Re-sync mutable profile fields; never touch settings here.
      const nextEmail = email ?? existing.email;
      if (nextEmail !== existing.email || timezone !== existing.timezone) {
        await ctx.db.patch(existing._id, { email: nextEmail, timezone });
      }
      return existing._id;
    }

    return await ctx.db.insert('users', {
      clerkId: identity.subject,
      displayName: requireNonEmpty(displayName, 'displayName'),
      email: email ?? '',
      timezone,
      settings: {
        autoDistill: false, // cost + control default (docs/spec/05 §1)
        dailyReview: true,
        weeklyReview: true,
      },
    });
  },
});

/** The signed-in user's own profile, or null before provisioning. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (user === null) return null;
    return {
      displayName: user.displayName,
      email: user.email,
      timezone: user.timezone,
      settings: user.settings,
    };
  },
});
