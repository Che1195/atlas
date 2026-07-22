/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as account from "../account.js";
import type * as ai_models from "../ai/models.js";
import type * as ai_prompts_distill from "../ai/prompts/distill.js";
import type * as ai_provider from "../ai/provider.js";
import type * as entries from "../entries.js";
import type * as evidence from "../evidence.js";
import type * as internal_testing from "../internal/testing.js";
import type * as knowledge from "../knowledge.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_confidence from "../lib/confidence.js";
import type * as lib_revisions from "../lib/revisions.js";
import type * as lib_validate from "../lib/validate.js";
import type * as ops_knowledgeWrites from "../ops/knowledgeWrites.js";
import type * as shared_proposalOps from "../shared/proposalOps.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  account: typeof account;
  "ai/models": typeof ai_models;
  "ai/prompts/distill": typeof ai_prompts_distill;
  "ai/provider": typeof ai_provider;
  entries: typeof entries;
  evidence: typeof evidence;
  "internal/testing": typeof internal_testing;
  knowledge: typeof knowledge;
  "lib/auth": typeof lib_auth;
  "lib/confidence": typeof lib_confidence;
  "lib/revisions": typeof lib_revisions;
  "lib/validate": typeof lib_validate;
  "ops/knowledgeWrites": typeof ops_knowledgeWrites;
  "shared/proposalOps": typeof shared_proposalOps;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
