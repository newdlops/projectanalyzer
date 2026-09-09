# Local neural scenario inference

## Parameter inference — September 10, 2026 (v4)

The 0.0.1095 pipeline missed all six newly reproduced target cases below. Two
Python strings exceeded the feature cap, Python numeric constants did not expand
the input domain, declared integers were sampled as floats, composed strings lacked
connected pieces, and newly reached inner comparisons were never learned.

`Local MLP · v4` shares a cached text-feature budget across parameters, propagates
Python comparison evidence through assignments and same-file helpers, and ranks
joint categorical inputs with learned predictions. Up to three adaptive stages
collect and learn newly reached comparisons. Coordinates fixed among reached
training tuples preserve successful outer guards; new prefixes receive enough
mutations for both fitting and held-out checks. Power-of-two numeric normalization
also avoids changing `31` into `31.000000000000004` or rounding fractional guards.

The committed diagnostic corpus now has 18 programs, with 16 checked targets found.
The original ten successes remain; modulo still fails the quality gate and external
state still lacks supported labels. New cases use the same 1,400-evaluation ceiling:

| New diagnostic | 0.0.1095 target | v4 target | Held-out MAE, untrained → trained | Teacher checks |
| --- | --- | --- | --- | --- |
| Python large integer | Missed | Found | 0.783 → 0.018 | 415 |
| Two Python strings | Missed | Found | 0.833 → 0.036 | 648 |
| Python derived string | Missed | Found | 0.896 → 0.008 | 154 |
| Python integer loop | Missed | Found | 0.794 → 0.058 | 236 |
| Nested derived equalities | Missed | Found, both decisions | 0.735 → 0.012 | 604 |
| Composed TypeScript string | Missed | Found | 0.742 → 0.041 | 649 |

Uniform random sampling over the improved codec also finds the large-integer,
derived-string and integer-loop targets. It misses the other three new targets
with this seed and budget. All untrained runs retain the quality gate and return
zero pairs. Candidate generation, adaptive sampling and trained ranking changed
together, so this is a diagnostic improvement, not isolated proof of neural
superiority or general branch coverage. Unit regressions use different constants
and strings, three nested guards, a fractional outer guard, and 16 text parameters.

Rendered QA also exposed a TS/JS presentation gap: attaching planned condition
labels discarded the concrete-result marker, hiding an already computed return.
Matched paths now keep that marker only when replay finishes exactly within its
budget. Partial paths remain nonconcrete. Both sides of the three-level equality
show their calculated return in the scenario explanation.

### Verification record — 0.0.1096

- Full TypeScript suite: 707 tests, 703 passed. The same four existing failures
  remain: dynamic callsite type baseline, nested declared-object representatives,
  advanced private Scenario calls and source-reveal architecture expectations.
  All new parameter/replay regressions passed. Package tools: 12 passed. Compilation,
  whitespace and release metadata checks passed. The VSIX has 445 files, 3.27 MiB
  archived and 13.73 MiB unpacked, within the unchanged package budgets.
- Actual generated webview and real local inference at 1440×900, 768×1024 and
  390×844: two Python arguments reach `Token` / `access.key`; three nested TS
  comparisons reach `37, 31, 17`, with the checked neighbor `37, 31, 16` also
  explained. First-click training/application, pending state, keyboard activation,
  completion focus, concrete returns, explicit application and playback passed.
  Document/detail overflow and page errors: none. Desktop/tablet/mobile rendered
  screenshots were separately inspected; existing tokens and layouts are retained.
- Python regex/checksum regression at the same sizes retained nonempty duplicate
  inputs, concrete array changes and returns. Concurrent edits were preserved;
  cancellation retained the original input. Page errors: none. The in-app Browser
  had no connection; standalone Chromium replaced only VS Code message transport.
  No screen-reader or new specialist accessibility audit is claimed.
- The 0.0.1096 VSIX was installed in official VS Code and the previously reported
  function's workspace reloaded. Its first recommendation click applied a checked
  labeled multiline input, added seven accepted cases and displayed the expected
  two-item return. The installed model reported `Local MLP · v4`, 235 fitting and
  58 held-out samples with normalized error 0.137. The rendered installed view
  was inspected separately. The private source and screenshot are not committed.

## Python and first-click recommendations — September 10, 2026

The 0.0.1094 change covered TS/JS only. Inspecting the actual installed function
revealed a Python regex/validation pipeline and a second defect: **Use recommended
values** never requested inference. Earlier browser QA clicked the separate neural
button first, so it missed the reported path.

The first recommendation click now starts local training, applies a checked case
and prepares that case's path, explanation and playback without a second click
inside the scenario list. It offers cancellation and preserves any
edits made while awaiting the reply. Failure or missing support leaves inputs
intact instead of filling `""` as a successful recommendation. Opening or focusing
the view still never trains. The separate neural button adds cases without applying.

`analyzer/pythonScenarios` exposes `compilePythonScenario`; its internal syntax
helpers parse source with Lezer. `shared/pythonScenario` exposes the portable
bytecode contracts, a bounded regex grammar, and a closure-free iterative runtime
shared by Host checking and CSP-compatible browser replay. Application projection
replaces graph and function identities with snapshot-local IDs. No workspace
module is imported or executed, and no external model/service is used.

Supported examples include same-file pure helpers, local assignment, if/for/while,
continue/break, single-loop comprehensions, splitlines/join, ASCII digit conversion,
integer arithmetic/floor/modulo and bounded regex captures. External calls,
mutable module collections, unsupported syntax/regex, Unicode digit conversion,
recursive calls and exhausted budgets stay partial. This is a deliberately small
Python evaluator, not Python compatibility or complete path coverage.

Regex-shaped candidates now include separator and digit changes. Up to 96 teacher
checks seed a curriculum of duplicate, multiline and labeled inputs, counted within
the existing 1,400-check limit. The corpus is split before weight fitting. Digit
position/category and regex-match features describe inputs only; validator returns
and calculated operands remain labels. The first three occurrences of a condition
have separate heads and independently checked witnesses, so a second-visit duplicate
cannot be reported as a first-visit result. Poor held-out heads remain excluded.

The regex grammar accepts concatenation, nonnested capturing groups, fixed digit
counts, optional literal separators, whitespace runs and one-character negative
digit lookarounds. Its explicit search stack has a 32,768-work-item limit. Bytecode
uses at most 8 functions, 24 globals, 8,192 primitive steps and 32 iterations. Input
strings remain at most 512 code units; Python codepoint length is evaluated separately.

The generic committed fixture uses product codes with a checksum and label priority.
The user's actual source was inspected and checked locally; it is not copied into
the repository.

### Verification record — 0.0.1095

- TypeScript unit suite: 695 tests, 691 passed. The same four existing failures
  remain: dynamic callsite type baseline, nested declared-object representatives,
  advanced private Scenario calls and the source-reveal architecture expectation.
  Rust analyzer: 82 passed. Package tools: 12 passed. Compilation and whitespace
  checks passed. The VSIX contains 443 files, 3.27 MiB archived and 13.71 MiB
  unpacked; archive/unpacked budgets and dependencies are unchanged.
- Real generated webview and local training in Chromium at 1440×900, 768×1024
  and 390×844: the first recommendation click fills a nonempty multiline input
  and prepares a concrete return and enabled playback before any scenario-list
  interaction. Applying/playing a case, preserving concurrent edits, cancellation,
  keyboard activation, completion focus and no document/detail overflow passed.
  Page errors: zero. Screenshots were separately inspected, including the narrow
  stacked detail layout and calculated array changes.
- The in-app Browser reported no available connection; standalone Chromium
  substituted only VS Code message transport. Impeccable's mechanical audit
  reported no findings; manual Web Interface Guidelines review retained native
  controls, visible focus, polite status and wrapping. A screen-reader session
  is not claimed.
- The final 0.0.1095 VSIX was installed in official VS Code and the target
  workspace reloaded. The reported Python function's first recommendation click
  produced a checked labeled multiline input, seven accepted neural cases,
  concrete list changes and the expected two-item return with enabled playback.
  Its local report showed 241 training samples, 60 held-out samples and normalized
  error 0.189. This verifies the reported function, not arbitrary Python coverage.

## Strengthening contract — September 9, 2026

Empty strings and empty arrays must not be frozen input dimensions. Extend local training to variable string content/length and array length, using whole caller tuples, declared literals, and literals connected to the input through assignments and comparisons. Generated mutations are candidates, never observed calls. The network must learn from these inputs and rank discrete alternatives by learned predictions; final acceptance still requires different statically checked outcomes.

Keep a meaningful empty case when it demonstrates an empty-input guard, paired with a nonempty case. Prefer later distinct decisions over repeatedly explaining the first empty guard. Do not replace empty strings with arbitrary sample text and claim stronger analysis. Explain the actual changed string/collection and condition values. Preserve exact numeric boundary behavior, cancellation, shape validation and held-out evaluation.

The existing UI and tokens remain authoritative. The explicit neural action adds reviewed cases without changing edits. **Fill inferred values** should prefer a complete checked neural/branch/caller case over a type-only empty baseline, and should not fill unknowns in an earlier row ahead of a later complete case. Acceptance includes source-connected string equality after concatenation, length thresholds, nonempty collections, caller string alternatives, empty guards, and the real generated UI at 390/768/1440 px.

## Contract

The function reader needs inputs that explain a changed decision, including decisions made after intermediate value updates. The explicit **Find inputs with neural network** action trains a small function-specific network on the local CPU. No chat model, account, source upload, or execution of workspace code is involved.

The implementation covers the bounded TypeScript/JavaScript IR interpreter and the limited Python bytecode evaluator described above. Complete caller tuples and declared shapes initialize the input space. Numeric leaves are continuous features; strings, primitive collection lengths, literal alternatives and booleans can vary. Unsupported calls, framework state, unknown inputs, and interpreter limits remain gaps. This is a function-specific learned approximation, not a pretrained model that understands arbitrary source or domain intent.

## Learning and inference

- The teacher is the existing bounded IR evaluator. It observes comparison operands **after preceding assignments**, only at reached decisions. Numeric margins, string positional mismatch/length distance, and known truthiness supply training labels. This string distance is not edit distance or a semantic similarity score. Actual operands are retained separately for explanations; unreached decisions have no training label.
- Input provenance propagates through parser-owned assignments to collect connected comparison tokens and affixes. Whole caller alternatives, source tokens, affix inversions, case/whitespace/Unicode variants and nearby lengths form a bounded candidate vocabulary. Return-only labels and source metadata do not become input evidence. Generated variants are not claimed as observed callsite arguments.
- Text features include length, trimmed length, character classes, endpoint code units and distances to up to eight vocabulary references. Collection features retain size and bounded element information. Arbitrary dictionary indices are not treated as text embeddings. The network learns the relation from these input features to evaluated conditions; no evaluated condition label is supplied as an input feature.
- A seeded dense network with a nonlinear hidden layer and a linear residual learns normalized comparison margins by backpropagation and Adam. Weights are initialized and updated locally; predictions and input gradients use these learned weights.
- Separate held-out samples report normalized prediction error. They never update weights. This measures local approximation error, not a probability of correct program analysis or completeness.
- Gradient-guided numeric search targets a zero comparison margin. For strings/collections, learned margins rank finite alternatives, including different sizes and both predicted sides. Independent checks choose the pair closest to the condition boundary, then prefer the smallest changed text span, then compact text. A proposal needs a new checked outcome or a checked pair with different outcomes at the same decision. Merely changing an ordinary value is insufficient.
- Training, search, dimensions, samples, interpreter steps, and retained results have explicit limits. Work yields to the event loop and supports cancellation. Weights and samples remain in memory for the request.

This approach is informed by [NEUZZ](https://arxiv.org/abs/1807.05620), but uses typed function inputs and a static teacher instead of binary instrumentation. [Revisiting Neural Program Smoothing for Fuzzing](https://arxiv.org/abs/2309.16618) motivates reporting an untrained ablation and bounded comparisons rather than assuming a network outperforms simpler search.

## UI contract and acceptance

Reuse the existing scenario action, help, live status, and scenario rows. Keep VS Code theme tokens, typography, spacing, focus treatment, and responsive wrapping. No new visual system or decorative animation. The separate neural action trains and adds cases for review and explicit application. Fill recommended values trains when necessary, applies a checked case, and prepares its explanation and playback in one action.

Pending work disables duplicate requests and exposes Cancel. Success and empty results show actual training and held-out sample counts and normalized error; unsupported functions, cancellation, errors, and stale replies have distinct messages. A late reply must preserve selection, edited inputs, playback, graph clarity, and focus. Retain at most eight neural cases. Long Korean/English text must wrap at 390, 768, and 1440 px; keyboard navigation and live status must remain usable.

Functional acceptance includes real weight learning, gradient checks, masked unreachable branches, cancellation, reproducibility, input shape validation, derived numeric boundaries, and rejection of redundant or unsupported proposals. Visual acceptance uses the actual generated webview and real local inference at the three sizes above. Measured results and limitations are recorded after verification.

## Public surface and limits

`src/analyzer/neuralScenarios/index.ts` exports `inferNeuralScenarios(problem, options)` and typed problem/result/report contracts. `src/application/scenarioInputs/index.ts` exposes the local provider and typed model adapter. The Host preserves graph/request correlation and independently rechecks boundary witnesses before projection. Neither the browser nor source text supplies executable instructions.

One request uses at most 16 parameters, 32 input coordinates, 192 encoded features,
16 observed comparison heads, 1,400 teacher evaluations and four pairs/eight
proposals. Initial collection retains up to 400 unique tuples. Up to three stages
fit at most 800 tuples each, retaining initial coverage and recent reached prefixes.
Corpus sampling assigns tuples 4:1 to fitting/held-out data before normalization or
weight fitting; search feedback is fitting data only. Cached tuples never change
split. Held-out tuples never seed subsequent corpus mutations. A head requires at
least 16 fitting and four held-out observations with nonconstant labels.
Explanations and Host validation perform additional bounded checks of the pairs.
Each stage uses 24 tanh units/240 full-batch Adam epochs for numeric inputs or
48 units/360 epochs for expanded features, plus a learned linear residual. The
report counts total epochs across stages; losses and sample counts describe the
last fit. Sampling and training yield to cancellation; the Host timeout remains
120 seconds. Python's first three reached occurrences can supply separate heads;
TS/JS retains its first occurrence. Final checks compare the same occurrence.

Numeric dimensions use a symmetric finite domain: twice the largest scanned IR or
Python bytecode numeric literal/example magnitude, rounded up to a power of two,
with radius 16 through 2^20. Explicit Python `int` root parameters decode only to
integers. Numeric object leaves and existing array elements can vary. A string
domain retains at most 160 alternatives for TS/JS or 400 for Python, each up to
512 UTF-16 code units. Text dimensions share the 192-feature budget; regex-specific
features are used only when supported patterns exist. Primitive arrays can range
from zero to 32 elements when a complete element template is available; numeric
elements present in the original/declared shape remain independent coordinates
and are masked when absent. Nested containers retain fixed shapes. Declared
literals stay within their union. Unknown dynamic arguments are not facts. The
TS/JS teacher still lacks string methods such as `trim` and regex; Python supports
only the subset above. Arbitrary library calls, object shape invention and framework
state remain unsupported. This is not a semantic language model, general constraint
solver, runtime fuzzer, or framework simulator.

Search uses up to 14 starts, including ranked fitting tuples and complete
caller/planner/source anchors, up to 80 learned-gradient steps, and up to three
numeric coordinates with at most 56 bisection refinements each. Joint categorical
ranking has beam width four, two passes and at most 8,192 predictions per start;
it preserves numeric and fixed guard coordinates. Discrete witness checks examine
at most 48 alternatives per coordinate/start within the shared teacher budget.
Final pairs vary one coordinate, preserving actual condition and input changes.
Numeric refinement prefers readable integers/short decimals but preserves fixed
fractional guards and exact representable calibrated roots. Explanations retain
round-trippable digits, invisible-character escapes, lengths and first changed
offsets. Full inputs remain editable. Static verification must still succeed;
later external effects are never fabricated. Other languages and framework state
keep their static guides and explicit gaps.

`inputEvidence.ts` owns vocabulary/provenance, with bounded Python helper summaries
in `pythonEvidence.ts`. `inputSpace.ts` owns the typed codec and `textFeatures.ts`
owns cached input-only text encoding. `infer.ts` owns adaptive sample collection and
stage budgets; `network.ts` owns weight learning; `search.ts` / `discreteSearch.ts`
own learned search and refinement. The Function Tutor evaluator and shared Python
machine own teacher labels independently. These files remain internal to their
feature public APIs.

## Diagnostic results — September 9, 2026 (v2)

`npm run benchmark:neural` now contains 12 programs. The original six derived numeric successes remain; modulo fails the quality gate and external state has no usable labels. Four additional text/collection cases succeed:

| New diagnostic | Held-out MAE before → after learning | Checked target found | Teacher evaluations |
| --- | --- | --- | --- |
| Text length after arithmetic | 0.914 → 0.015 | Yes | 113 |
| Token after prefix concatenation | 0.863 → 0.008 | Yes | 183 |
| Empty guard followed by length arithmetic | 0.693 → 0.009 | Yes, both decisions get pairs | 140 |
| Collection length after arithmetic | 0.873 → 0.006 | Yes | 420 |

The planner misses these four target outcomes. Uniform random sampling over the **expanded finite vocabulary also finds all four**, so these results do not show a neural advantage over discrete random search. They demonstrate that learned predictions improve over untrained predictions and that the stronger codec no longer freezes empty text/collections. Candidate generation, neural ranking and static verification have separate responsibilities. General input-domain understanding and exhaustive branch coverage are not established.

## Verification record — 0.0.1094

- Full TypeScript suite: 687 tests, 683 passed, the same four existing failures listed in the 0.0.1093 record. All nine new input-diversity tests passed. The final focused neural/workspace run passed 31 tests.
- Rust analyzer: 82 passed. Package tools: 12 passed. Compilation, whitespace and release metadata checks passed. The VSIX has 433 files, 3.24 MiB archived and 13.63 MiB unpacked, within the existing budgets; dependencies are unchanged.
- Actual generated webview with real local training: text cases at 1440×900, 768×1024, 390×844, 320×844 light theme, and 768×1024 forced colors; a derived array-size case at 1440×900. Keyboard start, pending/disabled state, cancellation/no late rows, completion focus, retained edited inputs and graph DOM, review, explicit application, Korean/English updates, and no document/detail overflow passed. Text recommendations crossed lengths 6/7; array recommendations crossed sizes 3/4. Fill recommended values used the later checked text boundary, rather than the one-character empty-guard partner.
- A 390×844 duplicate-array fixture exercised the truthful empty state: already represented boundary inputs were rejected instead of being changed arbitrarily just to add rows. Console/page errors in the successful multi-viewport flow: zero.
- Rendered desktop/tablet/mobile/light/forced-color screenshots were inspected separately. Impeccable polish restored the title/source gap in narrow scenario rows. [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) review found and fixed the recommendation button's accessible-name mismatch; the action uses its visible label in both locales. Existing native buttons, focus styles, live status and overflow handling remain in use.
- The in-app browser reported no available connection. Standalone Chromium substitutes only VS Code message transport; the provider and rendered application code are real. Interactive training inside installed VS Code and a full screen-reader session are not claimed.

## Historical diagnostic results — September 8, 2026

At 0.0.1093, `npm run benchmark:neural` evaluated an eight-program diagnostic corpus with a reproducible seed. The trained and random searches share a maximum teacher budget of 1,400; they do not consume equal time or necessarily the same number of evaluations. The untrained pipeline keeps the quality gate, so its zero accepted pairs is **not** an isolated gradient-search ablation. Its held-out error, alongside the unit test's changed weights and analytic gradient check, demonstrates actual learning.

| Diagnostic family | Held-out MAE before → after learning | Rare equality found |
| --- | --- | --- |
| Affine value | 0.682 → 0.003 | Yes |
| Coupled inputs | 0.763 → 0.014 | Yes |
| Sequential updates | 0.682 → 0.003 | Yes |
| Required object fields | 0.818 → 0.013 | Yes |
| Quadratic value | 0.883 → 0.014 | Yes |
| Preceding guard | 0.783 → 0.010 | Yes |
| Modulo discontinuity | 0.634 → 0.287 | No; quality gate |
| External call | No supported labels | No; explicit gap |

The existing planner and uniform continuous random baseline did not find these rare equalities. This corpus deliberately stresses derived equalities, and continuous random sampling is a weak baseline for exact equality. These measurements do not establish superiority over constraint solving, integer search, fuzzers, or arbitrary projects. Six successes and the two explicit limits describe this diagnostic corpus only.

## Verification record — 0.0.1093

- Full TypeScript suite: 678 tests, 674 passed, the same four existing failures (two Function Guide type-representative expectations, advanced private Scenario calls, and the source-reveal architecture expectation). Final affected input-quality/neural/delivery checks plus the framework integration recheck: 27 passed. One intermediate concurrent run failed to launch the Rust fixture command; its focused recheck passed.
- Rust analyzer: 82 passed. Package-tool tests: 12 passed. TypeScript compilation, whitespace and release metadata checks passed.
- Actual generated webview plus **real local CPU training** in standalone Chromium at 1440×900, 768×1024 and 390×844; additional 320×844 light theme and 768×1024 forced colors/reduced motion. The in-app Browser reported no available connection. No external model reply fixture was used for the successful training flow.
- Keyboard start, pending/disabled action, cancellation, no late rows, retained edited input and graph DOM, two checked rows, explicit input application, completion focus, Korean/English updates, and no document/detail overflow were exercised. Console/page errors: zero.
- Rendered screenshots were inspected separately. Impeccable polish preserved native tokens and hierarchy, removed the internal `number:` prefix from scenario titles, and favored nearby caller/planner anchors. Web Interface Guidelines review: `scenarioInputsBrowserSource.ts` uses native controls, polite live status, restored focus, bounded text and locale-aware numeric diagnostics; existing workspace styles retain wrapping and coarse-pointer targets.

The VSIX has 430 files, a 3.24 MiB archive and 13.61 MiB unpacked payload. Six net runtime modules replace the external adapter with separate network, codec, training, search and application responsibilities. The file cap increased from 425 to 434; archive/unpacked budgets and dependencies are unchanged.

The browser preview substitutes only the VS Code message transport. A full screen-reader session and interactive training inside the installed VS Code extension are not claimed.
