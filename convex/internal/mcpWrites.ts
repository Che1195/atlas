// MCP capture-tool write path (Phase M Task 4, docs/spec/06-mcp-interface.md §3
// "atlas_create_entry" — "Direct write, source: 'mcp' (ADR-0009)"). Internal only
// ⇒ explicit userId first param (08 §2); no isolation row needed (registry only
// covers public functions). This is the ONLY write MCP performs outside the
// proposal path — capture writes entries directly, knowledge mutation always
// goes through proposals (06 §2's write-asymmetry invariant; enforced structurally
// by there being no other mcp/* write function at all).
import { v } from 'convex/values';
import { internal } from '../_generated/api';
import { internalMutation } from '../_generated/server';

const entryKindValidator = v.union(v.literal('journal'), v.literal('conversation'), v.literal('note'));

export type CreateEntryResult = { ok: true; id: string } | { ok: false; reason: 'duplicateOf_not_found' };

export const createEntry = internalMutation({
  args: {
    userId: v.id('users'),
    kind: entryKindValidator,
    title: v.optional(v.string()),
    body: v.string(),
    occurredAt: v.number(),
    duplicateOf: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<CreateEntryResult> => {
    let duplicateOfId: import('../_generated/dataModel').Id<'entries'> | undefined;
    if (args.duplicateOf !== undefined) {
      const dupId = ctx.db.normalizeId('entries', args.duplicateOf);
      const dupDoc = dupId === null ? null : await ctx.db.get(dupId);
      if (dupDoc === null || dupDoc.userId !== args.userId) {
        return { ok: false, reason: 'duplicateOf_not_found' };
      }
      duplicateOfId = dupDoc._id;
    }

    const id = await ctx.db.insert('entries', {
      userId: args.userId,
      kind: args.kind,
      title: args.title,
      body: args.body,
      occurredAt: args.occurredAt,
      source: 'mcp',
      duplicateOf: duplicateOfId,
    });
    // Fire-and-forget embed, same trigger as the app's entries.create (05 §1).
    await ctx.scheduler.runAfter(0, internal.ai.embed.run, {
      userId: args.userId,
      targetType: 'entry',
      targetId: id,
    });
    return { ok: true, id };
  },
});
