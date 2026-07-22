# 10 — UX Specification

Design stance from the vision: minimal, quiet, intentional, fast, high information density, low visual noise, no gamification, no engagement optimization, no infinite feeds. **Every screen answers one question** — each screen below names its question.

## 1. Design tokens — MERIDIAN (named day one, playbook rule)

Motif: cartography — meridian lines, ink on paper, quiet precision. Tokens are CSS variables under Tailwind v4 `@theme`; both light and dark from day one.

**Color**
- `--color-paper` (app bg): near-white warm gray / dark: near-black warm
- `--color-surface` (cards): white / dark: elevated charcoal
- `--color-ink` (primary text), `--color-ink-muted` (secondary), `--color-ink-faint` (hairlines/metadata)
- `--color-meridian` (single accent, deep blue): interactive elements, focus rings, active nav
- Semantic, muted (never celebratory): `--color-support` (moss green) for supporting evidence, `--color-contradict` (oxide red) for contradicting evidence/contradicted state, `--color-pending` (amber) for pending proposals
- Confidence is rendered as **text label + thin evidence bar** (S vs C proportions) using support/contradict colors — never badges, medals, or progress-toward-anything

**Type**
- UI: Inter (system-ui fallback). Knowledge statements: Newsreader (serif) — conclusions read as considered text, not chat bubbles
- Scale: 13 (metadata) / 15 (body) / 17 (statements) / 22 (screen title). **All text inputs ≥ 16px** (iOS force-zoom rule)

**Shape & motion**
- Radius 8px cards, 6px controls; 1px hairline borders over shadows; spacing on a 4px grid
- Motion: 150ms ease-out state fades only. Nothing bounces, pulses, or celebrates

## 2. Application shell

- Mobile-first single column, max-width 640px centered on desktop.
- Bottom nav (static flex child, never `fixed` — playbook): **Capture · Knowledge · Review · More** (More → Experiments, Reviews, Search/Ask, Settings). Review tab shows a plain count when proposals are pending — a number, not a red badge.
- Playbook iOS hardening applies wholesale: `pan-x pan-y` on body, `overflow-x-clip` on every y-scroller, `--app-h` measured shell height, no autofocus, editors full-screen / lists in-pane.

## 3. Screens

### Capture (default tab) — *"What happened?"*
Textarea-first: placeholder "What happened, and what did you notice?"; kind selector (journal/note/conversation-paste) as quiet segmented control; optional `occurredAt` chip (defaults to now). Below: this week's entries as compact rows (title/first-line, date, distill-state dot). Row → Entry detail. Draft persists to localStorage on every keystroke; offline save says "Saved on this device — will sync" (honest copy).

### Entry detail — *"What did Atlas make of this?"*
Body (rendered markdown), metadata line (kind · occurredAt · source app/mcp). Actions: **Distill** (or "Distilled ✓ → view proposal"), Edit, Mark as retelling (sets `duplicateOf` via search picker), Archive. Below: evidence rows citing this entry ("This entry supports *kn: I become performative…*").

### Review queue (Review tab) — *"What does Atlas think it learned — is it right?"*
The product's center of gravity. Pending proposals grouped by source entry/run; contradiction-bearing proposals pinned first with an oxide-red left rule. Each **op is a card**: type chip + proposed statement/change + cited excerpt (tappable to source) + rationale line. Card actions: **Approve · Edit · Reject** (edit opens statement/body inline; reject optionally captures a one-tap reason: wrong / duplicate / not important — feeds approval-rate metric). Header: "Approve remaining" after individual triage; never a blind approve-all as the only path. Empty state: "Nothing awaits review. Capture something, or ask Atlas a question."

### Knowledge (tab) — *"What do I know?"*
Filter row (type · confidence · active/archived), default active-all. Dense list rows: serif statement, type + confidence label, evidence bar (S:C), updated date. Sort: recently revised. No pagination-as-feed; sections collapse by type. Empty state teaches the loop: "Knowledge appears here after you review Atlas's proposals. Start by capturing an experience."

### Knowledge object detail — *"Why do I believe this?"*
The provenance screen; everything the vision's Provenance section demands, on one screen:
1. Statement (serif, large) + type + status; confidence label with computation shown ("Supported — 3 distinct sources, 1 contradicting") + override control (override marked "your call" thereafter, with drift note if suggestion diverges)
2. **Evidence** — two stacks: Supports / Contradicts; each row = source excerpt + date + origin icon (you/AI) → source
3. **Relationships** — grouped by kind, both directions ("generalizes → *pattern: …*", "← derives-from *observation: …*")
4. **History** — revision list: date · actor (You / AI-proposed, you approved) · reason; tap → full snapshot view
5. Actions: Revise (reason required), Archive (reason required), **Design experiment** (prefills from statement)

### Experiments — *"What am I testing?"*
Active experiments as cards: hypothesis, behavior, tested-object link, started date, **Record outcome** button → outcome form (result segmented control + narrative + observedAt). Completed section below (result label + link to the evidence it produced). Draft experiments (AI-proposed, approved but not started) show **Start**.

### Reviews — *"What changed?"*
List by period; unread marked with a dot. Review detail renders `sections` natively: new insights (statement links), themes, contradictions, confidence changes (from → to with evidence-bar delta), experiment activity, open questions, then the short prose. No streaks, no "keep it up".

### Search / Ask — *"What have I learned about…?"*
One input, two result modes: instant list results (knowledge + entries, hybrid search) while typing; **Ask** button runs synthesis → answer paragraph with citation chips linking to objects/entries. Recent asks kept locally (not a server-side history feature).

### Settings
Profile (name, timezone) · AI (auto-distill toggle + "each auto-distillation costs tokens" honesty, review cadence, budget usage today) · **Connections** (MCP keys: create/named/shown-once/revoke; OAuth grants list + revoke; setup snippets for the ChatGPT connector (OAuth) & Codex/agents (bearer key)) · Export (one tap → JSON download) · Issue inbox (file issue + screenshot; see resolutions, verify/reopen) · Danger zone (delete account, typed confirmation).

## 4. Cross-cutting UX rules

- **Provenance always visible:** any AI-originated text (proposal cards, review prose, ask answers) carries a small "AI" origin mark; approved knowledge shows origin in detail history, not as a scarlet letter in lists (once approved, it's *your* knowledge).
- **Honest copy everywhere:** budget exhausted, offline saves, empty AI results ("Atlas found nothing worth proposing in this entry") — say what actually happened.
- **`data-testid` on every interactive element from the first component** (playbook), semantic: `capture-input`, `op-approve`, `evidence-row-supports`.
- Loading: skeleton rows, no spinners over 300ms without text; errors state what failed and keep user input.
- Accessibility: WCAG AA contrast in both themes (evidence colors checked in both), visible focus rings (meridian), full keyboard operability of the review queue.
