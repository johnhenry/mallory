<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# Can wang tiles be applied to functional programming?

Yes. Wang tiles fit functional programming particularly well as a **local constraint system**: each tile is immutable data, edge matching is a pure predicate, and generating a valid tiling is a search or constraint-propagation computation.

A Wang tile is a non-rotated square with labels on four edges; adjacent edges must carry matching labels. The formalism is computationally expressive—there is published work relating Wang tiles to SKI combinators and showing combinatory programs represented as tile grids.[^1_1]

## Functional interpretation

Represent a tile as a value:

```ts
type Edge = string

type Tile = Readonly<{
  north: Edge
  east: Edge
  south: Edge
  west: Edge
  payload: string
}>
```

Compatibility is a pure function:

```ts
const fitsRightOf = (left: Tile, right: Tile): boolean =>
  left.east === right.west

const fitsBelow = (top: Tile, bottom: Tile): boolean =>
  top.south === bottom.north
```

Then “place a tile” does not mutate a board. It returns a new board or a lazy stream of possible boards:

```ts
type Grid = ReadonlyArray<ReadonlyArray<Tile>>

const candidatesAt = (
  tiles: readonly Tile[],
  grid: Grid,
  x: number,
  y: number,
): Tile[] =>
  tiles.filter(tile => {
    const left = grid[y]?.[x - 1]
    const top = grid[y - 1]?.[x]

    return (!left || fitsRightOf(left, tile)) &&
           (!top || fitsBelow(top, tile))
  })
```

This naturally supports referential transparency, backtracking, memoization, and property-based tests.

## Where it is useful

| Use | Functional-programming framing |
| :-- | :-- |
| Procedural maps, textures, and dungeons | A pure generator maps a seed and tile grammar to a valid grid |
| Constraint satisfaction | Tile edges are variables/domains; matching rules are binary constraints |
| Parsing and composition | Each tile exposes an interface on each edge, like typed ports |
| Cellular or spatial computation | A row can represent state at time $t$, and the next row is derived through local rules |
| Effect-system / capability modeling | Edge labels can encode allowed resources, state transitions, or protocol compatibility |
| Visual DSLs | Compose local components declaratively while making invalid adjacency unrepresentable |

Wang tilings are commonly treated as a constraint-satisfaction problem, including formulations using graph methods and integer programming.[^1_2][^1_3]

## A practical FP pattern

The most useful pattern is to treat each tile as a **locally typed component**:

```ts
type ProtocolTile<I, O, S> = Readonly<{
  west: I       // required input from left
  north: S      // state required from above
  east: O       // output offered to right
  south: S      // state emitted below
  run: (input: I) => O
}>
```

Conceptually:

- horizontal edges represent values or interfaces flowing through a pipeline;
- vertical edges represent state, phase, or temporal progression;
- valid tiling proves local composability;
- a completed grid describes a globally compatible program or dataflow network.

This is related in spirit to arrows, string diagrams, session types, and finite-state transducers. However, Wang tiles alone are not automatically a pleasant general-purpose FP language: finding a tiling can become expensive, and unrestricted tiling questions can be undecidable. Their strength is **declarative local composition**, not ordinary application-level control flow.

## Recommendation

For a TypeScript game/tooling project, use Wang tiles when you want deterministic, seedable generation with strict adjacency rules. Keep the core as:

1. Immutable tile definitions.
2. Pure compatibility predicates.
3. A solver expressed as lazy backtracking or a nondeterministic `Array`-style computation.
4. A separate effectful shell for rendering, I/O, persistence, and randomness.

That separation gives you a clean “functional core, imperative shell” architecture while retaining the visual and compositional strengths of Wang tiles.
<span style="display:none">[^1_10][^1_11][^1_12][^1_13][^1_14][^1_4][^1_5][^1_6][^1_7][^1_8][^1_9]</span>

<div align="center">⁂</div>

[^1_1]: https://ceur-ws.org/Vol-1032/paper-01.pdf

[^1_2]: https://www.nature.com/articles/s41598-023-31786-3

[^1_3]: https://pmc.ncbi.nlm.nih.gov/articles/PMC10039085/

[^1_4]: https://resources.wolframcloud.com/FunctionRepository/resources/GenerateWangTiling/

[^1_5]: https://en.wikipedia.org/wiki/Wang_tile

[^1_6]: https://ir.canterbury.ac.nz/items/9d2f94eb-705c-43ef-8fda-e9c618f21c3e

[^1_7]: https://www.youtube.com/watch?v=34qjSyDc-8s

[^1_8]: https://because0fbeauty.wordpress.com/2014/02/28/wang-tiles-1/

[^1_9]: https://www.advancesincombinatorics.com/article/18614-an-aperiodic-set-of-11-wang-tiles

[^1_10]: https://www.reddit.com/r/math/comments/k667tt/wang_tiles_and_the_halting_problem/

[^1_11]: https://grahamshawcross.com/2012/10/12/wang-tiles-and-aperiodic-tiling/

[^1_12]: https://community.wolfram.com/groups/-/m/t/2553885

[^1_13]: https://codegolf.stackexchange.com/questions/35704/fill-the-screen-with-wang-tiles

[^1_14]: https://mathoverflow.net/questions/149565/reference-for-wang-tile


---

# Can a functions signature, output be analogous to a tile?

Yes—**a function’s type signature can be modeled as a tile interface**, with its inputs and output placed on labeled edges. Two tiles compose only when their adjoining edge types match, just as ordinary function composition requires the first function’s result type to equal the next function’s input type.[^2_1][^2_2]

## The basic mapping

For a unary pure function:

```ts
f: A -> B
```

model it as a horizontal tile:

```text
west/input        east/output
     A   [  f  ]      B
```

Then:

```ts
g: B -> C
```

can sit to its right:

```text
A  [ f ]  B  [ g ]  C
```

because the shared interface is `B`. The combined tile represents:

```ts
g ∘ f: A -> C
```

That directly mirrors the categorical rule that arrows $A \to B$ and $B \to C$ compose into $A \to C$.[^2_2][^2_1]

## Why four edges help

A signature alone is usually one-dimensional—inputs on one side, result on the other. A Wang tile becomes more interesting when you use the other axis to encode context:

```text
                north: required context / state / effect
                              E_in
                                │
input A ──────────────── [ f ] ──────────────── output B
                                │
                south: produced context / state / effect
                              E_out
```

For example, with a stateful computation:

```ts
f: (User, AuthContext) -> [Profile, AuthContext]
```

you could use:

```text
west  = User
north = Authenticated
east  = Profile
south = Authenticated
```

Or with an effect-tracking formulation:

```ts
readConfig: Unit -> Effect<Config, FsRead>
parseConfig: Config -> Effect<AppConfig, ParseError>
```

The east/west edges carry data types, while north/south can carry effect, capability, resource, protocol, or state-transition constraints.

## Important distinction

The **tile is not necessarily the function itself**. More precisely:

- The function implementation is the behavior *inside* the tile.
- The edge labels are its externally visible contract.
- A valid adjacency is a static statement that contracts compose.
- A fully tiled region is a network of locally compatible computations.

Wang tiles normally match edges by equality of labels; real type systems often use richer compatibility rules:

```ts
type Compatible<Produced, Required> =
  Produced extends Required ? true : false
```

That allows subtyping, variance, generics, row-polymorphic effects, protocol refinement, or schema compatibility instead of only exact equality.

## Multiple arguments and outputs

You have several reasonable encodings:


| Function shape | Tile encoding |
| :-- | :-- |
| `A -> B` | West `A`, east `B` |
| `(A, B) -> C` | West `A × B`, east `C` |
| `A -> [B, C]` | West `A`, east `B × C` |
| `A -> Promise<B>` | West `A`, east `Promise<B>` |
| `(A, State<S>) -> [B, State<S>]` | West/east data; north/south state |
| `A -> Result<B, E>` | West `A`, east `Result<B, E>`—or split success/error into distinct directional ports |

For true multi-port functions, a strict four-sided Wang tile may be too restrictive. You can encode products/records on an edge, or move to a more general **port graph** / string-diagram model where nodes can have arbitrary typed input and output ports.

## A TypeScript sketch

```ts
type Tile<I, O, N = unknown, S = unknown> = Readonly<{
  name: string
  west: I
  north: N
  east: O
  south: S
  run: (input: I) => O
}>

const parse: Tile<string, URL, "raw", "parsed"> = {
  name: "parseUrl",
  west: "" as string,
  north: "raw",
  east: new URL("https://example.com"),
  south: "parsed",
  run: source => new URL(source),
}

const fetch: Tile<URL, Response, "parsed", "fetched"> = {
  name: "fetch",
  west: new URL("https://example.com"),
  north: "parsed",
  east: new Response(),
  south: "fetched",
  run: url => fetch(url),
}
```

Conceptually, `parse` can be adjacent to `fetch` when both match:

```ts
parse.east  ~ fetch.west   // URL
parse.south ~ fetch.north  // "parsed"
```

So you get two independent composition constraints: dataflow and phase/state flow.

## The key caveat

A simple signature $A \to B$ captures only a **linear pipeline**. Wang-style tiling adds value when you need two-dimensional local constraints—such as a grid of game-system rules, staged compiler passes, distributed protocol states, or a visual agent/workflow DSL.

For regular functional composition, ordinary typed arrows and category/string diagrams are usually simpler. For a system where local compatibility must hold in both data and contextual dimensions, “a typed function as a tile” is a strong and productive abstraction.
<span style="display:none">[^2_10][^2_11][^2_12][^2_13][^2_14][^2_15][^2_3][^2_4][^2_5][^2_6][^2_7][^2_8][^2_9]</span>

<div align="center">⁂</div>

[^2_1]: https://bartoszmilewski.com/2014/11/04/category-the-essence-of-composition/

[^2_2]: https://abuseofnotation.github.io/category-theory-illustrated/print/

[^2_3]: https://arxiv.org/pdf/1506.06492.pdf

[^2_4]: https://www.santafe.edu/research/results/working-papers/tiling-groups-for-wang-tiles

[^2_5]: https://blog.demofox.org/2016/03/14/computation-with-wang-tile/

[^2_6]: https://www.rea-group.com/about-us/news-and-insights/blog/how-we-used-category-theory-to-solve-a-problem-in-java/

[^2_7]: https://www.labri.fr/perso/slabbe/docs/0.6/wang_tiles.html

[^2_8]: https://github.com/nst/WangTilesTuringMachines

[^2_9]: http://www.boristhebrave.com/permanent/24/06/cr31/stagecast/wang/intro.html

[^2_10]: https://blog.ngzhian.com/category-theory.html

[^2_11]: https://daicelabs.com/research/category-theory

[^2_12]: https://www.youtube.com/watch?v=JMP6gI5mLHc

[^2_13]: https://math.stackexchange.com/questions/1958695/model-theory-what-is-the-signature-of-category-theory

[^2_14]: https://pmc.ncbi.nlm.nih.gov/articles/PMC10039085/

[^2_15]: https://resources.wolframcloud.com/FunctionRepository/resources/GenerateWangTiling/


---

# Now that I look at this, is this only a tiling in one dimension?

Yes. In the simplest mapping—`A -> B` as a tile with `A` on the west edge and `B` on the east—you have only a **one-dimensional tiling**: a typed composition chain.

```text
A ──[ f: A -> B ]── B ──[ g: B -> C ]── C ──[ h: C -> D ]── D
```

Each neighboring pair shares one compatibility constraint: the output type on the left must match the input type on the right. That is ordinary function composition, $g \circ f : A \to C$.[^3_1]

## What makes it 1D

Even if you draw each function as a square, its north and south edges are unused or have a single universal label:

```text
        *
A ──[ f ]── B
        *
```

So the grid has no meaningful vertical relation. You can stack tiles, but the stack carries no additional semantics; it is just visual layout.

A genuine Wang tiling has constraints in both axes: each tile has north, south, east, and west labels, and every shared edge must match.[^3_2][^3_3]

## Making it genuinely 2D

You need another *independent composition dimension*. A promising encoding is:

```text
                  required state / capability
                            N
                            │
data input W ──────── [ function ] ──────── E data output
                            │
                  resulting state / capability
                            S
```

For example:

```text
                 session: Anonymous
                         │
Request ──[ authenticate ]── AuthenticatedRequest
                         │
              session: Authenticated
```

Then the two axes mean different things:


| Direction | Meaning | Constraint |
| :-- | :-- | :-- |
| West → east | Dataflow | Produced type must satisfy the next function’s required input |
| North → south | Context/state flow | A function’s resulting state must satisfy the function below’s required state |

Now a $2 \times 2$ arrangement can be meaningful:

```text
             User ──[ validate ]── ValidUser
              │                       │
          Anonymous               Anonymous
              │                       │
          [ login ]              [ createSession ]
              │                       │
        Authenticated           Authenticated
```

Each horizontal relationship validates data compatibility; each vertical relationship validates session-state compatibility. It is a genuine local 2D constraint grid rather than a pipeline written over multiple rows.

## But be careful

Your first formulation—“signature input/output equals a tile”—maps most directly to a **directed wire segment with one operation**, better expressed using a dataflow graph or string diagram:

```text
A ── f ── B ── g ── C
```

Functions also branch, merge, and take multiple arguments:

```text
A ──┐
    ├── combine ── C
B ──┘
```

A normal Wang grid does not represent that topology naturally. You can encode a tuple `(A, B)` on an edge, but that hides the separate wires. If branching and arbitrary connectivity are central, use typed port graphs, hypergraphs, arrows, or string diagrams—not square tiles.

## Where Wang tiles add value

They become compelling if your computation is intrinsically a lattice:

- A cellular simulation: east/west transfer values; north/south advance time.
- A compiler/dataflow grid: horizontal edges carry values; vertical edges carry scope, phase, ownership, or effects.
- A game-world rule grid: tiles represent locally valid combinations of terrain, biome state, resources, and simulation rules.
- A spatial agent system: horizontal edges encode messages, vertical edges encode state transitions or authority/capabilities.

So: **yes, your current model is a 1D tiling.** It becomes a true 2D Wang-style model only once north/south express a second, composable contract that matters independently of input/output.
<span style="display:none">[^3_10][^3_11][^3_12][^3_13][^3_14][^3_15][^3_4][^3_5][^3_6][^3_7][^3_8][^3_9]</span>

<div align="center">⁂</div>

[^3_1]: https://pmc.ncbi.nlm.nih.gov/articles/PMC9716143/

[^3_2]: https://pmc.ncbi.nlm.nih.gov/articles/PMC10039085/

[^3_3]: https://www.dim.uchile.cl/~rapaport/wang.pdf

[^3_4]: https://en.wikipedia.org/wiki/Function_composition

[^3_5]: https://sites.math.rutgers.edu/~weibel/archive/papers-dir/infty.pdf

[^3_6]: https://www.youtube.com/watch?v=6y510oZ0m7o

[^3_7]: https://www.pingofilm.com/blog/wang

[^3_8]: https://scholar.rose-hulman.edu/cgi/viewcontent.cgi?article=1604\&context=rhumj

[^3_9]: https://golem.ph.utexas.edu/category/2010/03/a_perspective_on_higher_catego.html

[^3_10]: https://emilyriehl.github.io/files/elements-colloquium.pdf

[^3_11]: https://mathoverflow.net/questions/68339/motivating-the-category-of-chain-complexes

[^3_12]: https://math.stackexchange.com/questions/1896915/function-composition-vs-single-function

[^3_13]: https://en.wikipedia.org/wiki/Wang_tile

[^3_14]: http://www.boristhebrave.com/permanent/24/06/cr31/stagecast/wang/intro.html

[^3_15]: https://www.youtube.com/watch?v=34qjSyDc-8s


---

# Does this map to agentic workflows?

Yes—very naturally. Your “typed function as a tile” can become an **agent step with a contract**, while a valid tiling represents a locally compatible agent workflow. Existing agent-workflow systems already use a related graph model: agents/actions are nodes, transitions are edges, and a shared state is carried and updated across the workflow.[^4_1][^4_2]

## Tile-to-agent mapping

```text
                    Preconditions / authority / budget
                                  north
                                    │
Input artifact ────────────── [ agent ] ────────────── Output artifact
                                    │
                    Updated state / next obligations
                                  south
```

| Tile element | Agent-workflow meaning |
| :-- | :-- |
| West edge | Required input artifact or message schema |
| East edge | Produced artifact/message schema |
| North edge | Preconditions: identity, capabilities, policy, budget, workflow phase, required context |
| South edge | Postconditions: state patch, evidence, remaining work, emitted events, updated authority |
| Tile body | Agent invocation, prompt, tool set, model policy, deterministic function, or human-review step |
| Neighboring edge match | A safe handoff: producer output satisfies consumer requirements |

For example:

```text
TaskSpec ──[ Planner ]── Plan
               │
          phase: intake
               │
         phase: planned
```

A `Planner` tile may be allowed only when the work item is in `intake`; it produces a `Plan` and advances the state to `planned`.

A `Coder` tile can then be placed only if both dimensions fit:

```text
Plan ──[ Coder ]── Patch
            │
     phase: planned
            │
     phase: implemented
```

The shared boundaries enforce:

```ts
Planner.output === Coder.input      // Plan
Planner.stateOut === Coder.stateIn  // "planned"
```


## The key improvement: contracts, not just types

For agent workflows, plain TypeScript types are too weak. An LLM can return something structurally shaped like a `Plan` that is incomplete, unsafe, unsupported by evidence, or exceeds authorization.

Use a richer edge contract:

```ts
type Contract<T> = Readonly<{
  schema: ZodType<T>
  provenance: "user" | "retrieved" | "tool" | "agent"
  requiredCapabilities: readonly string[]
  requiredEvidence?: readonly string[]
  budget?: { maxUsd?: number; maxSteps?: number }
  policy?: "internal" | "approved-for-write"
}>

type AgentTile<I, O, StateIn, StateOut> = Readonly<{
  input: Contract<I>       // west
  output: Contract<O>      // east
  precondition: Contract<StateIn>  // north
  postcondition: Contract<StateOut> // south
  execute: (input: I, state: StateIn) => Promise<{
    output: O
    state: StateOut
    evidence: readonly Evidence[]
  }>
}>
```

A shared edge matches only if:

1. The output schema conforms to the next agent’s input schema.
2. Provenance meets the downstream trust requirement.
3. Capability and policy constraints are satisfied.
4. The emitted state patch establishes the next agent’s precondition.
5. Required validations/evidence are present.

That is much closer to the actual operational needs of a multi-agent system.

## Where the 2D model is valuable

A directed graph remains the best **execution representation** because agent systems branch, loop, fan out, join, retry, wait for humans, and call external tools. Graph-based systems explicitly model nodes, fixed/conditional edges, and persistent state; cycles support iterative work.[^4_2][^4_3]

The tiling model adds value as a **static composition and validation layer** above that graph:

- **Horizontal:** artifact/dataflow compatibility—task → plan → patch → test report.
- **Vertical:** lifecycle/authority compatibility—draft → reviewed → approved → applied.
- **Tile placement:** which agents may run in which phase under which capability/budget/policy conditions.
- **Region validity:** every handoff is contractually valid, even when execution routes dynamically.
- **Synthesis:** choose or search for a set of agents that can bridge a required input/state boundary to a target output/state boundary.

For your repo-as-hive-mind direction, this maps neatly to a control-plane / worker-plane split:

```text
Control plane: selects tiles, proves/records allowed adjacency, tracks budgets and approvals.
Worker plane: executes the selected agent/tool tile and returns a validated artifact plus state patch.
```

A tile need not be an LLM agent. Indexing, embedding, compilation, tests, policy checks, GitHub issue fetches, MCP tools, and human approval are all first-class tiles. Treating deterministic validators as tiles is especially useful because they can guard the less reliable generative steps.

## Recommended shape

Use a **typed directed multigraph with tile-like ports**, rather than forcing the runtime into a rectangular Wang grid.

- Make each node an `AgentTile<I, O, StateIn, StateOut>`.
- Represent data and state as separately typed ports.
- Make every transition an explicit, validated contract adapter.
- Allow graph topology for fan-out, joins, retries, and supervisor loops.
- Apply the Wang-tile idea to validate local adjacency and, optionally, to synthesize valid sub-workflows from declarative contracts.

So the answer is: the model maps well to agentic workflows, but **Wang tiling should be your composition metaphor and validation/synthesis calculus—not necessarily your workflow runtime data structure.**
<span style="display:none">[^4_10][^4_11][^4_12][^4_13][^4_14][^4_15][^4_16][^4_17][^4_4][^4_5][^4_6][^4_7][^4_8][^4_9]</span>

<div align="center">⁂</div>

[^4_1]: https://aws.amazon.com/blogs/machine-learning/build-a-multi-agent-system-with-langgraph-and-mistral-on-aws/

[^4_2]: https://docs.langchain.com/oss/python/langgraph/graph-api

[^4_3]: https://www.ibm.com/think/tutorials/build-agentic-workflows-langgraph-granite

[^4_4]: https://www.langchain.com/blog/langgraph-multi-agent-workflows

[^4_5]: https://www.dataiku.com/blog/agent-orchestration-explained

[^4_6]: https://www.talkdesk.com/blog/multi-agent-orchestration/

[^4_7]: https://realpython.com/langgraph-python/

[^4_8]: https://www.linkedin.com/pulse/state-graphs-agent-workflows-dattaraj-rao-d6l3f

[^4_9]: https://redwerk.com/blog/best-multi-agent-ai-frameworks/

[^4_10]: https://dylancastillo.co/posts/agentic-workflows-langgraph.html

[^4_11]: https://dev.to/sreeni5018/langgraph-uncovered-building-stateful-multi-agent-applications-with-llms-part-i-p86

[^4_12]: https://www.workflowbuilder.io/blog/agentic-workflow-patterns

[^4_13]: https://www.youtube.com/watch?v=95XrWA6-UFM

[^4_14]: https://www.kimi.com/resources/agent-orchestration-platforms

[^4_15]: https://www.reddit.com/r/AI_Agents/comments/1nw0r1s/orchestrator_for_multiagent_ai_workflows/

[^4_16]: projects.ai_agents.github_actions_orchestration

[^4_17]: projects.web.llm_webpage_integration


---

# Can you draw about using a canvas or artifact?


---

# That image confuses me… I don’t understand how the tiles fit together? Do they fit together? I don’t see the colors match up without reflection/rotation— are we saying that’s allowed here?

You’re right to question it—the diagram was misleading. **No: standard Wang tiles do not rotate or reflect.** Each tile has a fixed north, east, south, and west orientation; a valid placement requires the *two labels on the one shared boundary* to match exactly. [^6_1][^6_2]

And, more importantly: the four example tiles I drew **did not form a valid $2 \times 2$ Wang tiling**. I mixed up “a workflow diagram laid out in a grid” with “a grid of mutually matching tiles.”

## What must match

For tiles laid out as:

```text
A | B
--+--
C | D
```

the required equalities are:

```text
A.east  = B.west
A.south = C.north
B.south = D.north
C.east  = D.west
```

No rotation. No reflection. No “green output somehow matches blue input” unless the *semantic label is identical* on both sides.

The convention is usually equality of edge labels, with tiles used only via translation in their fixed orientation. [^6_1][^6_3]

## Why that graphic was invalid

I had roughly implied this:

```text
Planner.east = Plan
Coder.west   = Plan       ✓

Planner.south = planned
Reviewer.north = planned  ✓

Coder.south = implemented
TestRunner.north = implemented ✓
```

But I failed to satisfy the other two shared boundaries:

```text
Planner.south = Reviewer.north     // okay
Coder.south   = TestRunner.north   // okay

Planner.east  = Coder.west         // okay
Reviewer.east = TestRunner.west    // not necessarily okay
```

More fundamentally, `Planner → Coder` and `Planner → Reviewer` were represented as if the planner could flow both right and downward with unrelated outputs. In a real Wang-tile system, it cannot: a tile emits exactly **one label per direction**, and every touching neighbor must consume the exact label on that border.

## A valid agent-tile example

Let horizontal edges represent a **work artifact**, and vertical edges represent a **workflow phase**.

```text
                 artifact
          TaskSpec         Plan          Patch
      +--------------+--------------+--------------+
intake|  Intake      |   Planner    |  (no tile)   |
      | TaskSpec→Plan|              |              |
      +--------------+--------------+--------------+
plan  |  (no tile)   |   Coder      |  Test Runner |
      |              |  Plan→Patch  | Patch→Report |
      +--------------+--------------+--------------+
impl. |  (no tile)   |              |              |
      +--------------+--------------+--------------+
```

That is still not ideal as a literal Wang grid because ordinary workflow data wants to follow a path:

```text
TaskSpec ── Planner ── Plan ── Coder ── Patch ── Test Runner ── TestReport
```

Whereas a tile’s north/south labels must also match the tile directly above/below. You would need explicit **wire / pass-through / empty** tiles to fill unused positions and preserve both dimensions.

For example, a transparent artifact pass-through tile might be:

```text
          north: planned
west: Plan ── [ wire ] ── east: Plan
          south: planned
```

It does nothing computationally, but allows a `Plan` and the `planned` phase to continue across a rectangular grid.

## The corrected model

There are two different concepts:


| Concept | Is it a Wang tiling? | Best use |
| :-- | --: | :-- |
| Agents as typed nodes connected by directed edges | No | Actual workflow execution |
| An agent with input, output, precondition, and postcondition ports | Tile-inspired, but not necessarily Wang | Agent contract design |
| A fixed rectangular grid where every adjacent port exactly matches | Yes | Constraint solving, spatial workflows, automata-like execution, synthesis |
| A generic agent workflow with fan-out, joins, retries, and loops | No—not naturally | Directed multigraph / state machine |

So, I would **not** claim your agent workflow is literally a Wang tiling unless you intentionally define a spatial execution model and introduce the required routing/pass-through tiles.

The useful idea is weaker but still valuable: use *tile-like directional contracts* to validate agent handoffs. For your agent architecture, retain a typed graph runtime; use the Wang-tile formalism only if you want to search/synthesize a bounded grid of locally compatible workflow components.
<span style="display:none">[^6_10][^6_11][^6_12][^6_13][^6_14][^6_15][^6_4][^6_5][^6_6][^6_7][^6_8][^6_9]</span>

<div align="center">⁂</div>

[^6_1]: https://pmc.ncbi.nlm.nih.gov/articles/PMC10039085/

[^6_2]: https://arxiv.org/html/2310.06759v2

[^6_3]: http://www.boristhebrave.com/permanent/24/06/cr31/stagecast/wang/intro.html

[^6_4]: https://www.cambridge.org/core/journals/forum-of-mathematics-sigma/article/metallic-mean-wang-tiles-i-selfsimilarity-aperiodicity-and-minimality/7745751EF90FB1F9BDBCF7D5AEBBF770

[^6_5]: https://courses.cs.duke.edu/fall08/cps234/projects/tilings.pdf

[^6_6]: https://web.stanford.edu/~dkim04/blog/translational-tilings/

[^6_7]: https://www.sciencedirect.com/science/article/pii/S019566981400047X

[^6_8]: https://ir.canterbury.ac.nz/bitstreams/e91c25fd-0806-4968-b3d5-4570d47d4aed/download

[^6_9]: https://dev.to/joestrout/wang-2-corner-tiles-544k

[^6_10]: https://www.reddit.com/r/math/comments/1l3tlo9/wang_tiles/

[^6_11]: https://www.youtube.com/shorts/L4WSKf6NZrc

[^6_12]: https://resources.wolframcloud.com/FunctionRepository/resources/GenerateWangTiling/

[^6_13]: https://www.santafe.edu/research/results/working-papers/tiling-groups-for-wang-tiles

[^6_14]: https://www.youtube.com/watch?v=34qjSyDc-8s

[^6_15]: https://www.advancesincombinatorics.com/article/18614-an-aperiodic-set-of-11-wang-tiles


---

# Can you redraw such that it’s valid, please?

I redrew it as a **strictly valid $2 \times 2$ Wang tiling**: all four shared borders match exactly, and every tile remains in its fixed orientation—no rotation or reflection.

The SVG artifact makes the four required matches explicit:

- Both horizontal joins are `Plan = Plan`.
- Both vertical joins are `ReviewedContext = ReviewedContext`.
- Blue and purple labels occur only on the outer boundary; teal labels identify the internal matching edges.

The key modeling choice is that each row is the same artifact-flow pattern at a different context transition:

```text
TaskSpec → Plan → Patch
DraftContext → ReviewedContext → ReleasedContext
```

This is valid as a tile system, though it is a *constraint-grid model* rather than a conventional sequential workflow trace.

---

# … in an artifact or canvas?

Yes—the redraw is in the **SVG artifact** I just created, named “valid-agent-wang-tiling.” It should be available to preview as a rendered diagram in the artifact/file panel.

If you meant an **interactive Canvas document** rather than a downloadable SVG artifact, I can instead make a self-contained HTML canvas version with hoverable edge-match explanations.

---

# I wonder if this might make sense with triangular tiles? Two inputs and one output?

Yes—**triangular tiles are a more natural visual primitive for a binary function**:

$$
f : A \times B \to C
$$

Use two oriented edges as inputs and the third as the output:

```text
          C  output
         ───────
        /   f   \
   A   /_________\  B
 input             input
```

More usefully, orient the triangle so data flows upward:

```text
        ┌─────────┐
        │ C output│
        └─────────┘
           /   \
          /  f  \
         /_______\
     A input     B input
```

The two lower edges accept `A` and `B`; the upper edge emits `C`. That directly expresses a node such as:

```ts
merge: (Plan, RepositoryContext) -> ImplementationPlan
```

Triangular tiles are a legitimate edge-labeled tile model: a triangular tile has three labeled edges, often called “glues” in tile-assembly literature.[^9_1]

## A valid composition

A downstream tile can consume the result along a shared full edge—still with fixed orientation and no reflection:

```text
          Patch
        ┌─────────┐
        │  test   │
        └─────────┘
         /       \
      Plan      RepoState
```

But there is a geometric constraint: triangles tile the plane in alternating orientations. An upward-pointing triangle shares an edge only with a downward-pointing triangle. If you preserve the semantic convention “bottom edges are inputs and top is output,” then direct output-to-input adjacency requires a second orientation or an adapter/wire tile.

For example:

```text
                   Report
                  ────────
                  \ test /
                   \____/
                     │ Patch
                  ____|____
                 / implement \
                /_____________\
              Plan          RepoContext
```

Here the implementation result (`Patch`) is the shared edge feeding the test tile. The visual flow is upward, while the triangles alternate orientation.

## Agent workflow contract

A useful agent-tile form would be:

```ts
type TriAgentTile<A, B, C, Context> = Readonly<{
  leftInput: Contract<A>
  rightInput: Contract<B>
  output: Contract<C>
  context: Context
  execute: (left: A, right: B) => Promise<C>
}>
```

For your workflow system:

```ts
const implement: TriAgentTile<
  Plan,
  RepoSnapshot,
  Patch,
  ReviewedContext
> = {
  leftInput: planContract,
  rightInput: repoSnapshotContract,
  output: patchContract,
  context: "reviewed",
  execute: async (plan, repo) => { /* agent + tools */ },
}
```

The output edge may only join another tile’s input edge when their contracts are compatible:

```ts
implement.output.schema  ⊆ test.leftInput.schema
implement.output.policy  >= test.leftInput.policy
implement.output.evidence satisfies test.leftInput.evidence
```


## The tradeoff

| Shape | Natural function model | Strength | Limitation |
| :-- | :-- | :-- | :-- |
| Square | One input, one output, plus two orthogonal constraints | Separates dataflow and lifecycle/policy cleanly | Binary inputs are awkward |
| Triangle | Two inputs, one output—or one input, two outputs | Closely matches binary functions, joins, and agent steps | Plane tiling forces alternating orientation; separate context needs encoding in labels |
| General port node | Any arity | Best fit for real agent DAGs | Is a graph rather than a strict tiling |

So I think triangles are a promising direction if the core abstraction is **“an agent consumes two independently validated things and produces one thing.”**

For example:

```text
Plan + RepoSnapshot → Patch
Patch + TestPolicy → TestReport
TestReport + ReviewRules → MergeDecision
```

That resembles an agentic build-and-review pipeline much more closely than forcing every agent into `one input → one output`.

The caveat is that once you need three inputs, fan-out, or error/retry branches, you will want additional tile species—splitters, pass-through wires, selectors, and perhaps hexagonal junction tiles—or you should treat the triangular system as a **visual/constraint language compiled to a typed workflow graph**, rather than the runtime topology itself.
<span style="display:none">[^9_10][^9_11][^9_12][^9_13][^9_14][^9_15][^9_2][^9_3][^9_4][^9_5][^9_6][^9_7][^9_8][^9_9]</span>

<div align="center">⁂</div>

[^9_1]: https://www.csd.uwo.ca/~lkari/pdfs/trihex_small.pdf

[^9_2]: https://learn.microsoft.com/en-us/dotnet/standard/parallel-programming/dataflow-task-parallel-library

[^9_3]: https://www.hou.usra.edu/meetings/planetdata2021/pdf/7015.pdf

[^9_4]: https://www.sciencedirect.com/science/article/pii/S0304397506007894

[^9_5]: https://users.cs.duke.edu/~reif/courses/molcomplectures/TilingAssembly/IntroTileAssembly/IntroTileAssembly.pdf

[^9_6]: https://people.cs.umass.edu/~brun/pubs/pubs/Brun07arith.pdf

[^9_7]: https://endjin.com/blog/overflowing-with-dataflow-part-1-an-overview

[^9_8]: https://mathoverflow.net/questions/164400/relationship-between-corner-tile-and-edge-tile-of-wang-tile

[^9_9]: https://www.dna.caltech.edu/Papers/SAshapes_arxiv.pdf

[^9_10]: https://www.youtube.com/watch?v=aPh4Z3SioB8

[^9_11]: https://devopedia.org/dataflow-programming

[^9_12]: https://resources.wolframcloud.com/FunctionRepository/resources/GenerateWangTiling/

[^9_13]: https://en.wikipedia.org/wiki/Wang_tile

[^9_14]: http://www.boristhebrave.com/permanent/24/06/cr31/stagecast/wang/intro.html

[^9_15]: https://www.youtube.com/watch?v=34qjSyDc-8s


---

# Has this been studied in detail? Is this a general case of want tiles?

Yes—this has been studied in detail, but mostly under **triangular/hexagonal tile systems** and **tile self-assembly**, rather than as “functional programming with triangular tiles.”

A triangle with three edge labels is a direct generalization of the edge-matching idea: each edge carries a finite label (often called a *color* or *glue*), and two tiles may touch only when their adjoining labels satisfy the matching rule. The literature explicitly defines triangular tiles this way and studies both equilateral and right-triangular systems. [^10_1][^10_2]

## Is it a Wang tile?

**Strictly:** no. A classical Wang tile is a fixed-orientation **unit square** with four labeled edges, placed by translation only—no rotation or reflection. [^10_3][^10_4]

**More broadly:** yes, it is a Wang-*style* or edge-matching tile system.

The general abstraction is:

$$
\text{tile system}
=
(\text{tessellation},\ \text{tile shapes},\ \text{edge-label alphabet},\ \text{matching relation},\ \text{placement/orientation rules})
$$

Classical Wang tiles instantiate that as:

```text
Square grid + square tiles + four edge colors + equality match + translations only
```

Your proposal is:

```text
Triangular grid + triangular tiles + three typed contracts + compatibility match + fixed orientations
```

So it is not a “general case of Wang tiles” in the narrow mathematical naming sense. It is a **sibling generalization**: replace the square tessellation with a triangular tessellation and retain local edge-matching constraints.

## Formalizing your version

For an upward-oriented binary agent/function tile:

```text
             output: C
                 ▲
                / \
               / f \
              /_____\
        input: A     input: B
```

give it a contract triple:

$$
t = (A,\ B,\ C)
$$

where the edge labels may be richer than types:

$$
A = (\text{schema},\ \text{provenance},\ \text{authority},\ \text{evidence})
$$

For two adjacent tiles, their shared edges need not use literal equality. Define a directed compatibility relation:

$$
\operatorname{compatible}(o, i)
$$

For example, an output contract can satisfy an input contract if:

$$
\operatorname{schema}(o) \leq \operatorname{schema}(i)
\land
\operatorname{trust}(o) \geq \operatorname{trust}(i)
\land
\operatorname{capabilities}(o) \supseteq \operatorname{capabilities}(i)
$$

That is a meaningful departure from classical Wang tiles, which normally use simple equality of adjoining colors. Classical edge matching is still the special case:

$$
\operatorname{compatible}(x,y) \iff x = y
$$

## Related established models

| Model | Primitive | How it relates to your idea |
| :-- | :-- | :-- |
| Classical Wang tiling | 4-edge fixed square | Local compatibility on a square lattice |
| Triangular tile systems | 3-edge triangle | Direct geometric analogue of a binary-input / single-output tile |
| Hexagonal tile systems | 6-edge hexagon | Better for several ports, contextual constraints, or local coordination |
| Abstract Tile Assembly Model (aTAM) | Tiles with labeled, strength-bearing “glues” | Adds an execution/growth process: tiles attach when enough neighboring glue strength is present |
| Dataflow graph | Arbitrary-arity operation nodes and typed edges | The most direct runtime representation of functions/agents |
| String diagrams / monoidal categories | Typed wires and compositional operations | The mathematical abstraction most aligned with multi-input/multi-output functional composition |

The triangular and square models have genuinely different expressive behavior under some precise simulation notions: research found deterministic triangular and square/hexagonal tile-assembly systems that cannot non-trivially simulate one another while preserving the resulting shape and boundary glues. [^10_1][^10_2]

## Where aTAM is especially relevant

The **abstract Tile Assembly Model** is likely the closest rigorous analogue for agent workflow synthesis.

Rather than filling an already-defined plane, you specify:

1. A finite set of tile types.
2. A seed assembly—your initial task, repository snapshot, user request, or event.
3. A glue label and strength on every edge.
4. A threshold $\tau$: a new tile may attach only when its matching neighboring edges supply sufficient total strength.

In the agent version, an implementation agent could require both `Plan` and `RepoSnapshot` before it is eligible to run:

```text
Plan          RepoSnapshot
   \             /
    \           /
     [ Implement ]
          |
        Patch
```

That is very close to “an agent activates only after its required artifacts and authorization have arrived.” Standard self-assembly models use matching edge glues and attachment thresholds to drive this incremental growth. [^10_5]

## Important design conclusion

For your purpose, I would call it something like:

> **Directed typed triangular tile assembly for agent workflows**

rather than “Wang tiles.”

That name makes its intended departures explicit:

- **Triangular**: two input ports and one output port.
- **Directed**: inputs and outputs are semantically different, not merely same-color edges.
- **Typed**: matching supports schema compatibility, not only equality.
- **Assembly**: eligible work units materialize/execute when prerequisites become available.
- **Agent workflows**: tiles contain an agent/tool/human operation rather than just a static decoration.

It would be a real constrained subclass of typed hypergraph/dataflow execution. The tile geometry could provide a compelling declarative syntax and a local validation/synthesis model, while a compiled graph or event-driven scheduler should remain the operational runtime.
<span style="display:none">[^10_10][^10_11][^10_12][^10_13][^10_14][^10_15][^10_6][^10_7][^10_8][^10_9]</span>

<div align="center">⁂</div>

[^10_1]: https://www.csd.uwo.ca/~lkari/pdfs/trihex_small.pdf

[^10_2]: https://research.google/pubs/triangular-and-hexagonal-tile-self-assembly-systems/

[^10_3]: https://en.wikipedia.org/wiki/Wang_tile

[^10_4]: https://www.advancesincombinatorics.com/article/18614-an-aperiodic-set-of-11-wang-tiles

[^10_5]: https://www.dna.caltech.edu/courses/cs191/paperscs191/patitz2013review_NatComp.pdf

[^10_6]: https://dl.acm.org/doi/10.5555/1109557.1109620

[^10_7]: https://dspace.mit.edu/bitstream/handle/1721.1/126249/paper(1).pdf?sequence=2

[^10_8]: https://arxiv.org/html/2405.01017v1

[^10_9]: https://www.semanticscholar.org/paper/One-Tile-to-Rule-Them-All:-Simulating-Any-Turing-or-Demaine-Demaine/12dcabd842dc135323576ea17ca1f93a42bb7980

[^10_10]: http://self-assembly.net/wiki/index.php/Category:Self-assembly

[^10_11]: https://amathr.org/an-aperiodic-set-of-eleven-wang-tiles/

[^10_12]: https://pmc.ncbi.nlm.nih.gov/articles/PMC10039085/

[^10_13]: https://www.santafe.edu/research/results/working-papers/tiling-groups-for-wang-tiles

[^10_14]: http://www.boristhebrave.com/permanent/24/06/cr31/stagecast/wang/intro.html

[^10_15]: https://www.youtube.com/watch?v=34qjSyDc-8s


---

# So, would triangular edges need both color and direction? Also, in order to tessellate, would we need to allow rotation (or reflection)?

Yes: for your **workflow** interpretation, each triangular edge should carry both a payload/contract label and a polarity. But you do **not** need to permit runtime rotation or reflection to tessellate.

## Give each edge a contract plus polarity

Classical Wang-style tiles only need a color such as `Plan`; an adjacent edge matches when it has the same color. That is symmetric.

Agent/dataflow handoffs are asymmetric:

```text
producer output  ───►  consumer input
```

So model an edge as:

```ts
type Edge<T> = Readonly<{
  polarity: "in" | "out"
  contract: Contract<T>
}>
```

Then adjacency should be directional:

```ts
const connects = <T>(
  producer: Edge<T>,
  consumer: Edge<T>,
): boolean =>
  producer.polarity === "out" &&
  consumer.polarity === "in" &&
  satisfies(producer.contract, consumer.contract)
```

This prevents invalid joins:

```text
Plan out  ↔ Plan in    valid
Plan out  ↔ Plan out   invalid
Plan in   ↔ Plan in    invalid
Patch out ↔ Plan in    invalid, unless an adapter establishes compatibility
```

An even cleaner formulation gives every contract a **dual endpoint**:

```text
Plan!   // produces a Plan
Plan?   // consumes a Plan
```

Only `Plan!` and `Plan?` match. This resembles channel/session-type notation more than ordinary color equality.

## Triangular geometry needs two orientations

For an equilateral-triangle tessellation, every triangle points either **up** or **down**, and an up-pointing triangle only abuts down-pointing triangles—never another up-pointing one. The underlying adjacency graph is bipartite for exactly this reason.[^11_1]

So this cannot tessellate:

```text
      /\        /\
     /  \      /  \
    /____\    /____\
```

Those are separated; they cannot share a whole edge. A triangle that shares an edge with the first must be inverted:

```text
      /\
     /  \
    /____\
    \    /
     \  /
      \/
```


## Do you allow rotation?

You have two coherent choices.


| Design | Rotation at placement time? | How it tessellates | Recommended? |
| :-- | --: | :-- | :-- |
| Fixed-orientation tile set | No | Define explicit `Up` and `Down` tile variants | **Yes** |
| Rotatable tile set | Yes | Rotate a generic triangular definition to fit a cell | Usually no |
| Mirrorable tile set | Reflection only if explicitly needed | Treat reflection as another transformation/variant | No by default |

The established triangular tile-assembly formulation takes the first approach: it represents an equilateral triangular tile with three glues plus a fixed orientation $k \in \{\mathrm{up}, \mathrm{down}\}$, and explicitly assumes tiles cannot be rotated or flipped.[^11_1]

So define distinct types:

```ts
type Orientation = "up" | "down"

type TriTile<A, B, C> = Readonly<{
  orientation: Orientation
  edges: readonly [Edge<A>, Edge<B>, Edge<C>]
  run: (a: A, b: B) => Promise<C>
}>
```

But it is better to make the semantic role explicit rather than assume “edge 0” is always input:

```ts
type UpJoin<A, B, C> = {
  orientation: "up"
  left: Edge<A> & { polarity: "in" }
  right: Edge<B> & { polarity: "in" }
  base: Edge<C> & { polarity: "out" }
}

type DownJoin<A, B, C> = {
  orientation: "down"
  left: Edge<A> & { polarity: "out" }
  right: Edge<B> & { polarity: "out" }
  base: Edge<C> & { polarity: "in" }
}
```

The second type is not necessarily an “agent function” in the same semantic direction. It can be an adapter, distributor, validator, join, or inverse stage chosen to make the lattice locally valid.

## The design tension

A literal triangle-grid workflow forces every direct neighbor connection to alternate orientation:

```text
up cell ↔ down cell ↔ up cell ↔ down cell
```

If all your agents are conceptually $A, B \to C$, they cannot all be identically oriented and directly compose along shared edges. You need some combination of:

- **Dual tile variants:** an up and down representation of a compatible operation.
- **Wire tiles:** preserve a contract across an otherwise unused cell.
- **Adapter tiles:** convert `Plan!` to `Plan?`, or transform/refine the artifact.
- **Pair macros:** treat an adjacent up/down pair as one higher-level workflow operation.
- **External ports:** permit inputs and outputs on the boundary of a finite tiled region.

This is exactly why the self-assembly literature treats orientation as part of the triangular tile type, rather than freely rotating instances. It studies equilateral triangles as `up`/`down` types and right triangles with four fixed directional variants.[^11_1]

## Practical recommendation

For your agent DSL, use:

```text
edge = { direction, polarity, contract, capability/policy constraints }
tile = { orientation, named edges, execution semantics }
```

With this rule:

> **Geometry determines which edge can physically touch; polarity determines which endpoints may connect; contract compatibility determines whether they may communicate.**

Do **not** permit arbitrary rotation or reflection initially. Instead, compile each conceptual agent into explicit oriented variants where valid:

```text
implementUp:   Plan? × RepoSnapshot? → Patch!
validateDown:  Patch! × TestPolicy! → TestReport?
```

If that feels semantically unnatural—and it may—take it as evidence that the triangle lattice is a useful *constraint/synthesis view* but not the right direct execution topology. A typed directed hypergraph remains the more faithful runtime model for a general agent system.

<div align="center">⁂</div>

[^11_1]: https://www.csd.uwo.ca/~lkari/pdfs/trihex_small.pdf


---

# I think I’ll presume a fixed orientation tile set, let’s muse about what rotations and reflections might mean? Might that also invert color and or direction on each edge? I imagine there might be a number of abstract systems these would affect how the underlying functions associated with the tile would work

Yes—but treat rotation, reflection, color transformation, and direction reversal as **separate operators**. Geometry alone should not silently change a tile’s function. The interesting design space is in defining which semantic transformation, if any, accompanies each geometric symmetry.

For a triangle, the geometric symmetry group has six elements: three rotations and three reflections. Your DSL can decide how those six transforms act on port positions, contracts, polarities, and execution semantics.

## Separate the transformations

Start with a fixed-orientation conceptual function:

$$
f : A \times B \to C
$$

```text
          C!
         /  \
        / f  \
      A?------B?
```

Here:

- `A?`, `B?` mean “consumes/provides an input endpoint for `A`/`B`.”
- `C!` means “produces an output endpoint for `C`.”
- The triangle’s geometry identifies **where** a port lies.
- Its contract and polarity identify **what** that port means.

A geometric transform should first merely **permute port locations**:

```text
rotate(tile): edge labels move to different physical edges
reflect(tile): two physical edge positions swap
```

It need not change `A`, `B`, `C`, `?`, `!`, or the function body. That is the safest base semantics.

## Rotation: port placement vs function meaning

A 120° rotation can mean one of three things.


| Interpretation | Result | Sound for ordinary functions? |
| :-- | :-- | --: |
| Geometry only | Same function and same ports, drawn on new edges | Yes |
| Port permutation | Inputs/output retain roles but move to different sides | Yes |
| Role rotation | An input becomes output and output becomes input | Usually no |

The first two are mostly equivalent for your language. A rotated `Implement` agent is still:

```ts
implement: (plan: Plan, repo: RepoSnapshot) => Patch
```

It simply occupies another orientation in the triangular lattice:

```text
              Plan?
                \
                 \ 
                  [ Implement ]── Patch!
                 /
     RepoSnapshot?
```

That is a **layout/attachment** transformation, not a new workflow operation.

This is compatible with tile-assembly research: some models explicitly allow polygonal tiles to rotate, while standard translation-only systems do not. The choice changes what geometric orientation information the system can exploit.[^12_1][^12_2]

## Reflection: likely means input exchange

Reflection naturally swaps the two input legs:

$$
f : A \times B \to C
\quad\mapsto\quad
f^{\mathrm{swap}} : B \times A \to C
$$

```ts
const swapInputs =
  <A, B, C>(f: (a: A, b: B) => C) =>
  (b: B, a: A): C =>
    f(a, b)
```

For an agent:

```ts
implement(plan, repo) -> patch
```

the reflected form is not “the same function with reversed execution.” It is:

```ts
implementReflected(repo, plan) -> patch
```

This is valid mechanically, but semantically mundane if your inputs are named ports:

```ts
{
  plan: Plan,
  repo: RepoSnapshot
} -> Patch
```

Named inputs make left/right exchange irrelevant, which may be preferable for agents. In that model, reflection is solely a **geometric embedding** transform.

Reflection becomes meaningful when the inputs have structural roles:

```text
request + credentials → authenticated request
source + transform    → transformed source
left subtree + right subtree → syntax tree
```

Then reflection can denote a deliberate role exchange, and should generate a distinct tile variant unless the operation is commutative.

```ts
add(a, b) === add(b, a)           // reflection-invariant
merge(a, b) !== merge(b, a)       // potentially order-sensitive
authorize(request, policy)        // role-sensitive
```


## Direction inversion is not ordinary inversion

Flipping edge polarity would suggest:

$$
A? \times B? \to C!
\quad\mapsto\quad
C? \to A! \times B!
$$

That looks like an inverse:

```text
         C?
        /  \
       / f⁻¹ \
     A!------B!
```

But a general function is not invertible. Given a `Patch`, you cannot generally reconstruct the unique `Plan` and `RepoSnapshot` that produced it.

So **do not define polarity inversion as “run the agent backwards.”** Instead, choose one of these distinct semantic systems.


| System | Meaning of a polarity-inverted tile |
| :-- | :-- |
| Reversible computation | A true inverse $f^{-1}$, only available for bijective/reversible functions |
| Relational / logic programming | A constraint relation $R(A,B,C)$, queried in any direction |
| Bidirectional transformations | A `get`/`put` or lens-style counterpart, with explicitly defined update laws |
| Backward planning | A goal `C` expands into required subgoals `A` and `B`; it is planning, not execution |
| Provenance / explanation | An output artifact asks for evidence or lineage that supports it |
| Validation | Consume `C` plus candidate `A`, `B` and verify that their relation holds |

For an agentic system, **backward planning** is the compelling interpretation:

```text
Forward execution:
Plan? + RepoSnapshot? ── Implement ──► Patch!

Backward planning:
DesiredPatch? ── PatchPlanner ──► Plan! + RepoRequirements!
```

But these are two different tiles with different behavior:

```ts
implement: (
  plan: Plan,
  snapshot: RepoSnapshot,
) => Promise<Patch>

planImplementation: (
  desired: PatchGoal,
) => Promise<{
  plan: Plan
  repoRequirements: RepoRequirement[]
}>
```

The second might be LLM-based and speculative; it does not reconstruct the actual historical inputs of the first.

## Color inversion can mean dual contracts

With classical Wang tiles, “color” is normally just an equality label. `Plan` matches `Plan`; there is no intrinsic inverse color.

For your typed directed version, each edge could have a **dual contract**:

```ts
type Port<C, P extends "in" | "out"> = {
  contract: C
  polarity: P
}

type Dual<P> = P extends "in" ? "out" : "in"

type DualPort<C, P extends "in" | "out"> = Port<C, Dual<P>>
```

Then:

```text
Plan!  ↔  Plan?
Patch! ↔ Patch?
```

This is close to session types, where the dual of a send action is a receive action, and dual endpoints are what make two communicating processes compatible.[^12_3][^12_4][^12_5]

However, dualizing a whole **protocol** is richer than flipping one edge:

```text
Producer: send Plan; receive Review; send Patch
Consumer: receive Plan; send Review; receive Patch
```

Thus, “invert color” is better named **take the dual contract**:

```text
Publish<Plan>  ↔  Consume<Plan>
Request<Review> ↔ Provide<Review>
```

It may also transform trust and authority requirements:

```text
Patch{
  provenance: SignedCI,
  integrity: verified,
  authority: write-repo
}
```

is not necessarily dual to an arbitrary “need a patch” input. The receiver may require `SignedCI`, while the producer must establish it.

## A useful algebra

You could define transformations explicitly rather than bake ambiguity into “rotate.”

```ts
type Transform =
  | { kind: "rotate"; turns: 0 | 1 | 2 }
  | { kind: "reflect"; axis: 0 | 1 | 2 }
  | { kind: "swapInputs" }
  | { kind: "dualPorts" }
  | { kind: "invertRelation" }
  | { kind: "deriveBackwardPlanner" }
```

Then assign semantics by tile capability:

```ts
type TileCapabilities = {
  geometricTransforms: readonly ("rotate" | "reflect")[]
  inputSymmetry: "none" | "swap" | "commutative"
  polarityTransform:
    | "none"
    | "dual-protocol"
    | "reversible"
    | "relation"
    | "backward-planner"
}
```

For example:

```ts
const implementTile = {
  geometricTransforms: ["rotate", "reflect"],
  inputSymmetry: "swap",
  polarityTransform: "backward-planner",
}
```

This says:

- It can occupy any explicit orientation you permit.
- Reflection exchanges the visual input positions.
- It cannot literally execute backward.
- It may have a separately defined planning tile that turns an output goal into prerequisites.


## Recommended semantics

For the fixed-orientation system you are considering:

1. **Rotation:** physical port permutation only.
2. **Reflection:** physical permutation plus optional named-input swap; never assume semantic equivalence.
3. **Color/contract dual:** producer ↔ consumer endpoint, or protocol dual—not a negation of the artifact type.
4. **Direction inversion:** forbidden by default for functions.
5. **Backward tile:** an explicitly generated or authored planner/validator/relation tile, not a transformed copy of forward execution.
6. **True inverse tile:** permitted only when the function proves or declares invertibility.

That gives you a principled separation:

```text
geometry transform      = how a tile occupies the lattice
port duality            = how endpoints communicate
semantic inverse        = a real mathematical/program transformation
backward planning       = an agentic goal-decomposition operation
```

The distinction prevents an elegant visual language from accidentally claiming impossible things—such as that any `Patch` can be inverted into the one true `Plan` and repository state that created it.
<span style="display:none">[^12_10][^12_11][^12_12][^12_13][^12_14][^12_15][^12_6][^12_7][^12_8][^12_9]</span>

<div align="center">⁂</div>

[^12_1]: https://arxiv.org/pdf/1212.4756.pdf

[^12_2]: https://link.springer.com/article/10.1007/s11047-024-09987-0

[^12_3]: https://www.cs.cmu.edu/~fp/papers/ppdp11.pdf

[^12_4]: https://www.dcs.gla.ac.uk/~ornela/publications/DGS12.pdf

[^12_5]: https://www.um.edu.mt/projects/behapi/wp-content/uploads/2019/07/vasconcelos_fundamental-sessions.pdf

[^12_6]: https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=935087

[^12_7]: https://pmc.ncbi.nlm.nih.gov/articles/PMC3513920/

[^12_8]: https://arxiv.org/html/2608.09823v1

[^12_9]: https://drops.dagstuhl.de/storage/00lipics/lipics-vol238-dna28/LIPIcs.DNA.28.2/LIPIcs.DNA.28.2.pdf

[^12_10]: https://en.wikipedia.org/wiki/String_diagram

[^12_11]: https://www.sciencedirect.com/science/article/pii/S2352220817301487

[^12_12]: https://pure.itu.dk/files/83025669/Multiparty_session_types_as_coherence_proofs.pdf

[^12_13]: https://ncatlab.org/nlab/show/string+diagram

[^12_14]: https://qchu.wordpress.com/2012/11/06/string-diagrams-duality-and-trace/

[^12_15]: https://users.cs.duke.edu/~reif/courses/molcomplectures/TilingAssembly/IntroTileAssembly/IntroTileAssembly.pdf


---

# Okay, now let’s get back on the track for the fixed tile set. Did that musing inspire any ideas for this?

Yes. The most productive idea is: **keep orientation fixed, but make the tile set explicitly contain semantic duals and structural tiles.** Do not use rotation/reflection as runtime magic; use what they suggested to design a richer, finite *vocabulary* of tile species.

That turns the triangle lattice into a small, typed “assembly language” for workflows, where an agent tile is only one of several kinds of computation.

## Four tile families

For a triangular lattice, define each tile at authoring time as either `up` or `down`. That is consistent with established triangular tile models, which treat orientation as part of the tile’s formal identity rather than freely rotating tiles.[^13_1]

### 1. Forward work tiles

The normal agent/tool form:

$$
A? \otimes B? \longrightarrow C!
$$

```text
          C!
         /  \
        / f  \
      A?------B?
```

Examples:

```text
Plan? + RepoSnapshot? → Patch!
Patch? + TestPolicy? → TestReport!
Task? + RepoIndex? → ImplementationPlan!
```

A tile has an execution body and succeeds only by producing a validated artifact plus evidence—not merely text that resembles the expected shape. Explicit contract checks at agent handoffs are a core reliability practice in agent orchestration.[^13_2][^13_3]

### 2. Goal-expansion tiles

The earlier “direction inversion” musing suggests a separate **planning** primitive:

$$
C^{\text{goal}}? \longrightarrow A^{\text{goal}}! \otimes B^{\text{goal}}!
$$

```text
      DesiredPatch?
             |
        [ decompose ]
         /         \
   PlanGoal!   RepoRequirement!
```

This is *not* `f⁻¹`. It says:

> To satisfy this requested result, create these prerequisites.

That maps very well to an LLM planner or supervisor. Its outputs are obligations/tasks, not recovered historical inputs.

```ts
type GoalExpansion<C, A, B> = (
  target: Goal<C>
) => Promise<readonly [Goal<A>, Goal<B>]>
```

Your scheduler can recursively tile/resolve those child goals.

### 3. Evidence and validation tiles

Instead of reversing a function, use a tile that validates the claimed relation:

$$
A? \otimes B? \otimes C? \longrightarrow \operatorname{Proof}(f(A,B)=C)!
$$

A triangle has only three ports, so represent the two candidate inputs as a product:

$$
(A \times B)? \otimes C? \longrightarrow \operatorname{Evidence}!
$$

```text
  (Plan, RepoSnapshot)? + Patch?
                 |
          [ verify patch ]
                 |
          TestReport! / Proof!
```

These tiles are likely as important as agent tiles:

```text
Patch? + Repository? → TypecheckReport!
Patch? + TestSuite?  → TestReport!
Patch? + ReviewPolicy? → ApprovalDecision!
```

This gives the system an operational answer to “does this output count?” A workflow node should return control only after its declared outcome can be checked.[^13_3]

### 4. Structural tiles

The geometry needs simple tiles that do not “reason,” but make composition possible:


| Tile species | Signature | Purpose |
| :-- | :-- | :-- |
| Wire | `A? → A!` | Carry an artifact through the lattice |
| Adapter | `A? → B!` | Schema conversion, normalization, format projection |
| Splitter | `A? → A! × A!` | Fan out an immutable artifact |
| Join / bundle | `A? × B? → [A, B]!` | Package independent prerequisites |
| Gate | `A? × Approval? → A!` | Require human/policy authorization |
| Sink | `A? → Receipt!` | Archive, publish, notify, or terminate |
| Failure | `Error? → RecoveryGoal!` | Convert failure into retry/escalation/replanning |

These are the fixed-tile counterparts to the transformations we discussed. Rather than rotating a general tile until the topology fits, the language states *why* the topology changes: `split`, `bundle`, `gate`, or `decompose`.

## Fixed orientation becomes an advantage

With an explicit `up`/`down` set, orientation can encode a coarse **computational phase** rather than merely geometry:

```text
Up triangles:   resolve prerequisites into a verified artifact.
Down triangles: distribute, validate, gate, or expand goals.
```

One possible convention:

```text
Up:
  inputs flow from lower-left / lower-right
  output flows upward

Down:
  input arrives from above
  outputs flow to lower-left / lower-right
```

```text
                   Goal?
                     |
                [ decompose ]          down
                 /         \
           Goal A!         Goal B!

           Artifact A?     Artifact B?
                 \           /
                  [ execute ]           up
                       |
                   Artifact C!
```

The downward tile produces two requirements; the upward tile consumes their fulfilled forms. That gives the alternation imposed by triangular tessellation a useful meaning rather than treating it as an awkward fact of geometry.

The two tile types need not be inverses:

```text
decomposeDesiredPatch: Goal<Patch> -> [Goal<Plan>, Goal<RepoSnapshot>]

implement: [Plan, RepoSnapshot] -> Patch
```

They simply occupy complementary roles in a goal-to-execution loop.

## Use “polarity” as state, not color

Instead of augmenting every edge with an opaque color plus an unrelated arrow, define its label as a structured endpoint:

```ts
type Port<
  T,
  Mode extends "require" | "provide",
  Phase extends "goal" | "artifact" = "artifact",
> = Readonly<{
  artifact: T
  mode: Mode
  phase: Phase
  evidence?: readonly EvidenceRequirement[]
  authority?: readonly Capability[]
}>
```

Examples:

```ts
type PlanGoal = Port<Plan, "provide", "goal">
type PlanArtifact = Port<Plan, "require", "artifact">
type VerifiedPatch = Port<Patch, "provide", "artifact">
```

The edge matching rule then becomes a first-class relation:

```ts
const match = (
  offered: Port<unknown, "provide">,
  required: Port<unknown, "require">,
): MatchResult => {
  // schema assignability
  // provenance/evidence
  // authority and budget
  // goal/artifact phase compatibility
}
```

This is stronger than color equality, but preserves the Wang-like local rule: every attachment is independently checked.

Agent protocols likewise need more than payload type—they define structured messages, role expectations, and sequencing rules.[^13_4][^13_5]

## A synthesis model

This gives you a compelling compile-time problem:

```text
Given:
  boundary inputs:  TaskSpec!, RepoSnapshot!, TestPolicy!
  desired boundary: VerifiedPatch!

Find:
  a bounded triangular assembly where every touching edge matches
  and every required external edge is satisfied.
```

The solver chooses from a finite registry:

```text
decomposePatchGoal
createPlan
fetchRepoSnapshot
implement
runTests
reviewPatch
approvalGate
wire
split
bundle
retry
escalate
```

The runtime is then not “the tiling algorithm executes code.” Instead:

1. The control plane chooses or synthesizes a valid assembly.
2. It compiles that assembly into a typed dependency graph.
3. The scheduler executes eligible forward tiles concurrently.
4. Every output is validated against its outgoing edge contracts.
5. A failure attaches to a recovery/escalation tile or invalidates the assembly.

That preserves your fixed tile set, handles ordinary graph-runtime realities, and makes the tile grammar useful for workflow synthesis rather than just diagramming.
<span style="display:none">[^13_10][^13_11][^13_12][^13_13][^13_14][^13_15][^13_6][^13_7][^13_8][^13_9]</span>

<div align="center">⁂</div>

[^13_1]: https://www.csd.uwo.ca/~lkari/pdfs/trihex_small.pdf

[^13_2]: https://www.jetbrains.com/pages/ai-agents/architecture/ai-agent-orchestration/

[^13_3]: https://jlowin.dev/blog/directed-agentic-graphs

[^13_4]: https://www.ibm.com/think/topics/ai-agent-protocols

[^13_5]: https://www.irif.fr/~gio/papers/journals/BH-mscs-2013-modelling_session_types.pdf

[^13_6]: https://link.springer.com/article/10.1007/s11047-023-09971-0

[^13_7]: https://newsletter.systemdesign.one/p/agent-to-agent-protocol

[^13_8]: https://blog.christianposta.com/understanding-sessions-in-agent-to-agent-communication/

[^13_9]: https://www.ssonetwork.com/intelligent-automation/columns/ai-agent-protocols-10-modern-standards-shaping-the-agentic-era

[^13_10]: https://www.youtube.com/watch?v=07-gy7iDJVQ

[^13_11]: https://www.digitalapplied.com/blog/multi-agent-orchestration-5-patterns-that-work

[^13_12]: https://www.romjist.ro/full-texts/paper594.pdf

[^13_13]: https://www.augmentcode.com/guides/multi-agent-orchestration-architecture-guide

[^13_14]: https://arxiv.org/pdf/1212.4756.pdf

[^13_15]: https://dspace.mit.edu/bitstream/handle/1721.1/126249/paper(1).pdf?sequence=2


---

# Up:

inputs flow from lower-left / lower-right
output flows upward

Down:
input arrives from above
outputs flow to lower-left / lower-right

Would this mean that entrances arranged in a diamond could never exchange due to polarity ?

**Not necessarily.** Polarity prevents two *inputs* from directly attaching to each other, but it does not prevent information from entering a diamond, being transformed inside it, and exiting on opposite sides. You need an explicit routing or swap tile; geometry alone cannot imply exchange.

## What polarity forbids

With the proposed convention:

```text
Up tile:     A? + B? → C!
Down tile:   C? → A! + B!
```

a shared edge is valid only as:

```text
X! ─── X?
```

So these are invalid:

```text
X? ─── X?     two consumers meet
X! ─── X!     two producers collide
```

That restriction is intentional: it preserves directed dataflow, just as a normal dataflow graph connects an output of one computation to an input of another. [^14_1][^14_2]

## A diamond can exchange

If by a diamond you mean two incoming boundary ports and two outgoing boundary ports, it can implement a swap—but it needs to be represented as computation:

```text
          Pair<A, B>!
               ▲
              / \
            A?   B?
          [ bundle ]
              │
              │ Pair<A, B>?
          [ swap + split ]
            /           \
          B!             A!
```

In function form:

```ts
const swap = <A, B>([a, b]: readonly [A, B]): readonly [B, A] =>
  [b, a]
```

Its overall contract is:

$$
A? \otimes B? \longrightarrow B! \otimes A!
$$

So the two incoming values have exchanged *positions* in the outgoing pair. They did not cross through one another on the same edge; they were joined, transformed, then redistributed.

```text
left input A   ──► left output B
right input B  ──► right output A
```

This is valid under polarity because the center always has producer-to-consumer attachments.

## The distinction: routing vs crossing

A triangular lattice is planar. Two independent wires cannot geometrically cross without sharing a tile, because there is no “overpass” in a 2D edge-sharing tessellation.

Therefore there are two possible meanings of “exchange”:


| Desired behavior | Possible with basic polarity? | Needed tile |
| :-- | --: | :-- |
| Consume `A` and `B`, then emit `(B, A)` | Yes | `Swap` or `bundle → swap+split` |
| Let two opaque values cross without either operation inspecting them | Not with plain planar wiring | A dedicated crossing / permutation macro |
| Connect two incoming ports directly | No | Impossible by design |
| Send one input to both outputs | Yes | `Copy` / `fan-out` tile, assuming immutable or shareable data |

For an immutable functional workflow, the `Swap` tile is harmless and deterministic. For a linear resource—file lock, authorization token, write capability, or exclusive agent-session endpoint—copying must be disallowed and swapping transfers ownership rather than duplicates it. Linearity is one of the mechanisms used by session-type systems to make endpoint usage safe. [^14_3][^14_4]

## A fixed-tile answer

This suggests a small required **structural basis** for your fixed tile set:

```text
Forward agent:     A? + B? → C!
Goal expansion:    C_goal? → A_goal! + B_goal!
Bundle:            A? + B? → Pair<A, B>!
Split:             Pair<A, B>? → A! + B!
Swap:              Pair<A, B>? → Pair<B, A>!
Fan-out:           A? → A! + A!      only for duplicable A
Gate:              A? + Approval? → A!
```

You could hide `bundle → swap → split` behind one named triangular or diamond-shaped **macro tile**:

```ts
type SwapTile<A, B> =
  (left: A, right: B) => readonly [right: B, left: A]
```

A macro may physically occupy several elementary triangles, but it presents four boundary ports:

```text
       left A?       right B?
            \         /
             \ swap  /
             /       \
       left B!       right A!
```

That is probably the cleanest solution: preserve simple one-way polarity at every elementary edge, while allowing a compound region to implement useful non-local wiring behavior.

## One correction to the convention

The proposed up/down convention is good for **tree-shaped dependency expansion and reduction**, but it does make arbitrary routing costly. That is not a defect if it is intentional:

- Use triangular tiling for local dependency assembly.
- Treat diamonds as first-class composite motifs.
- Compile each motif into an ordinary typed workflow graph.
- Add explicit swap/crossing macros only if your solver keeps needing them.

The limitation is useful: whenever two workflow paths must “exchange,” the DSL forces you to declare whether you mean a true permutation, a merge-and-transform, a fan-out, or an unsafe shared-resource handoff.
<span style="display:none">[^14_10][^14_11][^14_12][^14_13][^14_14][^14_15][^14_5][^14_6][^14_7][^14_8][^14_9]</span>

<div align="center">⁂</div>

[^14_1]: https://www.intel.com/content/www/us/en/docs/onetbb/developer-guide-api-reference/2021-6/data-flow-graph.html

[^14_2]: https://www.cs.colostate.edu/cameron/dataflow.html

[^14_3]: https://pure.itu.dk/files/83523575/a9_honda.pdf

[^14_4]: http://www.simonjf.com/2016/05/28/session-type-implementations.html

[^14_5]: https://dl.acm.org/doi/10.1145/3586031

[^14_6]: https://www.cs.cornell.edu/courses/cs6120/2019fa/blog/dfg-cover/

[^14_7]: https://en.wikipedia.org/wiki/Triangular_tiling

[^14_8]: https://drops.dagstuhl.de/storage/00lipics/lipics-vol243-concur2022/LIPIcs.CONCUR.2022.35/LIPIcs.CONCUR.2022.35.pdf

[^14_9]: https://www.quantamagazine.org/a-brief-history-of-tricky-mathematical-tiling-20231030/

[^14_10]: https://groups.inf.ed.ac.uk/abcd/session-implementations.html

[^14_11]: https://www.reddit.com/r/askmath/comments/1vfjk0p/board_game_triangle_tiling_question/

[^14_12]: http://squaring.net/tri/twt.html

[^14_13]: https://docs.washi.dev/echo/guides/core/dfg-basics.html

[^14_14]: https://www.mathpages.com/home/kmath486/kmath486.htm

[^14_15]: https://primo.ai/index.php/Data_Flow_Graph_(DFG)


---

# Let’s take a slightly different approach. Always single output, one input is is just general input, but the other is the function’s closure

Yes—this is a much cleaner triangle model.

Rather than treating a triangle as a symmetric binary function $A \times B \to C$, treat it as a **closure-backed unary function**:

$$
f_{\rho} : A \to B
$$

where $\rho$ is the closure/environment captured by the function. At execution level, it is still:

$$
\operatorname{run} : \rho \times A \to B
$$

but the two inputs have fundamentally different roles. This mirrors closure conversion: a closure can be represented as code plus an environment, and application passes that environment as an additional argument.[^15_1][^15_2]

## The triangle’s ports

```text
                  output
                    B!
                   / \
                  /   \
     input A?    /  fρ \    closure ρ?
                /_______\
```

Or, in a more dataflow-oriented reading:

```text
main input  ──► [ closed function ] ──► output
                     ▲
                     │
            captured environment
```

The triangle says:

> “Given this ambient bound environment, apply this function to one new input and emit one result.”

That matches normal higher-order FP better than the former generic two-input interpretation.

```ts
type ClosureTile<Input, Env, Output> = Readonly<{
  input: Port<Input, "in">
  closure: Port<Env, "in">
  output: Port<Output, "out">

  run: (input: Input, environment: Env) => Promise<Output>
}>
```

For a pure function, `run` is simply:

```ts
(input, env) => output
```

For an agent, `env` is the agent’s effective operating context.

## Why this resolves the symmetry issue

The two inbound ports are now **not exchangeable**:


| Port | Meaning | May be swapped with the other? |
| :-- | :-- | --: |
| General input | The new value/task/message being processed | No |
| Closure | Captured values, authority, tools, identity, policies, bound dependencies | No |
| Output | Newly produced result | No |

Reflection would visually swap `input` and `closure`, which usually produces a nonsensical or distinct operation:

```ts
// Original
implement: (task: Task, env: RepoContext) => Patch

// Reflected semantic signature — not equivalent
implementReflected: (repo: RepoContext, env: Task) => Patch
```

So a fixed-orientation tile set is especially sensible under this model. The physical orientation carries role information:

```text
left edge   = invocation input
right edge  = closure/environment
top edge    = produced result
```

No rotations, no reflections, and no accidental ambiguity about whether two borders may attach.

## The closure is not ordinary state

This creates an important constraint: since you want **one output only**, the closure cannot be an evolving state threaded from tile to tile—at least not without encoding a new state within the output.

There are three valid closure modes:


| Closure mode | Meaning | Can many tiles use it? |
| :-- | :-- | --: |
| Immutable value | Configuration, repository snapshot, schema registry, model settings | Yes |
| Read-only capability | Search access, GitHub read permission, secret reference, policy scope | Usually yes |
| Linear resource | Write lease, transaction, exclusive agent-session ownership | No—must be consumed or explicitly returned |

For your first version, constrain closure edges to **immutable or read-only context**:

```ts
type AgentEnvironment = Readonly<{
  repo: RepoSnapshot
  policy: Policy
  tools: ToolRegistry
  model: ModelPolicy
  budget: Budget
}>
```

Then the tile remains function-like:

```ts
run(task, env) => result
```

rather than hiding mutable coordination behind a vague “context” edge.

## Agent tiles become closure instances

This is a strong fit for agent workflows because an agent is naturally a closure:

```ts
type AgentClosure = Readonly<{
  prompt: PromptTemplate
  model: ModelPolicy
  toolPermissions: readonly Capability[]
  repoScope: RepoSnapshotRef
  policy: ExecutionPolicy
  budget: Budget
}>
```

Then a concrete agent invocation is:

```ts
const implement: ClosureTile<TaskSpec, AgentClosure, Patch> = {
  input: taskSpecPort,
  closure: implementationAgentEnvironment,
  output: patchPort,

  run: async (task, env) => {
    // agent operates with env.prompt, env.tools, env.repoScope, env.policy
    return patch
  },
}
```

The incoming work item is distinct from the environment that defines *how and under what authority* it will be processed.

## The most useful insight: closure as binding

The closure edge can mean the tile has not yet become executable.

```text
                 Patch!
                  /\
                 /  \
      TaskSpec? /____\ AgentClosure?
```

This tile needs **both** attachments before it is ready:

1. A `TaskSpec` arrives on its invocation edge.
2. An `ImplementationAgentClosure` arrives on its closure edge.

Once the closure port is bound, you can view the triangle as partially applied:

$$
\operatorname{implement}_{\rho} : \text{TaskSpec} \to \text{Patch}
$$

```text
Before binding:
TaskSpec? + ImplementationEnvironment? → Patch!

After binding:
ImplementationEnvironment is fixed
TaskSpec? → Patch!
```

That gives you a natural assembly/execution distinction:

- **Assembly phase:** match and bind the closure edge.
- **Invocation phase:** wait for the regular input.
- **Execution phase:** run the closed agent/function.
- **Emission phase:** validate and publish the one output.


## Suggested port taxonomy

Avoid generic `in` / `out` alone. Encode the special closure role:

```ts
type PortRole = "argument" | "closure" | "result"

type Port<
  T,
  Role extends PortRole,
  Polarity extends "requires" | "provides",
> = Readonly<{
  role: Role
  polarity: Polarity
  contract: Contract<T>
}>
```

A tile becomes:

```ts
type UnaryClosureTile<A, Env, B> = Readonly<{
  argument: Port<A, "argument", "requires">
  closure: Port<Env, "closure", "requires">
  result: Port<B, "result", "provides">
  execute: (arg: A, env: Env) => Promise<B>
}>
```

Then matching needs both **polarity** and **role-aware contract compatibility**:

```text
TaskSpec!                    → argument: TaskSpec?
ImplementationClosure!       → closure: ImplementationClosure?
Patch!                        → another tile’s argument: Patch?
```

I would normally *not* allow an arbitrary result edge to bind a closure edge merely because their TypeScript types happen to agree. The role distinction protects the language’s semantics.

## A good finite tile set

This suggests a less sprawling primitive set:

```text
Bind:          Definition? + Environment? → ClosedFunction!
Invoke:        ClosedFunction? + Argument? → Result!
Agent tile:    Argument? + AgentClosure? → Result!
Adapter:       Argument? + AdapterClosure? → Result!
Validator:     Candidate? + ValidationClosure? → Evidence!
```

You may represent `Bind` and `Invoke` as separate tiles, or treat every agent tile as their fused form.

For your design, I would begin with the fused version:

```text
Argument? + Closure? → Result!
```

but keep the conceptual distinction. It will matter later when you want cached/prepared agents, reusable closures, explicit capability binding, reproducible execution contexts, or audit records.

This turns the triangle from “a general binary operator in a lattice” into something more distinctive: a **spatial closure calculus** where one adjacency supplies the new work and the other establishes the executable context.
<span style="display:none">[^15_10][^15_11][^15_12][^15_13][^15_14][^15_15][^15_3][^15_4][^15_5][^15_6][^15_7][^15_8][^15_9]</span>

<div align="center">⁂</div>

[^15_1]: https://matt.might.net/articles/closure-conversion/

[^15_2]: https://cs420.epfl.ch/archive/20/c/05_cc.html

[^15_3]: https://stackoverflow.com/questions/1095707/what-is-the-exact-definition-of-a-closure

[^15_4]: https://www.sciencedirect.com/topics/engineering/data-flow-graph

[^15_5]: https://en.wikipedia.org/wiki/Closure_(computer_programming)

[^15_6]: https://learn.microsoft.com/en-us/azure/iot-operations/connect-to-cloud/concept-dataflow-graphs

[^15_7]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Closures

[^15_8]: https://www.cs.tufts.edu/comp/150VM/modules/10closures.html

[^15_9]: https://www.reddit.com/r/ProgrammingLanguages/comments/1b8hqbc/why_closure_is_a_big_deal/

[^15_10]: https://www.reddit.com/r/ProgrammingLanguages/comments/1kkzqe1/typed_closures/

[^15_11]: https://thunderseethe.dev/posts/closure-convert-base/

[^15_12]: https://frontend.turing.edu/lessons/module-2/closures.html

[^15_13]: https://www.intel.com/content/www/us/en/docs/onetbb/developer-guide-api-reference/2021-6/data-flow-graph.html

[^15_14]: https://www.cs.colostate.edu/cameron/dataflow.html

[^15_15]: https://devopedia.org/dataflow-programming


---

# Okay, let’s reimagine this based on the closure stuff

Reimagine it as a **closure-assembly calculus**, not a tiling of generic functions.

A triangle is not “two values in, one value out.” It is an **open operation** that becomes runnable when its lexical/operational environment is bound, then consumes one invocation argument and emits one result:

$$
\operatorname{open}\ f : \rho? \otimes A? \to B!
$$

After binding the closure $\rho$:

$$
f_{\rho} : A? \to B!
$$

This directly parallels closure conversion: a closure is code paired with an environment for its free variables; the converted code receives that environment explicitly.[^16_1][^16_2][^16_3]

## The new mental model

```text
                   result B!
                      /\
                     /  \
                    / f  \
       argument A? /______\ closure ρ?
```

Read it as:

> This tile is an **open function**. Its right edge supplies everything the function has captured; its left edge supplies the one thing being invoked upon; its top edge produces the result.

The tile’s body is a code identity:

```ts
f: (arg: A, closure: Env) => Promise<B>
```

But the tile does not represent a general binary operator. Its closure is its identity and operating envelope.

```ts
type OpenTile<A, Env, B> = Readonly<{
  code: CodeRef
  argument: Requires<A>
  closure: Requires<Env>
  result: Provides<B>
  invoke: (arg: A, env: Env) => Promise<B>
}>
```


## Two assembly phases

The decisive idea is to split **binding** from **invocation**.

### 1. Bind: construct the closed agent/function

```text
AgentDefinition? + Environment? → ClosedAgent!
```

```text
        ClosedImplementer!
                /\
               /  \
              /bind\
 AgentSpec?  /______\ RepoScopedEnvironment?
```

The resulting `ClosedImplementer` is a first-class value:

```ts
type ClosedAgent<A, B> = {
  agentId: string
  invoke: (input: A) => Promise<B>
  manifest: ExecutionManifest
}
```

It carries a frozen, inspectable environment:

```ts
type ImplementationEnvironment = Readonly<{
  promptVersion: PromptHash
  model: ModelPolicy
  repoSnapshot: RepoSnapshotRef
  toolCapabilities: readonly Capability[]
  policy: PolicyRef
  budget: Budget
}>
```

This makes the closure edge an architectural boundary rather than “a second arbitrary input.”

### 2. Invoke: process one new argument

```text
ClosedImplementer? + TaskSpec? → Patch!
```

```text
                 Patch!
                   /\
                  /  \
                 /run \
 ClosedAgent?   /______\ TaskSpec?
```

You can fuse both triangles into one primitive in the initial language, but conceptually retaining the split helps with caching, approval, provenance, and reuse.

## The lattice has two flows

This makes the geometry more meaningful:

```text
Closure / authority flow:    binds environments into executable units
Argument / artifact flow:    invokes those units and carries results onward
```

A closure edge should carry **slow-moving, versioned, mostly immutable context**:

- Agent definitions and prompt/model versions.
- Repository snapshot or workspace scope.
- Tool registry and granted capabilities.
- Budget, trace policy, user/org policy.
- Schema/version registry.
- Retrieval/index snapshot.
- Human approval or delegated authority.

An argument edge should carry **fast-moving work**:

- User request.
- Task specification.
- Plan.
- Source fragment.
- Patch.
- Test report.
- Review request.
- Tool result.

That separation is valuable because it prevents an agent output from accidentally becoming an agent’s authority, tool access, system prompt, or repository scope.

## Closure becomes capability binding

For agents, the closure is not just lexical variables. It is an **explicit capability envelope**:

```ts
type AgentClosure = Readonly<{
  identity: "implementation-agent@v3"
  tools: readonly ["read_repo", "run_tests"]
  repoScope: "repo@sha256:abc..."
  writeAuthority: false
  maxSteps: 12
  maxSpendUsd: 0.35
  policy: "propose-only"
}>
```

This is capability-oriented rather than ambient-authority design: the tile receives the specific authority it may exercise, rather than implicitly inheriting process-wide permissions. Capabilities are commonly understood as unforgeable tokens of authority.[^16_4][^16_5]

Then a write-capable agent is visibly different in the topology:

```text
TaskSpec? + ReadOnlyImplementationClosure? → ProposedPatch!

ApprovedPatch? + RepositoryWriteLease? → AppliedCommit!
```

No write happens merely because a generic `Patch` happens to reach a generic agent.

## A small language

I would define two foundational tile forms plus a handful of structural ones.


| Tile | Contract | Meaning |
| :-- | :-- | :-- |
| `Bind` | `Definition? + Env? → Closure!` | Create a closed function/agent |
| `Invoke` | `Closure? + Argument? → Result!` | Invoke a bound function |
| `Adapt` | `Closure? + A? → B!` | Transform/normalize/parse |
| `Validate` | `Closure? + Candidate? → Evidence!` | Check output against an executable criterion |
| `Authorize` | `Authority? + Proposal? → ApprovedProposal!` | Bind authority to a proposed effect |
| `Emit` | `SinkClosure? + Event? → Receipt!` | Perform a controlled external effect |
| `Recover` | `RecoveryClosure? + Failure? → RetryOrEscalation!` | Handle a failed invocation |

That is a functional core with an explicit effects boundary.

## The execution rule

A tile is eligible when both required edges are satisfied:

```ts
const ready = (tile: OpenTile<unknown, unknown, unknown>) =>
  tile.argument.isBound &&
  tile.closure.isBound
```

Then:

1. Validate the closure contract and its authority.
2. Validate the invocation artifact.
3. Invoke the closed function/agent.
4. Validate the output against its result-edge contract.
5. Publish the result token.
6. Record an execution receipt linking code, closure, input, output, tool calls, and evidence.

This is dataflow-like: operations fire when their required inputs are present; traditional dataflow models represent operations as nodes and data dependencies as token-carrying edges.[^16_6][^16_7]

## What a workflow looks like

```text
ImplementationDefinition? ─┐
                            ├─ Bind ───── ClosedImplementer!
RepoScopedEnvironment? ────┘                      │
                                                   │ closure
TaskSpec! ─────────────────────────────────────────┼─ Invoke ──► ProposedPatch!
                                                   │
TestEnvironment! ─────────────────────────────────┘
```

More accurately, each `Invoke` receives **one** closure:

```text
ImplementationDefinition? + RepoScopedEnvironment?
                    ↓
            ClosedImplementer!

ClosedImplementer? + TaskSpec?
                    ↓
               ProposedPatch!

TestRunnerDefinition? + TestEnvironment?
                    ↓
              ClosedTestRunner!

ClosedTestRunner? + ProposedPatch?
                    ↓
                TestReport!
```

The workflow is therefore an assembly of **prepared executable closures** and **arguments moving through them**.

## The key design rule

Make this invariant explicit:

> **Argument edges carry values to be processed. Closure edges carry the bound context that defines how processing is permitted and performed. Result edges carry newly produced values.**

Do not permit automatic interchange among those roles, even when their underlying structural schema coincides.

```text
RepoSnapshot as an argument: “analyze this repository.”
RepoSnapshot in a closure: “you may inspect exactly this repository.”
```

Same data shape; radically different semantics.

That distinction gives the triangular system a real reason to exist. It is not just a novel way to draw a dataflow graph—it is a spatial model for binding **code, authority, provenance, and environment** before an agent may act.
<span style="display:none">[^16_10][^16_11][^16_12][^16_13][^16_14][^16_15][^16_8][^16_9]</span>

<div align="center">⁂</div>

[^16_1]: https://arxiv.org/abs/2507.15843

[^16_2]: https://matt.might.net/articles/compiling-scheme-to-c/

[^16_3]: https://cs420.epfl.ch/archive/20/c/05_cc.html

[^16_4]: https://en.wikipedia.org/wiki/Capability-based_security

[^16_5]: https://bmannconsulting.com/notes/capability-based-security/

[^16_6]: https://www.cs.colostate.edu/cameron/dataflow.html

[^16_7]: https://ccsg.ece.cmu.edu/ttpython/advanced/background.html

[^16_8]: https://www.sciencedirect.com/topics/computer-science/data-flow-graph

[^16_9]: https://arxiv.org/pdf/2303.09552.pdf

[^16_10]: https://oneuptime.com/blog/post/2026-01-30-capability-based-security/view

[^16_11]: http://lambda-the-ultimate.org/node/3930

[^16_12]: https://blog.scooletz.com/2020/06/08/capability-based-security

[^16_13]: https://www.sigops.org/2020/the-remarkable-utility-of-dataflow-computing/

[^16_14]: https://www.reddit.com/r/Compilers/comments/1kmfqoi/closure_conversion_takes_the_function_out_of/

[^16_15]: https://www.cs.tufts.edu/comp/150VM/modules/10closures.html


---

# Are closures generally serializable? I’ve seen some stuff related to resumability js frameworks?

**Generally, no.** A normal JavaScript closure is not serializable as an executable object: standard structured cloning cannot duplicate function objects, so `structuredClone`, `postMessage`, IndexedDB, and similar boundaries reject them.[^17_1]

But Qwik-style resumability shows a useful workaround: serialize a **closure recipe**—a reference to compiled code plus serializable captured state—then reconstruct the closure later.

## What a normal closure contains

```ts
function makePrefixer(prefix: string) {
  return (value: string) => `${prefix}${value}`
}

const warn = makePrefixer("WARN: ")
```

Conceptually:

```text
closure = {
  code: (value) => `${prefix}${value}`,
  lexicalEnvironment: { prefix: "WARN: " }
}
```

The problem is that JavaScript’s actual lexical environment is an engine-level runtime structure, not a portable data object. It can contain non-serializable or process-local things:

- Functions and modules.
- DOM nodes and live browser/server handles.
- Open file descriptors, sockets, streams, database connections.
- Weak references, symbols, prototype-sensitive class instances.
- A hidden graph of scopes and references that is not a stable public format.

Even if you serialize `fn.toString()`, you have not captured its real module bindings, scope chain, imports, security properties, or a safe/equivalent way to evaluate it.

## What Qwik does instead

Qwik does **not** serialize arbitrary JavaScript functions in the ordinary sense. Its optimizer identifies specially marked closures, extracts their code into lazy-loadable symbols/chunks, and serializes a QRL-style reference to that code along with the captured values it needs. When resumed, the runtime lazy-loads the referenced symbol and restores its lexical scope.[^17_2]

The shape is approximately:

```ts
type SerializableClosure<Env> = Readonly<{
  code: {
    module: "./chunks/implementer-7ad1.js"
    symbol: "implementer"
    integrity: "sha256-..."
  }
  captures: Env
}>
```

```text
Normal JS closure:
  opaque code object + opaque engine scope
  ✗ generally serializable

Resumable closure:
  stable code reference + explicit serializable capture record
  ✓ serializable, if its capture record is serializable
```

Qwik’s documented model is that an application can be paused, serialized, moved to another VM, and resumed without replaying all application logic. It serializes listener references, component structure, and application state; it supports function closures only through QRLs.[^17_3]

## This is directly relevant to tiles

Your closure edge should **not** carry:

```ts
closure: (input) => { /* arbitrary in-memory function */ }
```

Instead, carry a resumable closure descriptor:

```ts
type TileClosure<Env> = Readonly<{
  kind: "closure"
  codeRef: Readonly<{
    package: "@your-org/agent-tiles"
    module: "agents/implement"
    export: "implementV3"
    version: "3.2.1"
    integrity: `sha256-${string}`
  }>
  environment: Env
}>
```

Then a tile is fully portable:

```ts
type OpenTile<Argument, Env, Result> = Readonly<{
  argument: Contract<Argument>
  closure: Contract<TileClosure<Env>>
  result: Contract<Result>
}>
```

Execution becomes:

```ts
async function invoke<A, Env, B>(
  closure: TileClosure<Env>,
  argument: A,
): Promise<B> {
  const mod = await loadVerifiedModule(closure.codeRef)
  return mod[closure.codeRef.export](argument, closure.environment)
}
```

Your artifact represents **what to load, what it is allowed to access, and the explicit values it captured**—not a JavaScript heap object.

## Serializable vs reference captures

A good closure format should distinguish values that are actually embedded from things that must be re-resolved.


| Captured item | Put directly in closure artifact? | Better representation |
| :-- | --: | :-- |
| Strings, numbers, booleans, JSON-like records | Yes | Inline value |
| Dates, maps, sets, URLs | Possibly | Canonical serialized representation |
| Prompt template/version | Yes | Content hash or versioned ID |
| Tool configuration | Yes | Validated declarative config |
| Repository snapshot | Usually no | Immutable content-addressed snapshot reference |
| Large index or embedding store | No | Index ID + version/snapshot reference |
| Secret/API key | Never | Secret capability reference resolved at execution |
| Database connection/client | No | Connection capability ID / service binding |
| Tool function | No | Tool ID plus granted capability |
| Human approval | Usually no | Signed approval/authorization record |
| Browser DOM node | Not for an agent system | Locator/reference valid only in its intended runtime |

Standard structured cloning supports a range of values but is neither “serialize all JavaScript objects” nor “serialize functions”; functions are explicitly unsupported.[^17_1]

## “Closure” becomes a manifest

For agent workflows, call the serializable object an **execution closure manifest**:

```ts
type ImplementationClosure = Readonly<{
  code: {
    id: "agent.implement"
    version: "3.2.1"
    digest: "sha256:..."
  }

  captures: {
    prompt: { id: "implement.patch"; version: 12 }
    repo: { commit: "8f3c...", pathScope: ["packages/api"] }
    model: { provider: "anthropic"; model: "..." }
    toolPolicy: {
      grants: ["repo.read", "shell.test"]
      denies: ["repo.write", "network.external"]
    }
    budget: { maxSteps: 12, maxCostUsd: 0.35 }
  }

  provenance: {
    createdBy: "workflow-planner@v1"
    createdAt: "2026-08-11T..."
  }
}>
```

That is:

- Serializable.
- Hashable and cacheable.
- Signable.
- Auditable.
- Resumable on another worker/machine.
- Safe to inspect before execution.
- Suitable as a triangular tile edge label.

It is also conceptually stronger than a normal closure: it makes the usually invisible lexical environment explicit and policy-governed.

## The Qwik-inspired insight

Qwik imposes a discipline: code that may cross a resumability boundary needs a stable code reference and serializable captures. Its optimizer handles extraction and restoration rather than trying to directly clone JavaScript execution state.[^17_2][^17_3]

For your system, make that discipline a type-level invariant:

```ts
type SerializableCapture =
  | JsonValue
  | ContentAddressedRef
  | CapabilityRef
  | SignedAuthorization
  | ClosureRef

type ClosureManifest = Readonly<{
  code: CodeRef
  captures: Record<string, SerializableCapture>
}>
```

Then reject arbitrary functions or live resources at tile construction time:

```ts
const isSerializableClosure = (
  value: unknown,
): value is ClosureManifest => {
  // Validate code ref, hashes, schema, and each capture category.
  return true
}
```

So: **closures are not generally serializable, but closure descriptors absolutely can be.** Qwik’s resumability is a strong precedent for treating a closure as `code reference + serializable captured environment`, which is almost exactly the form your fixed triangular tile system wants.
<span style="display:none">[^17_10][^17_11][^17_12][^17_13][^17_14][^17_15][^17_4][^17_5][^17_6][^17_7][^17_8][^17_9]</span>

<div align="center">⁂</div>

[^17_1]: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm

[^17_2]: https://qwik.dev/tutorial/qrl/optimizer/

[^17_3]: https://qwik.dev/docs/concepts/resumable/

[^17_4]: https://html.spec.whatwg.org/multipage/structured-data.html

[^17_5]: https://stackoverflow.com/questions/72115201/why-doesnt-structuredclone-copy-function-object

[^17_6]: https://biomejs.dev/linter/rules/use-qwik-valid-lexical-scope/

[^17_7]: https://mdn2.netlify.app/en-us/docs/web/api/structuredclone/

[^17_8]: https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone

[^17_9]: https://github.com/QwikDev/qwik/issues/4371

[^17_10]: https://qwik.dev/tutorial/props/closures/

[^17_11]: https://feature-sliced.design/vi/blog/qwik-resumability-explained

[^17_12]: https://mishrilalsahu.in.net/Blogs/qwik-js-tutorial-part-4-resumability-deep-dive

[^17_13]: https://blog.logrocket.com/qwik-adoption-guide/

[^17_14]: https://tech.sparkfabrik.com/en/blog/qwik-and-the-power-of-loaders-and-actions/

[^17_15]: https://www.youtube.com/watch?v=gT5NWKZZPQM


---

# How is this useful? Practically? Abstractly?

It is useful when **how an agent runs** matters as much as **what it receives**. A serializable closure turns an implicit, in-memory execution context into an explicit, portable, inspectable artifact.

For a simple pipeline, it is overkill. For a distributed, resumable, capability-controlled agent system, it gives you a concrete unit of deployment, approval, reuse, and audit.

## Practical value

Consider a normal agent invocation:

```ts
await implement(task)
```

Hidden inside `implement` may be:

- Model/provider settings.
- System prompt and agent version.
- Repository/workspace scope.
- Tool implementations and permission grants.
- Budget and timeout.
- Retrieval/index snapshot.
- Policies for writing, network access, and review.

A closure manifest exposes that context:

```ts
const closedImplementer = {
  code: "agent.implement@3.2.1",
  captures: {
    prompt: "implement-patch@12",
    repo: "repo://acme/api@8f3c1a",
    tools: ["repo.read", "shell.test"],
    policy: "propose-only",
    budget: { maxSteps: 12, maxUsd: 0.35 },
  },
}
```

Then:

```ts
await invoke(closedImplementer, taskSpec)
```

is a much more meaningful and portable operation.


| Practical problem | What a closure manifest gives you |
| :-- | :-- |
| Worker dies mid-workflow | Persist the closure + pending argument; resume elsewhere |
| Long-lived execution | Suspend at approval, quota, rate-limit, or human-review boundaries |
| Distributed workers | Send a declarative invocation package, not a process-local function |
| Reproducibility | Record exact code/version, prompt, model policy, repo snapshot, and inputs |
| Approval | Review the authority envelope before the agent receives a task |
| Caching | Reuse an already prepared/validated agent context |
| Debugging | Inspect the environment that actually influenced a result |
| Security | Explicitly grant capabilities rather than relying on ambient process access |
| Workflow synthesis | Match required closure contracts to agents that may legally perform work |

Qwik uses the browser-focused version of the same idea: it pauses application execution and serializes references/state so a later environment can resume without replaying all prior execution or loading all application logic. That architecture enables fine-grained lazy loading as a consequence.[^18_1]

For an agent platform, “resume in another VM” becomes:

```text
planner worker
    ↓ persists
closure manifest + TaskSpec + execution state
    ↓ resumes
remote worker / CI runner / developer machine / later session
```


## Concrete agent example

Suppose you want an agent to produce a patch.

Without explicit closure semantics:

```text
TaskSpec → ImplementAgent → Patch
```

That does not tell you whether the agent could read the repository, run tests, access the network, write branches, or which prompt/model version made the patch.

With a closure tile:

```text
ImplementationClosure! + TaskSpec?
                 \       /
                  \     /
                 [ Invoke ]
                     |
                  Patch!
```

The `ImplementationClosure` can be assembled once from policy-governed inputs:

```text
AgentDefinition? + RepoSnapshot? + ToolGrant? + Policy? + Budget?
                              ↓
                     ImplementationClosure!
```

In a triangle-only language, you would use a sequence of adapters/binders to construct that manifest progressively, or permit a closure record to aggregate multiple named captures.

Then the result’s provenance becomes a normal derivation:

```text
Patch
  ← Invoke(ImplementationClosure, TaskSpec)
  ← ImplementationClosure(
       agent version,
       prompt version,
       repo snapshot,
       tools,
       policy,
       budget
     )
```

This is analogous to software provenance, which records the builder, recipe, and input artifacts that produced an output.[^18_2]

## Abstract value

The abstraction is useful because it makes a distinction that ordinary diagrams collapse:

$$
\text{function behavior}
=
\text{code}
+
\text{captured environment}
$$

A normal arrow:

$$
A \to B
$$

hides the environment. Your tile makes it explicit:

$$
\langle \text{Code}, \rho \rangle \;:\; A \to B
$$

or, operationally,

$$
\rho? \otimes A? \to B!
$$

That has several consequences.

### Partial application becomes spatial

Binding an environment is partial application:

```ts
function implement(
  env: ImplementationEnvironment,
  task: TaskSpec,
): Promise<Patch> { /* ... */ }

const closedImplementer = implement.bind(null, env)
// TaskSpec -> Promise<Patch>
```

Your closure edge is the event of creating `closedImplementer`; the ordinary input edge is later invocation.

### Authority becomes lexical

A tile can only do what its closure captured.

```text
ReadOnlyRepoClosure + TaskSpec → ProposedPatch
WriteLeaseClosure  + Patch     → CommitReceipt
```

This is much stronger than a global “agent has tool access” model. A write-capable action is visibly downstream of a write-lease binding step.

### Reuse becomes explicit

The same closure can process many compatible arguments:

```text
ClosedTestRunner + PatchA → TestReportA
ClosedTestRunner + PatchB → TestReportB
ClosedTestRunner + PatchC → TestReportC
```

The closure acts like a stable, versioned worker configuration. The only caveat is that a literal edge-sharing tile lattice needs an explicit `fan-out`/reference tile to distribute immutable closure references.

### Deployment is part of composition

Ordinary FP often treats deployment as external to composition. This model allows:

```text
Build agent closure
  → sign / approve closure
  → persist closure
  → dispatch closure to allowed worker
  → invoke closure with an argument
```

The same semantics survive process, machine, and time boundaries.

## What it is not useful for

Do **not** use this just to replace ordinary functions.

```ts
const double = (x: number) => x * 2
```

Turning that into a serializable closure artifact adds complexity and no value. Also, the closure manifest does not automatically make results deterministic:

- An LLM can vary.
- Tool calls observe changing external state.
- A repository reference may point at a mutable branch.
- Time, randomness, and network responses matter.

It provides **replayability and explainability**, not guaranteed reproducibility, unless you also pin model versions, seeds where available, tool outputs, content-addressed inputs, and execution policy. Workflow provenance is valuable precisely because it captures both data and environment-level conditions.[^18_3][^18_4]

## The tile-specific payoff

For the triangular model, the closure idea gives each edge a durable role:

```text
Argument edge:  “What should be processed?”
Closure edge:   “Under what code, context, authority, and constraints?”
Result edge:    “What new artifact/evidence was produced?”
```

That is substantially more meaningful than merely assigning three arbitrary colors to three triangular edges.

The geometry is now expressing a real architectural invariant:

> An agent cannot execute merely because a task arrived. It executes only when a compatible, approved, portable operating closure has also been bound.

For your agent-framework work, that is the clearest payoff: the triangular tiles become a declarative **activation model** for distributed, resumable, auditable agents—not just an unusual visual notation for a DAG.
<span style="display:none">[^18_10][^18_11][^18_12][^18_13][^18_14][^18_15][^18_5][^18_6][^18_7][^18_8][^18_9]</span>

<div align="center">⁂</div>

[^18_1]: https://qwik.dev/docs/concepts/resumable/

[^18_2]: https://slsa.dev/spec/v0.1/provenance

[^18_3]: https://pmc.ncbi.nlm.nih.gov/articles/PMC5508699/

[^18_4]: https://reproducible-builds.org/docs/env-variations/

[^18_5]: https://ieeexplore.ieee.org/document/7160272/

[^18_6]: https://www.nature.com/nature-index/topics/l4/provenance-management-in-scientific-workflows

[^18_7]: https://jfrog.com/learn/grc/software-provenance/

[^18_8]: https://www.sciencedirect.com/science/article/pii/S0167739X24006484

[^18_9]: https://github.com/leptos-rs/leptos/issues/12

[^18_10]: https://blog.kubesimplify.com/what-is-reproducibility-and-why-does-it-matter

[^18_11]: https://almaswebconsulting.com/qwik-framework-symbolizing-resumability-serialization/

[^18_12]: https://nesbitt.io/2026/02/24/reproducible-builds-in-language-package-managers.html

[^18_13]: https://www.edgeless.systems/blog/reproducible-builds-for-confidential-computing

[^18_14]: https://www.reddit.com/r/qwik/comments/1166vup/resumability_as_temporary_layout_store/

[^18_15]: https://mishrilalsahu.in.net/Blogs/qwik-js-tutorial-part-4-resumability-deep-dive


---

# Would it then be useful to create larger collections of triangles as shapes

Yes. Larger collections of triangles are likely where this becomes genuinely useful: they can form **macro-closures**—composite regions that hide internal assembly while exposing the same simple external contract:

$$
\text{argument}? \;\otimes\; \text{closure}? \longrightarrow \text{result}!
$$

The small triangles give local legality; the larger shape gives a meaningful reusable operation.

## The key rule

A shape should be promotable to a reusable “super-tile” only when all of its internal edges are satisfied and its remaining boundary can be summarized as a stable interface.

```text
Inside:  many tiles, intermediate artifacts, policy checks, tools
Outside: one argument port + one closure port + one result port
```

```text
               Result!
                  ▲
        ┌─────────────────┐
        │  composite      │
Argument?│  closure region │Closure?
        │                 │
        └─────────────────┘
```

This is exactly the workflow-subgraph idea: package a complex internal workflow behind explicit inputs and outputs, then reuse it as a higher-level unit. Workflow systems use subgraphs for this kind of encapsulation and reuse.[^19_1]

## Macro-closure examples

### Prepared agent

A simple `Invoke` triangle needs a closure manifest. But constructing that manifest may itself be a region:

```text
AgentDefinition?
      \
       ── [ resolve prompt version ] ──┐
RepoSnapshot?                           │
      \                                 ├─ [ bind ] ─► ClosedAgent!
ToolPolicy?                              │
      /                                 │
Budget? ── [ validate policy ] ─────────┘
```

Externally, hide that as:

```text
AgentSpec? + ExecutionContext? → ClosedImplementer!
```

The macro guarantees that its output is not merely “an object that looks like an agent,” but a verified, immutable, capability-scoped closure.

### Safe agent invocation

The externally simple operation:

```text
TaskSpec? + ClosedImplementer? → VerifiedPatch!
```

may contain:

```text
TaskSpec? ── validate schema ──┐
                               ├─ invoke agent ── validate patch ──► VerifiedPatch!
ClosedImplementer? ── verify ──┘
                     authority
```

Internally it can:

- Check input schema and task scope.
- Verify the closure’s code hash and policy.
- Obtain only the capabilities granted by the closure.
- Invoke the agent.
- Run deterministic validation/tests.
- Attach provenance and a receipt.
- Return a result only if its advertised contract holds.

This region can be a standard reusable shape, such as `SafeInvocation`.

### Human approval boundary

```text
ProposedPatch? + ApprovalPolicyClosure? → ApprovedPatch!
```

Internally:

```text
ProposedPatch
  → policy evaluation
  → human review request
  → wait/resume
  → signed approval verification
  → ApprovedPatch
```

That is a particularly good macro because it may suspend for hours or days, while retaining a serializable execution state. Resumability-style architectures are designed around pausing, serializing the necessary references/state, and later resuming without replaying all previous execution.[^19_2]

## Shapes can encode architectural roles

Do not let shapes be arbitrary visual grouping. Give each recurrent footprint a semantic category.


| Shape class | External interface | Meaning |
| :-- | :-- | :-- |
| Atomic triangle | `Argument? + Closure? → Result!` | One closed operation invocation |
| Binding region | `Definition? + Environment? → Closure!` | Construct/prep an executable closure |
| Validation region | `Candidate? + ValidatorClosure? → Evidence!` | Establish whether a claim/result is acceptable |
| Effect region | `AuthorizedRequest? + EffectClosure? → Receipt!` | Controlled write, deployment, notification, or tool call |
| Recovery region | `Failure? + RecoveryClosure? → NextAction!` | Retry, repair, escalate, or replan |
| Capsule | `Argument? + Closure? → Result!` | A whole workflow presented as one reusable operation |

This naturally produces **hierarchical tiling**:

```text
Workflow capsule
  └── Safe invocation capsule
        ├── Agent invocation triangle
        ├── Test-runner triangle
        └── Provenance/validation triangles
```

Hierarchical assembly is an established idea in tile-assembly research: assemblies composed of multiple tiles can themselves aggregate as larger assemblies.[^19_3][^19_4]

## Preserve the three-port interface

A composite region may physically have a messy boundary with many triangle edges. Do not expose every physical edge as part of its API.

Instead, define **logical boundary ports** that may span one or more physical boundary edges:

```ts
type MacroTile<A, Env, B> = Readonly<{
  shape: ReadonlyArray<TrianglePlacement>

  interface: {
    argument: BoundaryPort<A, "requires">
    closure: BoundaryPort<Env, "requires">
    result: BoundaryPort<B, "provides">
  }

  internal: ReadonlyArray<InternalTile>
  guarantees: readonly Invariant[]
}>
```

For example, an entire side of a diamond-like region might be one logical `closure` interface even though it consists of several elementary triangle edges.

The macro’s external interface remains compact:

```text
Argument? + Closure? → Result!
```

while its physical shape can encode implementation complexity, capacity, stage boundaries, or internal parallelism.

## The important abstraction

This creates two levels:

```text
Micro level:
  Triangle edges prove local compatibility.

Macro level:
  Regions prove a higher-level behavioral contract.
```

That gives you a route from low-level tile calculus to an ergonomic workflow language.

A user would compose:

```ts
safeImplement
  .then(runFocusedTests)
  .then(requestReview)
  .then(applyApprovedPatch)
```

while the compiler/runtime expands each operation into a verified triangle region with closure binding, policy enforcement, and artifact provenance.

## Don’t promote every pattern

A region should become a macro only if it has:

1. **A stable interface** — clear argument, closure, and result contracts.
2. **Internal closure** — no accidental leaking of intermediate artifacts or capabilities.
3. **A named guarantee** — e.g. “result tested,” “write approved,” “repository scope bounded.”
4. **A repeatable implementation** — useful in multiple workflows or worth independently versioning.
5. **A clear failure contract** — either structured result/error output or a known recovery boundary.

For your system, the highest-value initial shapes would be:

```text
BindClosure
SafeInvoke
Validate
Approve
Effect
Recover
```

Then the tile framework is not trying to visually replace all workflow graphs. It becomes a **language for safely packaging agentic subgraphs into portable, resumable, capability-scoped closure capsules**.
<span style="display:none">[^19_10][^19_11][^19_12][^19_13][^19_14][^19_15][^19_16][^19_5][^19_6][^19_7][^19_8][^19_9]</span>

<div align="center">⁂</div>

[^19_1]: https://docs.comfy.org/interface/features/subgraph

[^19_2]: https://qwik.dev/docs/concepts/resumable/

[^19_3]: https://arxiv.org/abs/1104.5226

[^19_4]: http://self-assembly.net/wiki/index.php/Abstract_Tile_Assembly_Model_(aTAM)

[^19_5]: http://www.cse.cuhk.edu.hk/~cwfu/papers/archive/textile.pdf

[^19_6]: https://scholarworks.utrgv.edu/cgi/viewcontent.cgi?article=2047\&context=etd

[^19_7]: https://www.reddit.com/r/comfyui/comments/1l3xn1m/comfyui_subgraphs_are_a_gamechanger_so_happy_this/

[^19_8]: https://dev.to/n3wt0n/composite-actions-vs-reusable-workflows-what-is-the-difference-github-actions-11kd

[^19_9]: https://www.linkedin.com/posts/comfyui_subgraphs-are-coming-to-comfyui-weve-been-activity-7336364928582209539-MEyR

[^19_10]: https://www.reddit.com/r/comfyui/comments/1mk1svq/subgraph_is_now_in_comfyui/

[^19_11]: https://pmc.ncbi.nlm.nih.gov/articles/PMC3513920/

[^19_12]: https://www.nature.com/articles/s41598-023-31786-3

[^19_13]: https://en.wikipedia.org/wiki/Wang_tile

[^19_14]: https://ir.canterbury.ac.nz/items/9d2f94eb-705c-43ef-8fda-e9c618f21c3e

[^19_15]: https://www.youtube.com/watch?v=34qjSyDc-8s

[^19_16]: https://www.dna.caltech.edu/courses/cs191/paperscs191/patitz2013review_NatComp.pdf


---

# Is any of this unexplored territory in math?

Probably **not at the level of its ingredients**, but possibly at the level of the exact synthesis you are forming.

The core mathematics already exists: triangular edge-matching systems, self-assembly, typed multi-input/single-output composition, wiring diagrams, closure conversion, capability systems, and workflow/dataflow semantics all have mature bodies of work. Triangular tile-assembly systems in particular have been studied formally and are computationally universal.[^20_1][^20_2]

What may be relatively unexplored is a unified formalism for:

> **fixed-orientation triangular tiles whose asymmetric ports represent serializable closures, invocation arguments, and results, with capability/provenance-aware matching and hierarchical workflow capsules.**

I would call that an open **design-and-formalization space**, rather than claim it is wholly new mathematics.

## What is already known

| Your idea | Closest established area | What is already well developed |
| :-- | :-- | :-- |
| Fixed triangular edge-matching tiles | Triangular tile assembly / generalized Wang-style systems | Glues, orientation, assembly, expressiveness, simulation, decidability/complexity questions [^20_2][^20_1] |
| `A × B → C` operations | Typed operads, multicategories, monoidal categories | Multi-input operations, nesting, composition, substitution [^20_3][^20_4] |
| Shapes made of smaller shapes | Hierarchical self-assembly, operads, macrotiles | Composition of assemblies; nested reusable structures [^20_5][^20_6] |
| Ports with compatibility rules | Wiring diagrams / hypergraph categories | Typed interfaces, composition, black-boxing subsystems [^20_7][^20_8] |
| Code plus captured environment | Closure conversion | Explicit closure environments and code references [^20_9][^20_10] |
| Input/output polarity | Linear logic, session types, process calculi | Dual endpoints, safe protocols, resource-sensitive composition |
| Agent execution graph | Dataflow / workflow systems | Nodes as operations, edges as dependencies, concurrent firing [^20_11][^20_12] |
| Capability-bearing environment | Capability security | Explicit authority rather than ambient authority [^20_13] |

So, “triangles compose functions” is not new; typed operads already model operations of the form:

$$
f : (A_1,\ldots,A_n) \to B
$$

and explicitly support substituting a whole sub-operation into an input of another operation.[^20_3][^20_4]

## The unusual part

Your proposed primitive is more specific:

$$
\operatorname{Invoke} :
\underbrace{\operatorname{Closure}\langle E, A, B\rangle}_{\text{code + environment}}
\otimes
\underbrace{A}_{\text{argument}}
\longrightarrow
\underbrace{B}_{\text{result}}
$$

with a closure represented as a portable artifact:

$$
\operatorname{Closure}\langle E,A,B\rangle
=
(\operatorname{CodeRef}, E, \operatorname{Policy}, \operatorname{Capabilities}, \operatorname{Provenance})
$$

That is a compelling specialization because it combines several distinctions normally handled in separate layers:

```text
Programming-language layer:      closure conversion
Distributed-systems layer:       serialization and dispatch
Security layer:                  capability binding
Workflow layer:                  scheduling and dependencies
Provenance layer:                reproducibility and audit
Tiling layer:                    local adjacency constraints
```

The novelty would be in making them all one **local edge contract** and then giving assemblies a rigorous semantics.

## Where actual math could emerge

To become a mathematical theory rather than an architecture metaphor, you would need definitions and nontrivial results.

### 1. Define the tile algebra

For example, define a finite typed tile set:

$$
T = (K, P, \mathsf{match}, \mathsf{run})
$$

where:

- $K$ is a finite set of fixed-orientation triangle kinds.
- $P$ is a set of port contracts.
- $\mathsf{match} : P_{\text{out}} \times P_{\text{in}} \to \{\top,\bot\}$ defines legal attachment.
- $\mathsf{run}$ gives each executable tile an operational meaning.

A port could be:

$$
p =
(\text{role},\text{polarity},\text{schema},\text{provenance},\text{capabilities},\text{policy})
$$

```ts
type Port = {
  role: "argument" | "closure" | "result"
  polarity: "requires" | "provides"
  schema: SchemaRef
  provenance: ProvenanceRequirement
  capabilities: CapabilitySet
  policy: PolicyRef
}
```

Classical Wang tiling is the strict special case where ports are just colors and matching means equality.[^20_14][^20_15]

### 2. Give assemblies a denotational meaning

A valid region should compile into an ordinary workflow meaning:

$$
\llbracket R \rrbracket :
(\text{external arguments}, \text{external closures})
\to
(\text{external results})
$$

Then prove a **compositionality** property:

$$
\llbracket R_2 \circ R_1 \rrbracket
=
\llbracket R_2 \rrbracket \circ \llbracket R_1 \rrbracket
$$

This is where operads and wiring-diagram semantics are likely the right mathematical home. They are expressly designed for systems represented as boxes with typed ports and nested compositions.[^20_4][^20_7]

### 3. Formalize closure binding

The distinctive operation is:

$$
\operatorname{bind} :
\operatorname{Code}\langle E,A,B\rangle
\times E
\to
\operatorname{Closed}\langle A,B\rangle
$$

followed by:

$$
\operatorname{invoke} :
\operatorname{Closed}\langle A,B\rangle
\times A
\to
B
$$

You could ask whether a spatial assembly has a normal form:

```text
bind code/environment first
then invoke closed operations on arguments
```

If every valid assembly can be normalized into a closure-binding stage and an argument-flow stage—without changing observable results—that would be a real theorem and an operationally useful compiler property.

### 4. Add authority as a resource

This is potentially the strongest research direction.

Most workflow systems say:

```text
agent has permissions
```

Your tiles could instead express:

$$
\operatorname{WriteLease}? \otimes \operatorname{ApprovedPatch}?
\to \operatorname{CommitReceipt}!
$$

Then prove an authority-safety property:

> No assembly can produce a `CommitReceipt` unless there is a boundary input or valid internally derived source of `WriteLease`.

That is structurally similar to resource-sensitive / linear-type reasoning, but applied to serializable closure manifests and workflow topology.

You could similarly state:

- A network-enabled result requires a network capability in the ancestry of its closure.
- A repository write requires a valid unconsumed write lease.
- An externally published artifact has a provenance path to an approval/authorization source.
- A closure may not gain capabilities through arbitrary artifact flow.

Those are genuine, checkable safety properties—not merely diagram conventions.

### 5. Define macro-shape equivalence

Suppose a large triangle collection is encapsulated as a macro tile:

```text
SafeImplement :
  TaskSpec? + ImplementationClosure? → VerifiedPatch!
```

When may it replace another assembly with the same boundary interface?

Possible equivalence strengths:


| Equivalence | Meaning |
| :-- | :-- |
| Interface equivalence | Same boundary port contracts |
| Behavioral equivalence | Same output behavior for equivalent arguments/closures |
| Trace equivalence | Same externally observable tool calls, messages, and effects |
| Capability equivalence | Requires/provides the same authority resources |
| Provenance equivalence | Produces equivalent derivation/evidence records |
| Cost equivalence | Same or bounded execution/capability cost |

A theory of safe macro-tile substitution would make large workflow capsules composable without inspecting their internals.

## Likely contribution area

The most promising claim would not be:

> “I invented triangular computation tiles.”

That would be hard to sustain; tile computation and multi-input composition are well established. Triangular tile systems already have formal expressiveness results, including distinctions from square and hexagonal systems under particular simulation conditions.[^20_16][^20_1]

A more defensible contribution would be:

> “A compositional, closure-aware, capability-safe workflow calculus with triangular local interfaces; a compilation from valid assemblies to executable dataflow graphs; and proofs of authority/provenance safety under macro composition.”

That is an intersection of existing subjects where the exact formulation, practical toolchain, and theorems may be genuinely underdeveloped.

## A productive research program

1. **Start operationally.** Implement a bounded triangular-layout DSL whose output is a typed workflow graph.
2. **Keep contracts finite.** Use schema IDs, capability IDs, policy IDs, and immutable artifact references—not arbitrary TypeScript subtyping or unconstrained predicates.
3. **Define only three initial tile kinds.**
    - `Bind`: `Code? + Environment? → Closure!`
    - `Invoke`: `Closure? + Argument? → Result!`
    - `Validate`: `ValidatorClosure? + Candidate? → Evidence!`
4. **Define macro regions.** Give each a three-port external interface and a manifest of guarantees.
5. **Prove basic invariants.**
    - Well-typed attachment safety.
    - Closure manifests are serializable.
    - No effect tile runs without the required authority edge.
    - A macro substitution preserving its interface and guarantees preserves outer validity.
6. **Only then investigate expressiveness.**
    - What finite tile set can synthesize what classes of workflow?
    - When does bounded workflow synthesis become SAT/CSP/ILP?
    - When is it decidable?
    - What does the spatial restriction buy you over typed hypergraphs?

So: the mathematical objects around your idea are familiar, but the exact blend of **spatial closure binding, serializable execution manifests, capability flow, and hierarchical agent-workflow synthesis** could be fertile territory—especially if you turn its invariants into formal definitions and theorems.
<span style="display:none">[^20_17][^20_18][^20_19][^20_20][^20_21][^20_22]</span>

<div align="center">⁂</div>

[^20_1]: https://arxiv.org/abs/1002.4996

[^20_2]: https://www.csd.uwo.ca/~lkari/pdfs/trihex_small.pdf

[^20_3]: https://pmc.ncbi.nlm.nih.gov/articles/PMC8299556/

[^20_4]: https://dspivak.net/talks/pdfs/20171002-mcgill.pdf

[^20_5]: https://pmc.ncbi.nlm.nih.gov/articles/PMC3513920/

[^20_6]: https://arxiv.org/abs/1104.5226

[^20_7]: http://www.tac.mta.ca/tac/volumes/30/51/30-51.pdf

[^20_8]: https://math.libretexts.org/Bookshelves/Applied_Mathematics/Seven_Sketches_in_Compositionality:_An_Invitation_to_Applied_Category_Theory_(Fong_and_Spivak)/06:_Circuits_-_Hypergraph_Categories_and_Operads/6.05:_Operads_and_their_algebras

[^20_9]: https://arxiv.org/abs/2507.15843

[^20_10]: https://matt.might.net/articles/compiling-scheme-to-c/

[^20_11]: https://www.cs.colostate.edu/cameron/dataflow.html

[^20_12]: https://www.sigops.org/2020/the-remarkable-utility-of-dataflow-computing/

[^20_13]: https://en.wikipedia.org/wiki/Capability-based_security

[^20_14]: https://pmc.ncbi.nlm.nih.gov/articles/PMC10039085/

[^20_15]: https://en.wikipedia.org/wiki/Wang_tile

[^20_16]: https://research.google/pubs/triangular-and-hexagonal-tile-self-assembly-systems/

[^20_17]: https://ocw.mit.edu/courses/18-s097-applied-category-theory-january-iap-2019/63f5a5f9dcb83726256388ea83f91396_18-s097iap19ch6.pdf

[^20_18]: http://people.cs.umass.edu/brun/pubs/pubs/Brun07fnano.pdf

[^20_19]: https://mathoverflow.net/questions/157239/computational-approach-deciding-whether-a-set-of-wang-tile-could-tile-the-space

[^20_20]: https://ir.canterbury.ac.nz/items/9d2f94eb-705c-43ef-8fda-e9c618f21c3e

[^20_21]: https://www.advancesincombinatorics.com/article/18614-an-aperiodic-set-of-11-wang-tiles

[^20_22]: https://www.dna.caltech.edu/Papers/SAshapes_arxiv.pdf


---

# What might we use this to study? What types of results would we look for?

You could use it to study **how much safety, compositionality, and synthesizability you can obtain from local workflow rules**.

The central hypothesis would be:

> If every agent action is a closure-bound operation, and every neighboring tile handoff is locally valid, can we derive useful global guarantees about authority, provenance, execution, and workflow structure?

That is more interesting than studying tilings for their own sake.

## The research objects

A closure-aware triangular assembly would have three layers:

$$
\text{geometry}
+
\text{contracts}
+
\text{execution semantics}
$$

```text
Geometry:
  Which fixed-orientation triangles may physically meet?

Contracts:
  Does this result satisfy that argument requirement?
  Does this closure provide the needed authority/policy/environment?

Execution:
  What does a ready tile do?
  What artifact, receipt, evidence, or failure does it emit?
```

You could then ask questions at several levels.


| Level | Question |
| :-- | :-- |
| Local | Is this edge attachment well typed, authorized, and protocol-compatible? |
| Regional | Does this macro-shape implement its declared interface and guarantees? |
| Global | Can the whole assembly achieve the requested output from available boundary inputs? |
| Operational | Which tiles are eligible to execute, in what order, and with what concurrency? |
| Security | Can an unauthorized assembly ever produce a write, deployment, or publication receipt? |
| Provenance | Can every output be traced to code, closure, inputs, tools, and approvals? |
| Optimization | Which valid assembly is cheapest, fastest, safest, or most reproducible? |

## Safety results

This is likely the best initial target because the guarantees are meaningful even if an LLM is unreliable.

You cannot prove that an LLM’s patch is semantically correct just because a tile matched. But you *can* prove that certain unsafe actions are impossible in any valid assembly.

### Authority confinement

Define effectful output types:

```ts
type CommitReceipt = {
  commit: GitCommitRef
  signer: Signature
}
```

Define the only producer:

```text
ApprovedPatch? + RepositoryWriteLease? → CommitReceipt!
```

Then aim for an **authority-confinement theorem**:

$$
\text{If an assembly produces } \operatorname{CommitReceipt},
\text{ then its boundary or derivation contains a valid WriteLease.}
$$

In plain language:

> No sequence of composition, macro expansion, or agent planning can manufacture repository-write authority from ordinary data.

That is a strong property for agent systems. It applies to:

- Repository writes.
- Deployment.
- Secret access.
- Payments/purchases.
- Emails or public posts.
- Database mutations.
- Production shell execution.


### Non-escalation

A second theorem could be:

$$
\operatorname{Capabilities}(\text{result})
\subseteq
\bigcup \operatorname{Capabilities}(\text{input closures})
$$

unless an explicit authorization/binding tile introduces a new signed capability.

In other words:

> A tile may use authority it received; it cannot silently invent stronger authority.

This is the tile-language version of capability safety.

### Effect isolation

Separate proposal from effect:

```text
Task? + ReadOnlyClosure?       → ProposedPatch!
ProposedPatch? + WriteLease?   → CommitReceipt!
```

Then prove:

- Read-only closures can never directly create a commit.
- A patch artifact is not itself authority.
- Approval and write authority cannot be inferred from text generated by an agent.

Those are much more practical guarantees than “the agent is safe.”

## Workflow synthesis results

The next question is whether you can **find** a valid assembly.

Given:

```text
Available:
  TaskSpec!
  RepoSnapshot!
  ReadOnlyRepoCapability!
  TestPolicy!
  WriteLease!

Goal:
  CommitReceipt!
```

Find a bounded assembly using a finite tile library:

```text
Plan
Implement
Validate
Test
Review
Approve
Apply
Recover
```

A solver might synthesize:

```text
TaskSpec + RepoSnapshot
       ↓
      Plan
       ↓
   ProposedPatch
       ↓
      Test
       ↓
  TestedPatch
       ↓
     Review
       ↓
  ApprovedPatch + WriteLease
       ↓
      Apply
       ↓
  CommitReceipt
```

The research questions become:


| Result type | Example question |
| :-- | :-- |
| Feasibility | Does any valid bounded assembly produce `CommitReceipt`? |
| Reachability | Can goal $G$ be obtained from boundary inputs $I$? |
| Synthesis | Construct the smallest/cheapest valid assembly |
| Optimization | Minimize LLM calls, cost, latency, authority, or trusted-code footprint |
| Repair | Given a failed assembly, find the smallest replacement region |
| Explanation | Produce the derivation that proves why the chosen workflow is valid |

Tile and self-assembly theory already studies related “can this assembly be produced?” and “does this system uniquely produce a target?” problems, with nontrivial complexity results. Prebuilt composite assemblies can substantially change the complexity of producibility and uniqueness verification.[^21_1][^21_2]

Your novel version would make the target a **workflow outcome plus safety constraints**, rather than a geometric shape.

## Modularity results

Macro-shapes let you study when a whole workflow region can safely be replaced by another.

Suppose both regions expose:

```text
TaskSpec? + ImplementationClosure? → VerifiedPatch!
```

But one does:

```text
plan → implement → typecheck → tests → provenance receipt
```

and the other does:

```text
retrieve exemplar → implement → tests → provenance receipt
```

You can define replacement relations:


| Relation | Required claim |
| :-- | :-- |
| Interface-compatible | Both accept and emit compatible boundary contracts |
| Authority-preserving | Replacement needs no more authority than the original |
| Guarantee-refining | Replacement emits a result with equal or stronger evidence |
| Behaviorally equivalent | Same observable result for the same inputs |
| Trace-equivalent | Same externally visible effects/tool calls |
| Cost-refining | Replacement is no more expensive or slower under a chosen model |

Then seek a **macro substitution theorem**:

$$
R \simeq R'
\implies
C[R] \simeq C[R']
$$

Meaning: if two regions are equivalent under the chosen relation, replacing one with the other inside any valid outer context preserves the relevant guarantees.

That would let you version or optimize workflow capsules without re-proving every larger workflow from scratch.

## Closure and resumability results

The closure approach gives you a useful distributed-systems research angle.

A serializable closure manifest can be viewed as:

$$
\operatorname{Closure}
=
(\operatorname{CodeRef}, \operatorname{CapturedEnv}, \operatorname{Authority}, \operatorname{Policy})
$$

Then study:

### Resume correctness

If a worker pauses before invocation, serializes the closure/argument/execution state, and resumes on another worker:

$$
\operatorname{resume}(\operatorname{serialize}(S))
\approx S
$$

What does $\approx$ mean?

- Same code version.
- Same permitted capabilities.
- Same pinned repository/index snapshots.
- Same policy and budget.
- Same eventual effect behavior, subject to explicitly modeled nondeterminism.

This is inspired by resumability architectures, where state and code references are preserved so later execution does not need to recreate all prior runtime state.[^21_3]

### Replay classes

You can classify tiles:


| Tile class | Replay expectation |
| :-- | :-- |
| Pure deterministic | Same closure + argument produces byte-identical result |
| Snapshot deterministic | Same result if referenced artifacts are pinned |
| Nondeterministic but auditable | Re-execution may differ; captured trace/provenance explains actual run |
| Effectful idempotent | Safe to retry with an idempotency key |
| Effectful non-idempotent | Requires a durable receipt and exactly-once/approval protocol |

That taxonomy is useful for an agent runtime, because it tells the scheduler whether retries, caching, speculative execution, and migration are legal.

## Provenance results

Your model naturally emits a provenance graph, but with stronger structure than an ad hoc log:

```text
Result
  ← invocation
      ← closure manifest
          ← code digest
          ← policy binding
          ← capability grants
          ← repo/index snapshots
      ← argument artifact
      ← tool receipts / validation evidence
```

Provenance systems already use graphs to explain, reproduce, verify, and share workflow results; standards such as W3C PROV define provenance in terms of entities and processes that produced or influenced a resource.[^21_4][^21_5]

Your research questions could be:

- Can provenance be reconstructed uniquely from a completed assembly?
- Can an output be accepted only if it has a path to required evidence?
- Can you query for all outputs influenced by a compromised model/prompt/tool version?
- If a capability or policy is revoked, which closure assemblies become invalid?
- Can you compute the smallest trusted subset of tiles needed to trust a final result?

That last one is especially useful for agentic code changes:

```text
Which exact tools, prompts, validators, approvals, and repository states
must I trust to accept this commit?
```


## Concurrency and determinism results

Because tiles become eligible when closure and argument contracts are bound, you can ask whether scheduling order changes the outcome.

A useful property would be **confluence**:

$$
R \to^* R_1
\land
R \to^* R_2
\implies
\exists R_3 :
R_1 \to^* R_3
\land
R_2 \to^* R_3
$$

Informally:

> If several independent ready tiles run in different orders, they eventually yield equivalent observable results.

You will not get this for arbitrary LLMs or side effects. But you might obtain it for:

- Pure tiles.
- Immutable artifact flow.
- Idempotent effect tiles.
- Linear capability resources.
- Explicitly commutative/independent macro regions.

That gives you a principled basis for parallel execution rather than “run everything concurrently and hope.”

## Empirical results

The theory should be tested against a concrete workload, perhaps a repository-maintenance benchmark:

```text
Issue → Plan → Patch → Tests → Review → Approved Commit
```

Compare:


| Measure | Tile/closure calculus | Conventional agent DAG |
| :-- | --: | --: |
| Unauthorized write attempts blocked before execution |  |  |
| Invalid handoffs detected statically |  |  |
| Resumable runs after worker failure |  |  |
| Reused/cached closures |  |  |
| Provenance completeness |  |  |
| Workflow-synthesis time |  |  |
| Average LLM/tool cost |  |  |
| Human ability to audit a final effect |  |  |

The target is not necessarily to beat a DAG runtime on raw throughput. The target is to demonstrate better **compositional safety, auditability, and synthesis constraints**.

## A realistic first paper-sized result

A narrow, defensible result might be:

> A fixed-orientation triangular workflow calculus with `Bind`, `Invoke`, `Validate`, and `Effect` tiles; a compiler to a typed dataflow graph; and proofs that well-formed assemblies cannot emit externally effectful receipts without an explicit capability-bearing closure path.

Then demonstrate:

1. Closure manifests are serializable and hashable.
2. Macro tiles preserve external contracts.
3. Capability non-escalation holds under composition.
4. Bounded synthesis can find a safe workflow or explain why none exists.
5. The system recovers/resumes after worker loss without re-authorizing or widening authority.

That would be useful mathematics *and* a practical architecture—while being honest about the boundary: the system proves properties of the **workflow’s structure, authority, provenance, and execution discipline**, not that an LLM’s natural-language reasoning is correct.
<span style="display:none">[^21_10][^21_11][^21_12][^21_13][^21_14][^21_15][^21_16][^21_6][^21_7][^21_8][^21_9]</span>

<div align="center">⁂</div>

[^21_1]: https://www.sciencedirect.com/science/article/abs/pii/S0022000023000296

[^21_2]: https://drops.dagstuhl.de/opus/volltexte/2022/15950/pdf/LIPIcs-SAND-2022-8.pdf

[^21_3]: https://qwik.dev/docs/concepts/resumable/

[^21_4]: https://pmc.ncbi.nlm.nih.gov/articles/PMC11380065/

[^21_5]: https://www.cs.ucdavis.edu/~ludaesch/pubs/Efficiently-querying-provenance-EDBT-2010.pdf

[^21_6]: https://dl.acm.org/doi/10.1145/2110497.2110512

[^21_7]: https://www.electronicdesign.com/technologies/embedded/software/article/55372354/trustinsoft-why-formal-verification-matters-in-safety-and-security-critical-software

[^21_8]: http://theory.stanford.edu/~gagan/papers/assembly_SODA.pdf

[^21_9]: https://www.secoda.co/blog/workflow-provenance-in-data-management

[^21_10]: https://pqshield.com/formal-verification-why-it-matters/

[^21_11]: https://verificationacademy.com/topics/formal-verification/

[^21_12]: https://www.emergentmind.com/topics/provenance-tracking-in-agentic-workflows

[^21_13]: https://www.lesswrong.com/posts/B2bg677TaS4cmDPzL/limitations-on-formal-verification-for-ai-safety

[^21_14]: https://users.cs.northwestern.edu/~schwellerr/papers/CGM_siam.pdf

[^21_15]: https://www.trust-in-soft.com/resources/blogs/how-formal-methods-improves-the-verification-of-safety-critical-systems

[^21_16]: https://scholarworks.utrgv.edu/cgi/viewcontent.cgi?article=2047\&context=etd

