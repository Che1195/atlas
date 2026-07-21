# Atlas Product Vision Specification

Version: 0.1
Status: Source document — preserved verbatim as provenance for the engineering spec in `docs/spec/`.
Where the engineering spec deviates from this vision, the deviation is recorded in `docs/spec/00-overview.md` and the relevant ADR.

---

# Vision

Atlas is an AI-native personal knowledge operating system.

It is designed to help a person transform life experience into increasingly accurate understanding.

Most journals preserve memories. Atlas preserves knowledge.

Its purpose is not simply to remember what happened. Its purpose is to answer questions like:

- What have I actually learned?
- Which beliefs have survived repeated testing?
- Which behaviors consistently improve my life?
- What patterns keep repeating?
- Which assumptions have been disproven?
- How has my thinking evolved over time?

Atlas should become the user's long-term external reasoning system.

# Mission

Transform experience into understanding.

The product continuously moves knowledge through the following loop:

Observe → Compress → Test → Refine → Connect → Distill

Everything in Atlas exists to support this cycle.

# Product Philosophy

Experiences are evidence. Evidence produces insights. Insights become patterns. Patterns become principles. Principles guide future action. Future action produces new evidence.

The product is designed around continuous learning rather than continuous writing.

# Core Principle

The primary object inside Atlas is NOT a journal entry. The primary object is knowledge.

Journal entries exist only as evidence supporting knowledge. Atlas treats journal entries as source documents. Knowledge objects are first-class citizens.

# Knowledge Hierarchy

Observation → Interpretation → Insight → Pattern → Principle → Experiment → Outcome

Every object can reference supporting evidence. Every object maintains revision history. Nothing is treated as permanent truth. Everything evolves through evidence.

# Product Goals

Atlas should help the user:

- Capture meaningful experiences
- Extract useful insights
- Detect recurring patterns
- Build evidence-backed principles
- Run behavioral experiments
- Review personal growth
- Retrieve relevant prior knowledge
- Understand why conclusions were reached
- Challenge existing beliefs
- Improve future decision making

# What Atlas Is Not

Atlas is not: a diary, a notes app, a task manager, a productivity tracker, a therapist, a chatbot, a mood tracker, a social network, or a second brain that stores everything.

Atlas is a knowledge refinement engine.

# First-Class Objects

Entry, Observation, Interpretation, Insight, Pattern, Principle, Question, Experiment, Outcome, Relationship, Evidence, Revision.

Each object should exist independently while remaining connected.

# Product Values

Truth over comfort. Evidence over intuition. Revision over certainty. Patterns over isolated events. Understanding over productivity. Depth over volume. Privacy over engagement. Transparency over automation.

# AI Philosophy

AI should never replace thinking. Its purpose is to accelerate reflection.

The AI should: identify patterns, propose ideas, retrieve context, surface contradictions, compress information, suggest experiments, summarize evolution.

The AI should never silently create permanent knowledge. Every meaningful mutation requires user review.

# Provenance

Every piece of knowledge should answer: Where did this come from? What evidence supports it? What evidence contradicts it? Who created it? Was this written by me? Was this inferred by AI? When was it last updated? Why was it updated?

# Confidence

Atlas should distinguish between: Hypothesis, Emerging Pattern, Supported, Strongly Supported, Mixed Evidence, Contradicted, Archived.

Confidence should never be determined solely by repetition. Repeated summaries of the same event are not additional evidence.

# Experiments

Atlas encourages experimentation. Every insight should be capable of producing a behavioral experiment.

Experiments define: Hypothesis, Behavior, Context, Success Criteria, Failure Criteria, Observation Target, Outcome, Evidence Produced.

Example —
Insight: "I become performative when I perceive someone as higher status."
Experiment: Attend Muay Thai. Notice the feeling. Choose one honest response instead of an impressive one.
Outcome: Record what actually happened. Atlas then updates supporting evidence.

# Reviews

Atlas should periodically generate: daily reflection, weekly review, monthly pattern review, quarterly principle review.

These reviews should focus on: new insights, recurring themes, contradictions, experiments, changes in confidence, open questions. They should avoid motivational language.

# Search Philosophy

Search should answer questions instead of merely finding documents.

Examples: "What have I learned about confidence?" "When do I become anxious?" "What experiments actually worked?" "What beliefs have changed?" "Show contradictions." "How has my thinking about relationships evolved?"

# Hermes

Hermes is Atlas's dedicated AI companion. Hermes is not Atlas. Hermes is the conversational interface. Atlas is the knowledge system.

Hermes should: capture reflections, retrieve relevant knowledge, propose entries, propose experiments, record outcomes, prepare reviews, explain relationships, never bypass approval, never silently mutate knowledge.

Hermes should operate through authenticated APIs and/or MCP rather than direct database access.

# MCP

Atlas exposes a secure MCP server. External AI assistants can: retrieve knowledge, create drafts, preview mutations, submit proposals, retrieve experiments, search relationships.

Only Atlas owns the source of truth.

# Product Architecture (as envisioned)

Mobile Application → Application API → Domain Layer → Database → Knowledge Engine → AI Layer → MCP Server → Hermes Agent

Each layer should have clearly defined responsibilities. Business logic should exist exactly once.

# Design Principles

Minimal. Quiet. Intentional. Fast. Evidence-driven. High information density. Low visual noise. No gamification. No engagement optimization. No infinite scrolling feeds.

Every screen should answer one important question.

# MVP

The MVP should support: authentication, manual capture, conversation import, AI distillation, review workflow, knowledge objects, experiments, outcomes, search, relationships, revision history, Hermes integration, MCP integration, export.

The MVP should explicitly exclude: social features, collaboration, voice, image understanding, autonomous agents, advanced graph visualization, complex analytics, desktop application.

# Long-Term Vision

Atlas should eventually become the user's personal knowledge operating system. It should remember every important lesson, understand how those lessons connect, retrieve them when they matter, and help the user make better decisions without replacing the user's judgment.

The measure of Atlas is not how much it stores. The measure of Atlas is whether the user becomes wiser because of it.
