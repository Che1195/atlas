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
import type * as ai_distill from "../ai/distill.js";
import type * as ai_embed from "../ai/embed.js";
import type * as ai_models from "../ai/models.js";
import type * as ai_prompts_distill from "../ai/prompts/distill.js";
import type * as ai_provider from "../ai/provider.js";
import type * as ai_search from "../ai/search.js";
import type * as crons from "../crons.js";
import type * as entries from "../entries.js";
import type * as evidence from "../evidence.js";
import type * as internal_aiRuns from "../internal/aiRuns.js";
import type * as internal_distillInputs from "../internal/distillInputs.js";
import type * as internal_embedStore from "../internal/embedStore.js";
import type * as internal_proposalStore from "../internal/proposalStore.js";
import type * as internal_searchText from "../internal/searchText.js";
import type * as internal_testing from "../internal/testing.js";
import type * as knowledge from "../knowledge.js";
import type * as lib_applyPlan from "../lib/applyPlan.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_budget from "../lib/budget.js";
import type * as lib_confidence from "../lib/confidence.js";
import type * as lib_embedStub from "../lib/embedStub.js";
import type * as lib_retrieval from "../lib/retrieval.js";
import type * as lib_revisions from "../lib/revisions.js";
import type * as lib_validate from "../lib/validate.js";
import type * as ops_knowledgeWrites from "../ops/knowledgeWrites.js";
import type * as proposals from "../proposals.js";
import type * as shared_proposalOps from "../shared/proposalOps.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  account: typeof account;
  "ai/distill": typeof ai_distill;
  "ai/embed": typeof ai_embed;
  "ai/models": typeof ai_models;
  "ai/prompts/distill": typeof ai_prompts_distill;
  "ai/provider": typeof ai_provider;
  "ai/search": typeof ai_search;
  crons: typeof crons;
  entries: typeof entries;
  evidence: typeof evidence;
  "internal/aiRuns": typeof internal_aiRuns;
  "internal/distillInputs": typeof internal_distillInputs;
  "internal/embedStore": typeof internal_embedStore;
  "internal/proposalStore": typeof internal_proposalStore;
  "internal/searchText": typeof internal_searchText;
  "internal/testing": typeof internal_testing;
  knowledge: typeof knowledge;
  "lib/applyPlan": typeof lib_applyPlan;
  "lib/auth": typeof lib_auth;
  "lib/budget": typeof lib_budget;
  "lib/confidence": typeof lib_confidence;
  "lib/embedStub": typeof lib_embedStub;
  "lib/retrieval": typeof lib_retrieval;
  "lib/revisions": typeof lib_revisions;
  "lib/validate": typeof lib_validate;
  "ops/knowledgeWrites": typeof ops_knowledgeWrites;
  proposals: typeof proposals;
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
