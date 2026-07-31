# The Adaptive AI Engine — Technical Whitepaper

**Status: research for review. No implementation has begun.** This is the design of the platform's core intellectual property — the reasoning behind every module named in `PLATFORM_V2_DESIGN.md` §5, worked out from first principles and grounded against proven industry techniques rather than invented in a vacuum.

---

## 1. Classical Game AI — A Comparative Study

| Technique | How it works | Strength | Weakness | Where it fits us |
|---|---|---|---|---|
| **Finite State Machine (FSM)** | Discrete states, hand-authored transitions | Simple, cheap, predictable | Transition count explodes combinatorially as behavior richness grows; brittle to edge cases not explicitly authored | Rejected as the core decision layer — doesn't scale across many genres/plugins. Fine as a *sub-component* (e.g., Difficulty Calibration's own internal pacing state, §7). |
| **Hierarchical FSM (HFSM)** | Nested FSMs; a parent state owns a child machine | Tames some of flat-FSM's explosion by scoping transitions | Still hand-authored, still brittle at the edges | Same verdict as FSM — useful as a component, not the spine. |
| **Behavior Trees (BT)** | Composable tree of selectors/sequences/decorators/leaves; industry-standard since the mid-2000s (Halo 2 onward) | Reusable subtrees, easier to author and debug visually than FSM, very good for *reactive* moment-to-moment behavior | Still fundamentally rule-based/reactive; doesn't naturally produce multi-step *planned* tactics (flanking, baiting) without a lot of hand-scripted structure | Not the platform's core layer, but explicitly the right tool for a plugin's *own* ambient NPCs (non-adaptive content inside a game) — that's the plugin's business, not ours. |
| **Utility AI** | Every candidate action gets a numeric score from weighted "considerations"; highest (or weighted-random) score wins. Popularized commercially by *The Sims*' "advertisement" system and later formalized by Dave Mark's *Behavioral Mathematics for Game AI* and the Infinite Axis Utility System | Naturally blends multiple concerns without branchy special-casing; cheap to evaluate; the score decomposition is inherently explainable; personality becomes "different weights on the same considerations" for free | Needs careful curve/weight tuning to feel good; no native concept of a multi-step plan | **Recommended as the Decision Engine's core algorithm** (§6). |
| **GOAP (Goal-Oriented Action Planning)** | STRIPS-style forward search over actions with preconditions/effects, finding a sequence that satisfies a goal. Shipped first in *F.E.A.R.* (2005, Jeff Orkin), still used today (e.g. in *Tomb Raider*, *Deus Ex*) | Produces genuinely emergent multi-step tactics (F.E.A.R.'s soldiers dynamically re-plan — shoot through a window if a door gets slammed on them) without every case being hand-scripted | Search cost scales with action-space size and plan depth; too expensive to re-run every tick for real-time genres | **Recommended for the Strategy Planner** (§6), on a slow cadence, over a small *abstract* action space — not the full legal-action set. |
| **Influence Maps** | A spatial grid where values (danger, opportunity, control) propagate outward from sources and decay with distance | Cheap, good macro spatial reasoning — "where is it safe," "where is contested" | Purely spatial, says nothing about timing, sequencing, or individual player habits | Useful as an input signal to Pattern Recognition's "risk windows" (§5) and to a plugin's Decision Adapter for positioning-heavy genres — a supporting data structure, not a decision paradigm on its own. |
| **Steering Behaviors** (Reynolds: seek/flee/pursue/evade/separation) | Low-level continuous movement output | Solves "how do I move toward a point smoothly," not "what should I do" | Orthogonal to decision-making entirely | Out of scope for the platform — this lives inside each plugin's own movement code, downstream of whatever action our Decision Engine chose. |

**Conclusion of §1:** no single classical technique is sufficient alone, and this is not a controversial position — essentially every well-regarded commercial "smart" AI blends layers rather than picking one paradigm. The rest of this document builds toward a specific layered hybrid (§6), directly informed by how the systems in §2 actually did it.

---

## 2. Modern Adaptive AI in Commercial Games — What Makes Them Work

Researched directly against primary/technical sources, not summarized from memory, given how much rides on getting these right.

### Middle-earth: Shadow of Mordor/War — the Nemesis System
A procedurally generated hierarchy of named orcs that remembers specific encounters with the specific player and resurfaces them later (a captain who defeated you returns, scarred, taunting you about it). Monolith's own framing (GDC 2018) was explicitly psychological — built around Self-Determination Theory's three needs (competence, autonomy, relatedness) — the goal was narrative *from* mechanics, not mechanics for their own sake.

**What we borrow:** persistent, specific, callback-able memory of past encounters tied to identifiable entities — not just aggregate statistics. This is exactly the **episodic memory** component of our Memory System (§4) and the richest fuel for Explainability (§8): "I remember you throwing that fake retreat last time" is categorically more compelling than "your feint rate is 34%," even though both can be true simultaneously.

### Alien: Isolation — the two-tier Director/Xenomorph system
A **Director AI** is omniscient — it always knows the player's exact position — but its job is *pacing*, not helping the Alien hunt. It maintains a "menace gauge"/tension budget and, when the Alien should threaten the player, tells it only to head toward the player's *general area*. The **Xenomorph AI** itself is genuinely ignorant of the player's exact location; it operates on its own simulated senses and a behavior tree. The explicit, stated design principle: the Xenomorph is *never* given the player's exact location — "preserving the terror of the Alien hunting for you without any sort of cheating."

**What we borrow — directly, almost without modification:** this is precisely the Strategy Planner / Decision Engine split already specified in `PLATFORM_V2_DESIGN.md` §5.5–5.6, and it independently validates our SDK's fairness boundary (§3.3 of that document) at the architecture level, not just the sandboxing-implementation level. The Director analog is our Strategy Planner: it can "know" everything the Player Profile/Pattern Recognition modules have learned. The Xenomorph analog is our Decision Engine: it only ever acts through the plugin's declared legal actions, and the Strategy Planner passes it *intent*, never raw hidden state. This is the single strongest piece of industry precedent for the whole platform's central promise.

### Left 4 Dead — the AI Director
Controls zombie population and pacing via a continuously-varying "intensity" signal (Valve's own description compares the generation approach to layered/Perlin-style noise) computed from observable player state (health, ammo, recent stress) rather than branching if/else rules, cycling through a small state model (build-up → peak → fade → relax, roughly).

**What we borrow:** the *shape* of a good pacing/calibration signal — smooth and derived from a handful of observable inputs, not a pile of special-cased rules — directly informs Difficulty Calibration's "Awareness Budget" design (§7). The small cyclic state model is a reasonable internal skeleton for that module specifically, independent of anything the Decision Engine or Strategy Planner does.

### Forza Motorsport — Drivatar
Learns an individual player's braking, throttle, and cornering tendencies from real driving data, and generates *new* driving behavior consistent with that learned style — it does not replay recorded inputs. Notably, the system's own history is a real-world instance of exactly the "start deterministic, evolve toward ML" trajectory this whitepaper recommends generally (§12.13): early Drivatar used a Bayesian model running locally; later versions moved to cloud-hosted models and, per Microsoft's own statements, incorporated deep learning, while keeping the *exchanged representation* (learned weights) small enough to share between players' consoles quickly.

**What we borrow:** the critical distinction between *learning statistics about a player* and *generating new behavior consistent with those statistics* — never literal playback — is exactly our Player Modeling → Strategy Planner → Decision Engine pipeline, and it's reassuring that a shipped, player-facing commercial system at scale validates that this pipeline shape (learn → generalize → generate) is the right one, not merely a theoretical nicety.

### The Sims — utility "advertisements"
Every interactive object in the world "advertises" a score for what it offers; a Sim weighs each advertisement against its current needs (motives) and picks accordingly. This is one of the two or three most-cited real-world Utility AI implementations in the industry and predates most formal Utility AI literature.

**What we borrow:** almost verbatim as the shape of our Decision Engine — "ask every legal action to advertise a score, weigh by current considerations, pick the best" is precisely the Sims pattern applied to combat/competitive decisions instead of domestic ones.

### Civilization — leader "flavors"
Each AI leader's strategic decision-making is driven by the same underlying evaluation machinery, differently weighted per leader personality ("flavors" for military vs. science vs. culture, etc.) — a leader who "loves" military conquest isn't running different code, it's running the same code with different priority weights.

**What we borrow:** direct precedent for Opponent Personality (§9) — identical knowledge, different weights, not different knowledge or different code paths.

### Chess engines — classical vs. modern, and what stayed the same
Classical engines (minimax + alpha-beta pruning + a hand-crafted evaluation function) are fully deterministic and inspectable. Modern top engines (Stockfish's NNUE, or AlphaZero-style self-play systems) replaced the *evaluation function* with a learned/neural one — but kept the *search/planning algorithm* itself structured and deterministic. Nobody shipped "a neural network that just outputs a move" as the state of the art; the highest-performing systems are still hybrids of structured search plus a learned component bolted onto one well-defined part of it.

**What we borrow:** the single most load-bearing piece of precedent in this whole document for §12.14/§12.15 — it is standard, proven industry practice to keep the *decision structure* deterministic and confine machine learning to *tuning the numbers that structure uses* (an evaluation function, in chess; consideration weights, for us), not to replace the structure itself. This directly resolves "which parts should stay deterministic vs. become ML" with real precedent rather than a guess.

### Modern FPS bots and strategy games generally
Halo's combat AI layers a behavior tree under higher-level "encounter" scripting; most competitive strategy-game AI blends scripted opening priorities with a scored evaluation of the current board/economy state. Pattern across nearly all of these: **a slow strategic layer feeding a fast tactical layer**, which is the same two-speed shape as Alien Isolation's Director/Xenomorph split and our own Strategy Planner/Decision Engine split. This isn't a coincidence — it's close to the only shape that satisfies "coherent over time" and "responsive in the moment" simultaneously, which is exactly why it recurs across every genre studied here.

---

## 3. Player Modeling Framework

### 3.1 General update model (applies to every continuous dimension)

Two numbers per dimension, both already validated in the archived WARDEN/THE FIVE prototypes and deliberately reused rather than reinvented:

```
value_new      = value_old + α · (observation − value_old)     // EWMA
confidence     = 1 − e^(−samples / k)                            // asymptotic, never reaches 1
α              = 1 / (1 + samples)   [bounded below by α_min]     // fast early learning,
                                                                    // slows as evidence accumulates
```

- **EWMA over a simple lifetime average** because recent behavior should outweigh very old behavior — players improve, change strategies, get better equipment/practice — but shouldn't be *forgotten* either, which a pure "last N observations" window would do abruptly. The exponential decay is the mechanism that answers "how much should historical data matter": a lot, but with continuously fading weight, not a hard cutoff.
- **`k` is tuned per dimension**, not global — a dimension that's a stable trait (reaction time) can use a larger `k` (trust builds slower, but the read is more durable); a dimension that's context-sensitive (favorite ability *this patch*) should use a smaller `k` so the AI doesn't cling to a stale read after the game world itself changes.
- **This is precisely the `1 − e^(−runs/2.6)` "depth" formula** already shipped and playtested (in a single-game, hand-coded form) in WARDEN and THE FIVE — the whitepaper's contribution is generalizing it into a platform-wide, per-dimension, tunable primitive rather than re-deriving something new for its own sake.

### 3.2 Per-dimension definitions

| Dimension | Signal source | Notes |
|---|---|---|
| Reaction Time | Δt from a `stimulus`-class event to the paired response event | Genre-specific pairing rules, declared per plugin; transferable cross-game only in normalized/percentile form (§11) |
| Aim Accuracy | Hit/attempt ratio from combat events, where applicable | Not all genres have this axis — absent from the profile for genres without an aiming mechanic, not defaulted to 0 |
| Confidence (player's) | Composite: decision latency trending down + risk-taking trending up after early success, or the inverse after a loss streak | A second-order signal — computed from the *trend* of other dimensions within a match, not a single raw event type |
| Decision Quality | Proxy: was a chosen action followed by a favorable state-change within a bounded horizon (N ticks/events) | Hardest dimension to generalize well — genuinely needs a per-plugin Decision Adapter to define "favorable," since a good decision in a shooter and a good decision in a racing game don't share a common raw signal |
| Creativity | Action-sequence entropy *relative to the player's own historical baseline* — how often they do something Pattern Recognition would not have predicted from their own model | Deliberately self-referential, not measured against an absolute notion of "creative," which keeps it computable and game-agnostic |
| Aggression | Weighted rate of offense-initiating events vs. total events, normalized per genre | |
| Exploration | Rate of novel-state visitation (new areas, new item/ability trials) relative to available novelty | Recommend keeping this **per-game only** initially (§11) |
| Consistency | Inverse of variance across repeated instances of the same decision context | |
| Predictability | The *complement* of Pattern Recognition's own entropy measure (§5) — these two are two views of one underlying signal, not independently computed | |
| Learning Rate (the player's) | Second derivative — how quickly the player's *own* skill dimensions are trending upward over their match history | Meta, but directly computable from already-stored profile history |
| Risk Tolerance | Rate of high-danger-window actions (per an Influence-Map-style local danger signal, §1) relative to available safer options | |
| Preferred Strategies | Top-weighted entries from the same categorical-EWMA machinery used for Favorite Weapon/Ability (§3.3) | |
| Personality Archetype | **Derived, not measured** — a classification over the full dimension vector | See §3.3 |

### 3.3 Categorical dimensions (favorites, archetypes)

Favorites (weapon, ability, target-role, route) use the identical EWMA machinery as continuous dimensions, just over a frequency table per category rather than a scalar — "favorite" is simply `argmax` over that table, with the table's own entropy doubling as a confidence-like measure (a sharply peaked table = a real favorite; a flat table = no real preference yet, correctly reported as `favorite: 'none'`, exactly as the archived prototypes already did).

**Personality Archetypes** are a classification over the *entire* dimension vector, not a raw measurement. Two-phase recommendation:
1. **Now (deterministic):** simple rule-based bucketing — threshold conditions over 3–4 key dimensions (e.g., `aggression > 0.7 AND riskTolerance > 0.6 → "Brawler"`), transparent and hand-tunable, requires no training data, and is trivially explainable (§8) since the rule that fired *is* the explanation.
2. **Later (learned, once there's population data — §12.13):** unsupervised clustering (k-means or a Gaussian mixture model) over the dimension-vector space across the whole player population, discovering archetypes rather than hand-defining them — genuinely useful once there's enough data for the clusters to be meaningful, actively counterproductive to attempt on day one with a handful of players.

---

## 4. Memory System

Cognitive-science memory concepts, mapped to concrete engineering components — keeping only what's actually useful, discarding the rest rather than cargo-culting the full taxonomy.

| Cognitive concept | Useful for us? | Engineering component |
|---|---|---|
| Sensory/immediate buffer | Not as a separate structure | Implicitly served by the raw per-match event stream itself — no dedicated component needed |
| Working memory | **Yes** | The *current match's* live state: Strategy Planner's active Plan object + Decision Engine's per-tick context. Ephemeral, in-process, discarded (or promoted) at match end. Deliberately kept small (a handful of active "plan" facts) — both for cost and because a sprawling working-memory representation would make Explainability's job harder, not easier |
| Short-term memory | **Yes** | The current match's accumulated raw observations *before* they're folded into the persisted profile — i.e., the per-match observation log, promoted at `MatchEnded` |
| Long-term memory | **Yes — split into two** | See Semantic and Episodic below; "long-term memory" as a single undifferentiated bucket isn't precise enough to design against |
| Episodic memory | **Yes** | A **bounded, salience-gated** store of specific notable encounters (the Nemesis System pattern, §2) — top-K most significant events per player per game, not an unbounded log. Salience is scored (e.g., "this was a parry that ended a 3-match losing streak" scores higher than an ordinary hit), because unbounded episodic storage neither scales nor mirrors how episodic memory actually works for humans either — it's selective, not exhaustive |
| Semantic memory | **Yes** | The aggregated `PlayerProfile` dimensions themselves — generalized facts stripped of the specific episode that produced them. "Aggressive" is semantic; "rushed the healer in match #41" is episodic. Both are needed for good Explainability: episodic memory makes an explanation feel personal and credible, semantic memory is what actually drives Decision Engine behavior |
| Procedural memory | **Yes, but not about the player** | This is what *the AI itself* has learned about *how to act well* — e.g., tuned utility-consideration weights, if/when §12.15's ML upgrade path is taken. Explicitly a platform-level asset (could in principle improve every player's opponent from aggregate data), not part of any individual player's memory record — kept as a clearly separate category so it's never confused with personalization data |

**Net design:** four real per-player components (Working, Short-Term, Long-Term-Semantic, Long-Term-Episodic), plus a platform-level (not per-player) Procedural component reserved for a future ML upgrade. This maps directly onto the DB schema already specified (`playerProfiles` = semantic, `playerPatterns` = the discrete-pattern half of semantic, a new bounded `playerEpisodes` collection is needed — noted as a schema addition, see §"Schema Note" below).

---

## 5. Pattern Recognition

### 5.1 Detection approach by pattern type

| Pattern example | Detection method |
|---|---|
| Repeated movement, escape routes | Spatial clustering of movement vectors in a normalized local frame (relative to nearest threat) — look for statistically over-represented clusters vs. a uniform-random baseline |
| Ability timing, reload habits | Interval/sequence mining — track "N since last X" at every relevant event; a strongly peaked distribution in that counter (one value holding a disproportionate share of the mass) is the pattern |
| Weapon/ability/target preference | Frequency counting via the same categorical-EWMA machinery as §3.3 |
| Bait susceptibility | Requires the plugin to flag a `DecisionPoint` as a deliberate feint in its payload — correlate response rate against flagged feints specifically. Not derivable generically from the canonical schema alone; **this is the one pattern type on this list that needs explicit per-plugin event-schema cooperation**, flagged so it isn't assumed free |
| Risk windows | Correlate `PlayerDamaged`/`PlayerDied` events against a local danger signal (an Influence-Map-style field, §1) at the time of the event, to find *when* in an engagement the player is statistically most vulnerable |
| Decision latency | Direct measurement from `DecisionPoint` event timestamp deltas — same machinery as Reaction Time (§3.2) |

### 5.2 Trust model — how many observations, how confidence grows and decays

A **pattern** (a discrete, nameable habit) needs a different trust model than a **continuous dimension** (§3.1's EWMA), because a pattern isn't just "a number" — it's a *claim* ("this player reloads after two shots") that can be flatly wrong if premature.

**Promotion gate — a pattern becomes "trusted" (surfaced to Decision Engine/Explainability) only when both hold:**
1. **Minimum sample count** — a tunable floor per pattern type (roughly 8–10 for a fast-cycling pattern like reload timing, higher for a slower-cycling one), below which no claim is made at all.
2. **Statistical concentration** — the observed distribution must be meaningfully peaked relative to a uniform-random null hypothesis (a simple dominant-share-vs-uniform-baseline test, or a chi-squared-style check where warranted) — guards against promoting noise as if it were a real habit.

**Growth:** confidence follows the same `1 − e^(−n/k)` shape as continuous dimensions once past the promotion gate, `k` tuned per pattern type.

**Decay — deliberately asymmetric, growing slower than it shrinks:** if new observations start contradicting an established pattern, confidence should drop *faster* than it grew. Rationale, stated plainly: a player noticing and fixing their own habit is common and important to detect quickly — an AI that keeps "predicting" a habit the player has visibly already patched reads as dumb, not as smart, which actively undermines the "it really knows me" goal rather than serving it. This asymmetry is a deliberate design choice, not an oversight.

---

## 6. Decision-Making Architecture — Recommendation

**A three-layer hybrid**, directly informed by both §1's comparative study and §2's commercial precedent (most explicitly, Alien: Isolation's Director/Xenomorph split, which is close to a direct existence proof of this exact shape working at scale, shipped, under real player scrutiny).

```
Layer 1 — Strategy Planner   (multi-second/match cadence)
  Algorithm: GOAP-style forward search, bounded depth, over a small
  ABSTRACT action space ({pressure, regroup, flank, bait, defend, ...}) —
  never the game's full legal-action set. For simpler genres/plugins,
  a scored-priority list is sufficient and full GOAP would be pure
  overhead — the Planner's algorithm is plugin-tunable; its INTERFACE
  (produces an abstract Plan/Intent object) is fixed platform-wide.

Layer 2 — Decision Engine     (every tick / every decision point)
  Algorithm: Utility AI. Score every currently-legal action (from the
  plugin's getLegalActions()) against a fixed set of considerations —
  current Plan/Intent, Player Profile dimensions, active Personality
  weights, immediate tactical state. Highest (or weighted-random) score
  wins, submitted through the SDK's decision channel.

Layer 3 — (plugin-local, out of platform scope)
  A plugin's OWN ambient NPCs, if any, use whatever the vendored game
  already uses (often a Behavior Tree). Not the adaptive opponent, not
  inside the fairness boundary, not our concern to standardize.
```

**Explicitly rejected as the core layer(s):** pure FSM/HFSM (doesn't scale across multi-genre plugins), pure GOAP at tick rate (too expensive for real-time genres — remains available as a Strategy Planner *option*, not the tick-rate layer), a plain rule engine (brittle, doesn't blend multiple concerns gracefully, resists the Personality requirement).

**Why split Planner from Engine at all, computationally:** the Planner's search cost is real but bounded and *rare* (multi-second cadence, small abstract action space). The Engine's cost is `O(actions × considerations)` per tick — small, constant, real-time-safe. Collapsing the two into one layer would force a choice between an unaffordable per-tick search or a Planner too coarse to be tactically responsive. The split isn't just architecturally clean, it's computationally load-bearing.

---

## 7. Difficulty — Never Cheating, Only Revealing

**Restated constraint:** difficulty must never touch a game's numeric stats (HP, damage, speed) as a function of player skill. All adaptation happens through *which legal action gets chosen and when*, inside the exact same action space and rules a human-equivalent opponent would have. This is a direct consequence of the SDK's fairness boundary (`PLATFORM_V2_DESIGN.md` §3.3) — there is structurally no other channel available to cheat through even if we wanted to.

**Mechanism — the Awareness Budget.** A scalar, 0–1, per match, gating how much of the Player Profile/Pattern Recognition/Strategy Planner's read the Decision Engine is *permitted* to act on:

- At `0`: the Decision Engine ignores the learned read entirely, falling back to a competent-but-generic baseline that only reacts to Working Memory (what's happening right now, no predictive edge).
- At `1`: full use of every high-confidence pattern and profile dimension available.
- **Rises with the player's own accumulated history against this opponent** — the direct platform-wide generalization of WARDEN's `depth` mechanic (§3.1), which already proved out in the archived prototypes that this scaling *feels* fair in practice, not just in theory.
- **Starts low for new players as a deliberate floor**, independent of and in addition to naturally-low confidence — a brand-new player shouldn't feel "read" on match one even in the unlucky case where an early pattern happens to look confident by chance.
- **Should be player-visible** (feeds the Player Dashboard) — consistent with the transparency principle running through this entire platform: the AI calibrating is itself something worth surfacing, not hiding.

**What "fair-feeling" requires beyond the mechanism itself:** the Awareness Budget should only ever change *which* choice the AI makes, never make it faster, tankier, or higher-damage. A well-tuned implementation should feel like "an opponent starting to know your tricks," and the legibility of *why* it got harder (via Explainability, §8) is what separates that feeling from "the game just got harder" — the qualitative difference between adapting through knowledge and adapting through an unfair advantage is almost entirely carried by whether the player can be told the real reason.

**Beginner vs. expert experience, concretely:** a new player faces a low Awareness Budget *and* low profile confidence simultaneously — a fair, learnable, close-to-generic baseline opponent. A veteran with dozens of matches faces a high Awareness Budget acting on high-confidence patterns, personality-flavored, and explainable — the payoff the whole platform is built to deliver.

---

## 8. Explainability

**Design principle, stated as a hard constraint, not a preference:** explanations must be a deterministic *readout* of the actual decision trace, never a separate post-hoc "explain yourself" generative step run after the fact. This matters because post-hoc explanation generation (asking a separate model to produce a plausible-sounding reason after a decision was already made) has a well-documented failure mode in the broader explainable-AI field: **confabulation** — an explanation that sounds right without being causally connected to what actually happened. For a platform whose entire differentiator is "prove to the player this is real, not scripted," a confabulated explanation isn't a minor bug, it's an existential credibility risk.

**Why the architecture chosen in §6 makes this tractable rather than merely aspirational:** because the Decision Engine is Utility AI, every decision is *already* a decomposable weighted sum of named considerations — the explanation is close to a templated readout of "which consideration(s) dominated this specific choice," filled with the real numbers and the real Pattern/Profile entries that fed them. This is a direct, load-bearing consequence of rejecting a black-box policy (e.g., a learned neural decision-maker) as the core Decision Engine algorithm — see §12.14's restatement of exactly this tradeoff.

**Two tiers:**
1. **Pattern-level** — "I noticed you always dodge left." Near-direct readout of a trusted Pattern Recognition entry (§5), minimal templating required.
2. **Decision-level** — "I predicted your movement because you rushed weakened enemies four times in a row." Requires the specific Decision trace (which considerations dominated *this* choice) joined against the Pattern/Profile entries that fed those considerations — the genuinely valuable, harder case, and specifically why the `decisions` collection (`PLATFORM_V2_DESIGN.md` §6) keeps a `planSnapshot` — the causal chain from "what it knew" → "what it decided" → "what it says" must be traceable end-to-end through real stored state, every time, with no gap a generative model could paper over.

---

## 9. Personality

**Definition:** a named preset of Utility AI consideration *weights* (and optionally which considerations are active at all), applied uniformly on top of whatever the Player Profile and Strategy Planner have genuinely learned. Same facts, different scoring, different resulting action — directly modeled on Civilization's leader-flavor precedent (§2).

| Archetype | Weighting bias |
|---|---|
| **Aggressive** | Punish/pressure considerations weighted high; safety/patience low — acts on an opening immediately |
| **Patient** | Safety/positioning weighted high; punish-now low — waits for a higher-confidence opening on the *same* underlying read |
| **Hunter** | Target-tracking/pursuit weighted high; area-control low |
| **Defensive** | Mitigation/safety weighted high; opportunistic-punish low |
| **Psychological** | Uniquely, weights considerations tied to the *player's own* Panic Threshold / Confidence dimensions (§3.2) high — targets temperament, not mechanical openings; leans on baiting and feints specifically |
| **Tactical** | Plan-adherence (staying on the Strategy Planner's current multi-step Plan) weighted high; reactive/opportunistic considerations low — distinct from Patient, which is about safety, not plan discipline |
| **Experimental** | Adds a controlled exploration term (epsilon-greedy-style) on top of the normal weighted scores — deliberately tries lower-scored actions some fraction of the time |

**Experimental is worth calling out beyond just being a selectable flavor.** An AI that always takes the highest-utility action given what it knows becomes *itself* fully predictable once a player learns to read the AI's own tendencies — a real failure mode symmetric to the one we're building the whole platform to exploit in the *player*. A controlled exploration term isn't just a personality flavor, it's a structural hedge against the AI ossifying into a new, different, but equally exploitable pattern of its own — worth treating as a standing recommendation for the Decision Engine broadly (a small epsilon baseline even on "serious" personalities), not just as one option among several.

---

## 10. Learning Strategy — When Should Learning Happen

Not a single cadence — a **multi-cadence model**, matching the multi-layer decision architecture already established:

| Cadence | What updates at this cadence | Why |
|---|---|---|
| Every event | Working Memory only (in-process, ephemeral) | Free — no persistence cost, discarded/promoted at match end |
| Every decision point / encounter | Pattern Recognition candidate counters (in-memory accumulation) | Cheap counters, not yet persisted |
| **Every match** | **Player Profile persistence + Pattern promotion/demotion** | Matches the archived prototypes' own proven `saveMem()`-at-`end()` pattern, matches Forza Drivatar's real-world precedent (even cloud ML there resolves per-session, not per-input), and is the natural point a "did this pattern hold up" judgment can actually be made |
| Daily | Cross-game rollup aggregation (§11), Long-term episodic-memory pruning, dormant-dimension confidence decay sweeps | Doesn't need to happen synchronously with any single match; batching keeps it cheap and simple |
| Continuously (streaming/per-frame persistence) | **Not recommended anywhere in this design** | "Continuous learning" in the felt sense is achieved by the *accumulation* of frequent match-end updates, not literal per-frame weight writes — no cited precedent does this either, and it would be pure cost with no player-facing benefit |

**Operational bonus of the per-match cadence specifically:** it's naturally rate-limited by match count, not by how fast a game loop runs — which matters both for database cost and for abuse-resistance (a malicious or buggy client can't cheaply force thousands of profile-mutating writes per second, since a write only happens once per completed match, gated server-side at `MatchEnded`).

---

## 11. Cross-Game Intelligence — What Transfers

**Checkable rule, stated once so it doesn't become a case-by-case judgment call for every new plugin:** a dimension is eligible for cross-game promotion **only if it can be defined purely in terms of the canonical event schema**, independent of any specific plugin's payload semantics. If defining it requires reaching into a specific plugin's specific payload fields, it stays per-game by construction.

| Transfers well | Stays game-specific |
|---|---|
| **Reaction Time** — real psychomotor trait; transfer the normalized/percentile form, not raw ms (raw scales differ wildly by genre) | **Favorite Weapon/Ability** — vocabulary is inherently game-specific |
| **Risk Tolerance** — real temperament trait; transfer the abstract score, let each plugin's Decision Adapter interpret what "acting on high risk tolerance" concretely means in its own action space | **Named Patterns** (§5) — "reloads after 2 shots" only means something in a game with reload mechanics; only the *abstract dimensions they feed* are shared, never the pattern itself |
| **Aggression** — same treatment as Risk Tolerance | **Escape Routes / spatial patterns** — tied to specific maps/movement systems |
| **Decision Speed** — transfers well, distinct from raw Reaction Time (this is "which option, how fast," not "motor response, how fast") | **Preferred Combat Distance** — transfers *only* between plugins that both declare support for a shared distance axis in their manifest; not assumed universal (meaningless for a genre without one) |
| **Mechanical Skill** — coarse/generalized version transfers; fine-grained sub-skills (aim vs. timing vs. precision-movement) stay per-game | **Exploration** — ambiguous enough (temperament trait vs. genre-specific map behavior) to keep per-game until validated against 2+ real plugins |
| **Strategic Thinking** — arguably the *most* transferable trait, being about decision quality over a plan horizon, already fairly abstract | |

---

## 12. Technical Recommendation — Summary

1. **Architecture:** three-layer hybrid — GOAP-capable Strategy Planner (slow cadence, abstract action space) → Utility AI Decision Engine (tick cadence, real legal actions) → plugin-local behavior for non-adaptive NPCs (out of platform scope). Directly modeled on Alien: Isolation's Director/Xenomorph split.
2. **Algorithms:** EWMA for continuous-dimension updates; count-based asymptotic confidence (`1 − e^(−n/k)`); weighted linear-combination utility scoring; bounded-depth forward-search GOAP where the Planner needs it.
3. **Data structures:** `ProfileDimension {value, confidence, samples, lastUpdated}`; `Pattern {id, description, confidence, occurrences, distributionHistogram}`; a salience-ranked bounded episodic store (top-K, not unbounded); a `Decision` trace record capturing winning considerations + plan snapshot.
4. **Memory models:** four per-player components (Working / Short-Term / Long-Term-Semantic / Long-Term-Episodic) plus a platform-level (not per-player) Procedural component reserved for the future ML upgrade path.
5. **Confidence models:** shared EWMA+asymptotic-confidence primitive for continuous dimensions; a separate, faster-decaying model specifically for discrete Patterns, since "the player fixed their habit" must be detected quickly, not sluggishly re-weighted.
6. **Pattern detection:** frequency/histogram peak detection against a uniform-random null hypothesis, gated by a minimum sample count *and* a concentration threshold before promotion to "trusted."
7. **Decision architecture:** Utility AI at the tick layer — restated as the single most load-bearing choice in this document, since it's also what makes §8's Explainability tractable at all.
8. **Difficulty calibration:** the Awareness Budget — gates how much of what the AI *knows* it's permitted to *act on*, never gates the game's own numeric stats.
9. **Explainability model:** deterministic template-fill sourced directly from the stored Decision trace — never a post-hoc generative explanation step, to structurally avoid confabulation.
10. **Personality model:** named Utility AI weight-vector presets over identical underlying knowledge, plus a standing recommendation for a small exploration term even outside the dedicated "Experimental" archetype, as a hedge against the AI itself becoming predictable.
11. **Computational complexity:** Decision Engine is `O(actions × considerations)` per tick — small, constant, real-time-safe. Strategy Planner's GOAP mode is the only super-linear cost, and it's both bounded (small abstract action space, shallow search depth) and rare (multi-second cadence) by design — this is why the two-layer split is a computational necessity, not just an architectural preference.
12. **Scalability:** profile updates are O(1) per match per dimension — EWMA is a constant-time update, never a recompute-from-full-history operation. This is what makes "learns over days, weeks, months, years" actually affordable rather than a slow-motion cost problem — per-player cost does not grow as their history grows.
13. **Future ML opportunities:** (a) learned utility-consideration weights trained from aggregate outcome data, directly analogous to Forza's own Bayesian→deep-learning evolution; (b) learned pattern-detectors capable of finding non-obvious sequences a human wouldn't think to hand-code; (c) population-level clustering (k-means/GMM) for genuine archetype discovery once enough population data exists, replacing the hand-defined rule-based buckets in §3.3.
14. **What stays deterministic:** the Decision Engine's scoring/selection math, the SDK fairness boundary, confidence math, pattern-promotion thresholds, the Awareness Budget mechanism, and — non-negotiably — the entire Explainability pathway.
15. **What could become ML-powered:** only the *numbers* the deterministic machinery consumes — consideration weights, pattern-significance thresholds, personality presets, archetype boundaries. ML tunes the inputs to a structured system; it does not replace the structure. This is the chess-engine precedent (§2) applied platform-wide, and it is the single organizing principle this whole whitepaper resolves to: **learn the numbers, keep the machine.**

---

## Schema Note (flagged for `PLATFORM_V2_DESIGN.md` §6 when implementation begins)

One addition surfaced by this research that the prior DB schema didn't yet have a home for: a bounded **`playerEpisodes`** collection (salience-ranked, top-K per player per game) to back the Episodic Memory component (§4) — distinct from both `gameplayEvents` (raw, unbounded, everything) and `playerPatterns` (semantic, aggregated, no specific-encounter detail). Not designed in full here since this document is AI-design research, not a schema revision — noted so it isn't lost before implementation starts.

---

No implementation begins until this is reviewed and approved, per your instruction.
