# Dev flow — building & scaling `easier-to-deploy-storefronts`

How `easier-to-deploy-storefronts` is built end-to-end, the three tools that close the loop around it, the 11-phase process from blank repo → human-tested production, and the scaling math for going from 1 owner / 100 customers/month to 1 owner / 1M customers/month.

> **Why this doc exists**: Building software for a non-technical owner has hidden phases that production-only docs hide. This is the meta-process — what to do *before* you write the code, *how* to verify it after, and *when* to graduate to heavier infrastructure. Doubles as a system-design case-study reference; see [§ Interview prep](#interview-prep--this-repo-as-a-case-study) at the bottom.

---

## The three-repo workflow

`easier-to-deploy-storefronts` doesn't ship alone. Two sibling repos handle the parts that aren't runtime code — design staging and changelog/handoff protocol. They're independent tools you can adopt one at a time, but together they close the loop:

```
                     ┌──────────────────────────┐
                     │   PARITY STUDIO          │  Design staging + visual QA
                     │   github.com/HomenShum/  │
                     │     parity-studio        │  Capture UI -> decompose into
                     │                          │  ui_kit/ -> verify parity ->
                     │   image -> ui_kit ->     │  scoped comment/edit -> QA
                     │   verify -> proof packet │  proof packet -> approved
                     │                          │  delta -> production code
                     └──────────┬───────────────┘
                                │  imports / exports `ui_kit/<slug>/`
                                │  emits qa-packet.json
                                ▼
┌───────────────────────────────────────────────────────────────────────┐
│                                                                        │
│            EASIER-TO-DEPLOY-STOREFRONTS (this repo)                    │
│                                                                        │
│        ┌─────────────────┐  ┌────────────────┐  ┌──────────────┐      │
│        │ Public site     │  │ Owner inbox    │  │ Convex DB    │      │
│        │ (3 langs, CMS-  │  │ (auth, tabs,   │  │ + storage    │      │
│        │ hydrated)       │  │ sessions)      │  │ + cron       │      │
│        └────────┬────────┘  └────────┬───────┘  └───────┬──────┘      │
│                 │                    │                  │              │
│                 └────────┬───────────┴──────────────────┘              │
│                          │  /api/* serverless functions                │
│                          │  Resend (email) + OpenRouter (translate)    │
│                                                                        │
└──────────┬─────────────────────────────────────────────────────────────┘
           │  every commit / PR / handoff
           ▼
                     ┌──────────────────────────┐
                     │  EASIER-TO-READ-         │  Per-surface changelog
                     │  SUBMISSIONS             │  protocol + runtime
                     │  github.com/HomenShum/   │  diagrams + QA packet
                     │    easier-to-read-       │  schema. Defines the
                     │    submissions           │  *contract*; doesn't
                     │                          │  ship visual capture.
                     │  CHANGELOG/<lane>.md     │
                     │  per surface, append-    │  Reads parity-studio's
                     │  only, dated, cross-     │  qa-packet.json shape.
                     │  linked                  │
                     └──────────────────────────┘
```

### Who does what

| Concern | Tool | Why |
|---|---|---|
| **Runtime app** | `easier-to-deploy-storefronts` | The deployed product mom uses. |
| **Design staging before code change** | `parity-studio` | Capture the existing UI route, decompose into editable `ui_kit/<slug>/`, comment on a scoped slice, let the agent fix only that slice, export proof. Avoids "agent rewrites half the app to fix a button." |
| **Per-surface changelog + handoff packet** | `easier-to-read-submissions` | Every page / component / db table / integration / script gets its own append-only `CHANGELOG/<category>/<slug>.md`. Per-surface lanes beat one-undifferentiated-`git log` for reviewers, future-self debugging, and handing off to the next agent. |
| **Visual QA proof** | `parity-studio` (generator) reads `easier-to-read-submissions` schema | Per-state screenshots + GIF + Remotion video + before/after diff, all conforming to `qa-packet-schema.json`. |
| **Demo recording verification** | `easier-to-read-submissions` Playwright + Gemini script | DOM check + Gemini video pass — both must pass before "shipped." |

### How `easier-to-deploy-storefronts` consumes them

1. **Before changing UI**: open the live route in `parity-studio` ("capture an existing app route"), decompose, pin a comment on the slice that needs to change, let the agent stage the edit. Export the approved delta.
2. **While committing**: `easier-to-read-submissions` enforces per-surface changelog entries (one prepended row in each `CHANGELOG/<lane>.md` the diff touched).
3. **When the change touched a screen**: re-record the demo via the Playwright recorder, run the Gemini verifier. Both green = ready to push.
4. **When handing off** (to a new dev, to mom, to the next AI agent): generate the QA packet via `parity-studio` (or any conforming generator) — single email/page with preview link, per-state URLs, screenshots, GIFs, optional video, per-state verdicts.

You can adopt these incrementally. Just `easier-to-deploy-storefronts` works as a standalone marketplace template. Add `easier-to-read-submissions` when handoffs start mattering. Add `parity-studio` when "agent broke the layout" becomes a recurring fire.

---

## The 11-phase build process

Each phase has a goal, a tooling choice, and a check before you advance. **Don't skip phases.** The order encodes the dependencies — building UI before agreeing on user scenarios is how you end up rebuilding.

### Phase 1 — Clarify scenarios, data sources, pain points, schemas

**Goal**: Write down (a) the exact users, (b) the painful task each user does today, (c) the data they touch, (d) input/output schemas for every API surface.

**Tooling**: Plain markdown. A Notion doc. A whiteboard photo. Doesn't matter — what matters is it's externalized and dated.

**Output artifacts** (commit these to the repo):
```
docs/SCENARIOS.md       — 5–10 named scenarios, each one a paragraph
docs/PAIN_POINTS.md     — what's broken today, ranked by frequency × severity
docs/SCHEMAS.md         — TypeScript types for every API request/response
```

For `easier-to-deploy-storefronts`, the scenarios were:

| Scenario | Pain (today) | Schema implication |
|---|---|---|
| Owner edits price on phone while waiting for a customer | Re-deploy from a laptop, wait 3 min for build | `siteContent.data: v.any()` (no migration on copy change) |
| Customer messages in Spanish, owner reads Chinese | Owner uses Google Translate side-by-side | `inquiries.detectedLang` + `translatedMessage` |
| Owner forgot her admin password on a new phone | Texts the developer at 9 PM | `adminAuth` magic-link state machine |
| Owner uploads 30 photos at once | Manual dashboard click each | `scripts/bulk-upload-photos.py` |
| Owner gets locked out by stolen device | No recourse | `revokeAllForEmail` + sessions modal |

**Check before advancing**: Can you write a one-paragraph user story for each scenario without making things up? If no, you don't understand the problem yet.

### Phase 2 — Design UX/UI

**Goal**: A visual artifact (Figma frames, Parity Studio `ui_kit/`, Open Design export, Claude Design skill pack) for every scenario from Phase 1, before you write production code.

**Tooling**:

| Tool | Use when | Note |
|---|---|---|
| **Parity Studio** | You already have a draft (image, screenshot, even a hand sketch) and want to decompose it into editable `ui_kit/<slug>/` files that an agent can implement against | Captures existing app routes too — useful for redesigns. Exports `qa-packet.json` for handoff. |
| **Open Design / Claude Design** | You want generative starting points from a description | Both export to skill-pack ZIPs that Parity Studio can import. |
| **Figma (traditional)** | You're collaborating with a designer or stakeholders who already use it | Parity Studio has a Figma bridge (JSON/ZIP roundtrip) so the agent can implement against Figma frames. |

For `easier-to-deploy-storefronts`: the public site sketches lived in Parity Studio (3 language variants of the same skeleton, scoped comments per pricing row), the inbox sketches were a Figma frame the developer drew themselves.

**Output artifacts**:
```
ui_kit/landing-en/         — Parity Studio kit for the EN landing page
ui_kit/landing-zh/         — ZH variant
ui_kit/landing-es/         — ES variant
ui_kit/inbox/              — owner SPA
docs/figma-bridge.json     — Figma export (if used)
```

**Check before advancing**: Can a coding agent implement the UI from these artifacts without asking design questions? Run a small experiment — give the kit to Claude Code and see if it produces something close to the design without follow-up.

### Phase 3 — Design API endpoints + agent runtime

**Goal**: The exact list of `/api/*` routes, their schemas (refining Phase 1), and — if the product uses an agent — the agent's tool surface and runtime model.

**For `easier-to-deploy-storefronts`'s scope**: 11 Vercel routes, 4 Convex HTTP routes, 1 small "Assist" agent (translation + reply suggestions). Most of the API surface is plain serverless functions. The agent surface is small — that's intentional.

**Agent runtime choices** (when your project needs more than translation):

| Pattern | Use when | Tooling |
|---|---|---|
| **pi-ai framework** | One LLM call per user action, one or two tools, deterministic output | Direct OpenRouter / Anthropic SDK call. The simplest agent. |
| **OpenClaw-style harness** (or Claude-Code-alike loop) | Multi-step task, tool-calling, scratchpad needed (e.g. "research and summarize this customer's history before composing a reply") | Custom loop with state machine + tool-call dispatcher. ~200 lines per agent. |
| **MCP servers** | Cross-tool integration (let Claude Code talk to your DB, your Resend account, your Parity Studio runs) | `mcp` packages — see Parity Studio's `parity-studio-mcp` for a working example. |

**Output artifacts**:
```
docs/API.md                — every route, its method/path/auth/body/response schema
docs/AGENT_RUNTIME.md      — for each agent: tools, system prompt, model fallback chain
mcp/                       — MCP server source (if exposing the project to other agents)
```

**Check before advancing**: Can you write a `curl` (or similar) for every route from your API doc? Can you write the JSON tool-spec for every agent tool? If no, the design is incomplete.

### Phase 4 — Evaluate agent performance against scenarios

**Goal**: For every agent in the system, a deterministic eval suite that scores how well it handles the Phase 1 scenarios.

**Tooling**:

- A spreadsheet (Google Sheets, Airtable) of `(scenario, expected_output_pattern)` pairs.
- A small `evals/` directory with scripts that run the agent against each scenario and check the output.
- Optional: a model-graded eval (use a stronger model — GPT-4 / Claude Opus — to judge whether the agent's output meets the rubric).

For `easier-to-deploy-storefronts`'s translation agent, the eval was 24 messages across 8 source languages → grade if the translation preserved meaning AND the detected language was correct. Pass rate target: 95%.

**Output artifacts**:
```
evals/translation/scenarios.json     — 24 message+expected pairs
evals/translation/run.mjs            — runs each scenario, scores
evals/translation/results.md         — pass/fail/notes per scenario
```

**Check before advancing**: Pass rate ≥ your target? If not, fix the agent (better prompt, better fallback chain, better model) before continuing. Don't ship features on top of a broken agent.

### Phase 5 — Add real-time / streaming where it matters

**Goal**: Identify the user actions that benefit from streaming (perceived latency, agent reasoning visible), wire SSE/WebSocket for those.

**Don't stream by default.** Streaming adds complexity and breaks under poor connectivity. Reserve it for:

| Action | Why stream |
|---|---|
| Agent reply suggestion | User sees tokens as they arrive — feels 3× faster |
| File upload progress | User trusts the action is happening |
| Live calendar updates | Mom's phone shows a new booking the moment a deposit lands |

**Tooling**:

| Pattern | Use when | Tradeoffs |
|---|---|---|
| **SSE (Server-Sent Events)** | Server → client only. Simpler. Reconnects automatically. | Doesn't traverse some corporate proxies cleanly |
| **WebSocket** | Bi-directional. Lower latency. | More state to manage, harder to fail back to polling |
| **Convex reactive queries** | The data lives in Convex anyway | "Free" — the SDK handles the protocol. Best for db-backed live state |
| **Vercel Functions response streaming** | Agent token streams from a Vercel route | Standard `ReadableStream`, no WebSocket infra needed |

For `easier-to-deploy-storefronts`: the inbox uses Convex reactive queries for inquiry list updates (no extra code), and Vercel function streaming for the "Assist" agent's reply suggestions.

**Output artifacts**:
```
docs/REALTIME.md      — which surfaces stream, why, fallback behavior
api/agent/suggest.js  — example streaming endpoint (ReadableStream response)
```

**Check before advancing**: Pull the network tab on the streaming surface. Are tokens arriving in chunks (good) or one blob (no streaming)? If one blob, the streaming is broken even if the UX looks like it works.

### Phase 6 — Context management for long-running tasks

**Goal**: For any task that exceeds a single LLM context window or runs longer than a serverless function timeout (Vercel: 10s Hobby / 60s Pro / 900s Pro+), design the durable state.

**Tooling decision tree**:

```
Task duration < 10s?  → Just a serverless function. Done.
Task duration < 60s?  → Vercel Pro function. Done.
Task duration < 15min? → Vercel Pro+ background function OR Convex action.
Task duration > 15min? → Need a durable workflow runtime (Temporal, Inngest, Trigger.dev).
                          OR a job queue (BullMQ, Convex scheduled mutations).
```

**Context patterns**:

| Pattern | Use when | Trade |
|---|---|---|
| **Reduce + summarize** | Long conversation history → summarize old turns into a single context block | Loses fidelity on details. Cheap. |
| **Retrieve + augment (RAG)** | Large knowledge base → embed, retrieve top-K chunks per query | More infra (vector store) but bounded context |
| **Scratchpad in Convex** | Multi-step task where each step writes intermediate output | Persistent across agent restarts. Cheap. |
| **External scratchpad files** | The agent literally needs to edit files (e.g. Claude Code) | Use a dedicated workspace dir, gitignored, agent reads/writes |

For `easier-to-deploy-storefronts`: no agent-side context management is needed yet — every agent call is single-shot. If the inbox grows an "Autopilot" mode that drafts replies overnight, that becomes Phase 6 work.

**Output artifacts**:
```
docs/CONTEXT.md            — for each long task, the pattern + storage location + budget
convex/scratchpads/        — table for agent intermediate state (when needed)
```

### Phase 7 — Compaction, storage, scratchpad, CRUD on external file systems

**Goal**: For every external state your agents touch (file system, Convex storage, S3, third-party APIs), define the lifecycle (create, read, update, delete, expire/compact).

**For `easier-to-deploy-storefronts`**: the `adminAuth` table is the only state with a non-trivial lifecycle (15-min link TTL, 30-day session TTL, daily `sweepExpired` cron). The gallery has a 48-photo cap with FIFO eviction.

**Patterns**:

| Concern | Pattern |
|---|---|
| **Token TTL** | Daily cron walks `by_expires` index, deletes batch of N |
| **Photo cap** | On insert, if `len > N`, drop oldest. Convex storage blobs leak — best-effort `ctx.storage.delete()` |
| **Conversation history compaction** | Summarize every K turns; archive raw turns in a cold table |
| **External file system writes** | Always go through a typed wrapper that logs every write — debugging "agent ate my file" is bad |

**Output artifacts**:
```
convex/crons.ts                — every recurring cleanup
convex/<table>/lifecycle.ts    — explicit TTL/compact functions per table
docs/STORAGE.md                — what's stored where, retention policy, recovery procedure
```

### Phase 8 — Evaluate added agent runtime infrastructure, features, tools

**Goal**: The Phase 4 eval applies to the *initial* agent. Every time you add a tool, increase context, or change the model, re-run the eval. Otherwise you're flying blind.

**Make this cheap**: a `npm run eval:translation` command that takes < 60 seconds. If it takes longer, you'll skip it.

**Track regression**: append to `evals/<agent>/results.md` with date + pass-rate + notes. The lane is the audit trail (this is exactly the [`easier-to-read-submissions`](https://github.com/HomenShum/easier-to-read-submissions) per-surface changelog pattern, applied to evals).

**Output artifacts**:
```
evals/<agent>/results.md     — append-only run log
.github/workflows/eval.yml   — CI runs eval on PR (block merge if pass-rate drops)
```

### Phase 9 — QA dogfood on live UI

**Goal**: Before shipping, walk through every Phase 1 scenario on the live (or preview) deployment, with screenshots/recording per state.

**Tooling**: Parity Studio's QA packet generator (capture per-state screenshots → GIF → optional Remotion video → before/after diff → review page). The output is a QA packet conforming to [`qa-packet-schema.json`](https://github.com/HomenShum/easier-to-read-submissions/blob/main/qa-packet-schema.json).

**Process**:

```
1. List every state the change affects (e.g. "logged-out / logged-in / sessions-modal-open").
2. For each state, capture a screenshot at a stable URL.
3. Record a 30s GIF of the user journey through the change.
4. Generate before/after diff for any moved/styled element.
5. Bundle as QA packet.
6. Send to the reviewer (Gmail Magic Resend if configured, or just attach to PR).
```

**For `easier-to-deploy-storefronts`'s magic-link feature**, the QA packet had:
- Pre-state: login overlay (email field empty)
- Action: paste email, click "Send login link"
- Post-state-1: success message visible
- Action: open email, click link
- Post-state-2: redirected to /inbox, FAB visible on landing page when re-visited
- Per-state Gemini verdict: "✓ visible" / "✗ not visible past fold"

**Output artifacts**:
```
QA_DOGFOOD/<feature>/qa-packet.json     — schema-conforming packet
QA_DOGFOOD/<feature>/<state>.png        — per-state screenshots
QA_DOGFOOD/<feature>/<journey>.gif      — recorded walk-through
```

**Check before advancing**: All states show what they should show? Both DOM checks (Playwright) AND Gemini video analysis pass?

### Phase 10 — Real users + human judges

**Goal**: Watch a real person (the owner / mom / a friend in the target persona) use the product. Don't talk during the session. Record the screen. Watch it back later.

**What you're looking for**:

- Where they hesitate (a button label they don't understand)
- Where they tap something that isn't tappable (a missing affordance)
- Where they explicitly say "I don't get this"
- Where they DO get it and breeze through (those are the wins to leave alone)

**For `easier-to-deploy-storefronts`'s magic-link feature**, the test was: a Mac, a fresh browser, mom's email account already open in another tab. The instruction was "sign in to the website I built you." She got it on the first try, ~25 seconds total, no help. That was the green light.

**Human judges for agent quality**: pick 2–3 reviewers (yourself, one developer, one target user). Score 20 random agent outputs blind on a 1–5 rubric (correctness, helpfulness, tone). If the rubric is consistent across judges, you have a real signal.

**Output artifacts**:
```
docs/USER_TESTS/<date>.md                — observation log
docs/AGENT_HUMAN_JUDGE/<date>.csv        — blind-rated samples
```

**Check before advancing**: 90%+ of users complete the core flow without hand-holding. Below that, fix the friction before scaling.

### Phase 11 — Scaling

See the [next major section](#scaling-from-1-customermonth-to-1m-customermonth) — it's long enough to deserve its own header.

---

## Scaling: from 1 customer/month to 1M customers/month

`easier-to-deploy-storefronts` runs on free tiers at the bottom of this curve. Each step up needs a deliberate infrastructure decision, not a retroactive panic.

### The math

Assume one owner. The variable is **monthly visitors / inquiries / photo uploads**.

| Tier | Monthly visitors | Monthly inquiries | Monthly cost | What changes |
|---|---|---|---|---|
| **Free** | < 10K | < 100 | $0 | Vercel Hobby + Convex Free + Resend Free + OpenRouter PAYG (~$0.50) |
| **Light** | 10K–100K | 100–1K | $5–25 | Add a custom domain ($12/yr). Resend usage < 3K/mo cap. |
| **Mid** | 100K–1M | 1K–10K | $50–200 | Vercel Pro ($20/mo) for higher function limits. Convex Pro ($25/mo) for higher writes. Resend $20 paid tier. |
| **Heavy** | 1M–10M | 10K–100K | $500–2K | Add edge caching strategy. Add rate limiting (Upstash Redis ~$10/mo). Migrate translation to dedicated provider with volume discount. |
| **Enterprise** | > 10M | > 100K | $2K–10K+ | Real engineering: regional deployments, durable workflows, multi-region DB. See § Production-readiness toolbox. |

**Key inflection points to plan for**:

1. **~3K Resend emails/month** — outgrow the free tier. Migrate sender domain to a verified one (still cheap, just not $0).
2. **~1M Convex function calls/month** — outgrow the free tier. Convex Pro is $25/mo flat for ~10× the limits.
3. **~100 Vercel function invocations/second sustained** — Hobby tier rate-limits. Pro is $20/mo.
4. **Translation cost > $50/mo** — pricing inflection. Switch from OpenRouter pay-as-you-go to a direct provider with a volume contract, or use a cached translation table for repeat phrases.

### Production-readiness toolbox

When you cross the **Mid→Heavy** boundary, the failure modes change. Single-region degraded? Owner sees 401 errors? Translation stuck on a slow model? You need observability + durability + recovery.

#### Temporal (durable workflows)

**What it solves**: any long-running task that crosses external services and must complete reliably even if the orchestrator restarts. Think: "send a customer follow-up email 3 days after the booking ends; if Resend is down, retry with exponential backoff for up to 24h; if still failing, alert the owner."

**Use when**: your workflows have ≥ 3 steps with external calls AND must complete reliably. For `easier-to-deploy-storefronts` at Mid scale, the post-stay review-request flow is exactly this shape.

**Cost at scale**: Temporal Cloud is ~$200/mo for the smallest tier; self-hosted on a single t3.medium is ~$30/mo. Worth it once a flaky workflow costs you a customer.

**Alternatives**:

| Tool | When to pick | Tradeoff |
|---|---|---|
| **Inngest** | You want serverless, event-driven workflows, no infrastructure to run | Vendor lock-in. ~$20/mo to start. |
| **Trigger.dev** | Same as Inngest, more Node-friendly DX | Smaller ecosystem. |
| **Convex scheduled mutations + retries** | Workflow is < 5 steps, all in Convex | Free, but no fan-out / parallelism patterns. |
| **DIY job queue (BullMQ + Redis)** | You want full control + cheap | Lots of code. Don't pick this if you can avoid it. |

#### Docker (containerization)

**What it solves**: reproducibility. "Works on my machine" → "works everywhere this image runs."

**Use when**: you have a service that *isn't* a Vercel function — a Python ML worker, a Temporal worker, a custom MCP server you're hosting somewhere persistent.

**For `easier-to-deploy-storefronts`'s current scope**: not yet needed. Vercel functions are containers under the hood. Pull this in when you outgrow them.

#### Terraform (infrastructure as code)

**What it solves**: reproducibility for cloud resources. Manually click-ops'd VPCs and RDS instances are a debt-bomb.

**Use when**: you have ≥ 5 cloud resources (load balancers, security groups, IAM roles, secrets, RDS, ElastiCache). Below that threshold, the click-ops cost is less than the Terraform learning cost.

**For `easier-to-deploy-storefronts`'s current scope**: not yet needed (Vercel + Convex provision themselves). Becomes relevant if you self-host anything.

**Alternatives**:

| Tool | Pick when |
|---|---|
| **Pulumi** | You want IaC in TypeScript (not HCL) and your team is JS-heavy |
| **AWS CDK** | You're all-in on AWS and want type-safe constructs |
| **Manual click-ops + a runbook** | < 5 resources, single dev, can re-create from memory |

#### AWS Fargate (serverless containers)

**What it solves**: running containers without managing nodes.

**Use when**: you've outgrown Vercel functions (longer than 900s, > 4.5MB request body, need stateful sockets, etc.) and need to run a container 24/7. Common reasons: hosting a Temporal worker, running a Python ML service, hosting an MCP server.

**Cost**: ~$15/mo for a tiny task (0.25 vCPU, 0.5GB RAM, always-on). $50–150/mo for a real workload.

**Alternatives**:

| Tool | Pick when |
|---|---|
| **Cloudflare Workers + Durable Objects** | Stateful at edge. Lower latency for global users. Cheaper at low volume. |
| **Fly.io** | Multi-region containers without AWS complexity. Great DX. |
| **Render / Railway** | Heroku-like simplicity. Good for one-off services. |
| **Self-hosted on a VPS (Hetzner, DO)** | Cheapest. You manage everything. |

For `easier-to-deploy-storefronts`'s scope, **Cloudflare Workers** is the natural next-step beyond Vercel — same edge model, no infrastructure to think about.

#### DuckDB (embedded analytical SQL)

**What it solves**: complex analytics queries on millions of rows without a separate OLAP database. Lives in-process; reads Parquet/CSV/JSON natively.

**Use when**: you want analytics on your operational data and your data fits in a single node (up to ~100GB compressed). Examples: per-customer LTV, conversion funnel, daily active owners.

**For `easier-to-deploy-storefronts`'s current scope**: not needed — Convex queries handle the few aggregations you do. Becomes relevant when you want a real "owner dashboard" with cohort analysis.

**Alternatives**:

| Tool | Pick when |
|---|---|
| **ClickHouse** | Analytics on > 100GB or > 1B rows. Order of magnitude faster but heavier ops. |
| **Postgres + materialized views** | You're already on Postgres and the queries fit |
| **BigQuery / Snowflake** | You want managed and don't care about cost |

### Fault tolerance — concrete failure modes

For each provider in the stack, what happens when it goes down?

| Provider | Failure mode | Mitigation in `easier-to-deploy-storefronts` today | Mitigation at scale |
|---|---|---|---|
| **Vercel function region** | 5xx for the duration | None — single region | Multi-region deploy + edge caching for static |
| **Convex** | All admin writes 401 (fail-closed by design) | None — owner sees error | Convex Cloud is multi-region; rare. Add Postgres mirror via stream-CDC if SLA matters |
| **Resend** | Magic-link emails delayed | Retry on 5xx, log. Owner sees "check your inbox" anyway | Add Postmark as backup sender (15 lines of code) |
| **OpenRouter** | Translation slow / down | Fallback chain (`kimi-k2` → `qwen3-max` → `deepseek-chat`) | Cache repeat translations in Convex |
| **Customer's email provider** | Inquiry email bounced | Logged in Convex, owner sees it in inbox anyway | Add SMS fallback (Twilio) |

### Calculation — when does which scale step happen?

Concrete back-of-envelope for `easier-to-deploy-storefronts`:

```
Free tier breakeven (Vercel Hobby + Convex Free + Resend Free):
  Vercel:   100K function invocations/day
            With 5 calls/visitor avg → 20K visitors/day → 600K visitors/mo
  Convex:   1M function calls/mo
            With 3 calls/page-load → 333K page loads/mo
  Resend:   100 emails/day = 3K/mo
            With 1 email/inquiry, owner needs ≤ 100 inquiries/day to stay free

Bottleneck:  Resend, at ~3K inquiries/month.
First paid:  Resend $20/mo gets you 50K emails/month.

Vercel Pro graduation:
  Triggers when you need >100 GB bandwidth/mo or longer function timeouts.
  At ~10K visitors/day with 30KB pages = 9 GB/mo. Long tail before this matters.
  Pro = $20/mo.

Convex Pro graduation:
  Triggers at 1M function calls/mo or > 1GB storage.
  100K inquiries (with 10 admin reads each) = 1M reads = right at the limit.
  Pro = $25/mo, 25× the limits.

Total monthly cost at "moderately successful":
  ~50K visitors/mo, ~500 inquiries/mo  →  $0–5
  ~500K visitors/mo, ~5K inquiries/mo  →  $40–80
  ~5M visitors/mo, ~50K inquiries/mo   →  $300–800 (also: hire help)
```

The takeaway: **you can run this template for free until you have a real business.** And when you have a real business, scaling costs grow sub-linearly with revenue.

---

## Interview prep — this repo as a case study

`easier-to-deploy-storefronts` is a useful case study for system design interviews because it touches **every layer of a small product** without the usual contortions. The questions a thoughtful interviewer asks about it also apply to most "solo SaaS / niche marketplace" prompts.

### Questions this repo answers

1. **"How would you design a CMS for non-technical users?"**
   - Answer: one freeform-blob row per language; HTML owns the schema via `data-cms` attributes; edit-in-place via `contenteditable`; server-side validate the auth token before showing the FAB. (See [§ Phase 1, design decision #2 in README](README.md).)

2. **"How would you do passwordless auth without an identity provider?"**
   - Answer: state machine with `link` (single-use, 15-min) + `session` (long-lived, 30-day) tokens in one table, allowlist-gated, server-validated, fail-closed. (See [§ Auth state machine in README](README.md).)

3. **"How would you make a multilingual site without auto-translation?"**
   - Answer: per-language CMS row, divergent content on purpose, same `data-cms` namespace; let the owner write each. Auto-translation kicks in only at customer-message ingestion time. (See [§ Phase 8 in SKILL.md](SKILL.md).)

4. **"How do you keep an agent runtime cheap?"**
   - Answer: single-shot calls where possible; OpenRouter fallback chain so a single provider outage doesn't kill replies; cache repeat translations once volume justifies it.

5. **"How do you handoff this codebase to a junior or to an AI agent?"**
   - Answer: per-surface changelog lanes ([`easier-to-read-submissions`](https://github.com/HomenShum/easier-to-read-submissions)) so the next person greps into one lane file instead of `git log` + visual QA packets ([`parity-studio`](https://github.com/HomenShum/parity-studio)) so claims are verifiable.

### Tradeoffs worth lifting up in interview

- **One blob per lang vs normalized tables** — chose blob for migration-free flexibility; cost is no schema enforcement on copy.
- **Magic-link vs passwords vs OAuth** — chose magic-link for non-technical owner; cost is dependence on email deliverability.
- **Convex vs Postgres** — chose Convex for one-product velocity; cost is provider lock-in (mitigated by HTTP-route abstraction).
- **No customer accounts** — chose to skip; cost is no "your past inquiries" page (acceptable for the use case).
- **Free-tier stack vs paid from day one** — chose free; cost is migration work at the inflection points (Phase 11 math is the migration plan).

### Failure modes to discuss

- **Convex outage during owner login** → fail-closed 401, but the FAB also disappears; owner sees nothing usable. Mitigation: status page + "we're offline, try in 5 min" UI.
- **Resend deliverability drift** → mom's magic-link email lands in spam. Mitigation: instructions in the password-recovery flow ("check spam"), monitor bounce rate.
- **Stale `ses_` token after key rotation** → mom is suddenly logged out; doesn't know why. Mitigation: rotation flow includes a courtesy email + re-onboarding link.
- **OpenRouter all-models-down** → no translation; inquiries arrive in source language only. Mitigation: graceful degradation — store original, mark `translatedMessage = null`, owner can manually translate.

### How to talk about this in 5 minutes

> "I built `easier-to-deploy-storefronts` for my mom's pet-boarding business. The core constraint was that she's non-technical and would never log into a database console or a deploy pipeline. The shape that fell out is: static structure ships through git, dynamic content lives in Convex, owner edits in-place via a button on the live page, signs in via email magic-link.
>
> The interesting design decisions were: (1) one CMS blob per language so adding a section never requires a migration, (2) magic-link auth as a state machine in a single table so the same sweep cron handles both link and session tokens, (3) edit-in-place via `contenteditable` so there's no separate dashboard to maintain, (4) OpenRouter fallback chain so a single LLM provider outage doesn't kill translation.
>
> The whole thing runs on free tiers up to ~5K inquiries/month. The first inflection is Resend's email cap, which is $20/mo to lift. Generalizes to any solo service business — tutor, photographer, freelance editor — because the architectural shape is one owner / many customers, which is most small businesses on the web."

---

## Cross-references

- [`README.md`](README.md) — what `easier-to-deploy-storefronts` is and the current architecture
- [`SKILL.md`](SKILL.md) — 10-phase construction playbook (writing the code)
- [`PUBLISH_CHECKLIST.md`](PUBLISH_CHECKLIST.md) — going public safely
- [`.env.example`](.env.example) — every env var documented
- [`easier-to-read-submissions`](https://github.com/HomenShum/easier-to-read-submissions) — changelog/handoff protocol
- [`parity-studio`](https://github.com/HomenShum/parity-studio) — design staging + visual QA
