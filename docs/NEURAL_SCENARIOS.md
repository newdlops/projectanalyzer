# Local neural scenario inference

## Strengthening contract — September 9, 2026

Empty strings and empty arrays must not be frozen input dimensions. Extend local training to variable string content/length and array length, using whole caller tuples, declared literals, and literals connected to the input through assignments and comparisons. Generated mutations are candidates, never observed calls. The network must learn from these inputs and rank discrete alternatives by learned predictions; final acceptance still requires different statically checked outcomes.

Keep a meaningful empty case when it demonstrates an empty-input guard, paired with a nonempty case. Prefer later distinct decisions over repeatedly explaining the first empty guard. Do not replace empty strings with arbitrary sample text and claim stronger analysis. Explain the actual changed string/collection and condition values. Preserve exact numeric boundary behavior, cancellation, shape validation and held-out evaluation.

The existing UI and tokens remain authoritative. The explicit neural action adds reviewed cases without changing edits. **Fill inferred values** should prefer a complete checked neural/branch/caller case over a type-only empty baseline, and should not fill unknowns in an earlier row ahead of a later complete case. Acceptance includes source-connected string equality after concatenation, length thresholds, nonempty collections, caller string alternatives, empty guards, and the real generated UI at 390/768/1440 px.

## Contract

The function reader needs inputs that explain a changed decision, including decisions made after intermediate value updates. The explicit **Find inputs with neural network** action trains a small function-specific network on the local CPU. No chat model, account, source upload, or execution of workspace code is involved.

The implementation covers the bounded TypeScript/JavaScript IR interpreter. Complete caller tuples and declared shapes initialize the input space. Numeric leaves are continuous features; strings, primitive collection lengths, literal alternatives and booleans can vary. Unsupported calls, framework state, unknown inputs, and interpreter limits remain gaps. This is a function-specific learned approximation, not a pretrained model that understands arbitrary source or domain intent.

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

Reuse the existing scenario action, help, live status, and scenario rows. Keep VS Code theme tokens, typography, spacing, focus treatment, and responsive wrapping. No new visual system or decorative animation. The primary flow is train → review the checked input and reason → apply it explicitly → follow value changes.

Pending work disables duplicate requests and exposes Cancel. Success and empty results show actual training and held-out sample counts and normalized error; unsupported functions, cancellation, errors, and stale replies have distinct messages. A late reply must preserve selection, edited inputs, playback, graph clarity, and focus. Retain at most eight neural cases. Long Korean/English text must wrap at 390, 768, and 1440 px; keyboard navigation and live status must remain usable.

Functional acceptance includes real weight learning, gradient checks, masked unreachable branches, cancellation, reproducibility, input shape validation, derived numeric boundaries, and rejection of redundant or unsupported proposals. Visual acceptance uses the actual generated webview and real local inference at the three sizes above. Measured results and limitations are recorded after verification.

## Public surface and limits

`src/analyzer/neuralScenarios/index.ts` exports `inferNeuralScenarios(problem, options)` and typed problem/result/report contracts. `src/application/scenarioInputs/index.ts` exposes the local provider and typed model adapter. The Host preserves graph/request correlation and independently rechecks boundary witnesses before projection. Neither the browser nor source text supplies executable instructions.

One request uses at most 16 parameters, 32 input coordinates, 192 encoded features, 16 observed comparison heads, 400 unique sampled tuples, 1,400 teacher evaluations during sampling/search, and four pairs/eight proposals. Explanations and Host validation perform additional bounded checks of those pairs. Numeric-only inputs use 24 tanh units and 240 full-batch Adam epochs; expanded text/collection features use 48 units and 360 epochs. Both have a learned linear residual. Unique tuples are split 4:1 before fitting normalizers or weights, so small finite domains have fewer than 320/80 samples. Sampling and training yield to cancellation; the existing Host timeout is 120 seconds. Loops supply only their first reached comparison observation.

Numeric dimensions use a symmetric finite domain: twice the largest scanned IR numeric literal or example magnitude, with a minimum radius of 16 and maximum radius of 1,000,000. Numeric object leaves and existing array elements can vary. A string domain retains at most 160 alternatives, each up to 512 UTF-16 code units. Primitive arrays can range from zero to 32 elements when a complete element template is available; numeric elements present in the original/declared shape remain independent coordinates and are masked when absent. Nested arrays/objects retain their fixed shape and existing leaf search. Declared literals stay within their union. Unknown dynamic arguments are not inferred as facts. String method calls such as `trim`, regular expressions, arbitrary library calls, object shape invention and framework state remain unsupported by this teacher. This is not a semantic language model, general constraint solver, runtime fuzzer, or framework simulator.

Search uses up to six starts, including complete caller/planner anchors, up to 80 learned-gradient steps, and up to three numeric coordinates with at most 56 bisection refinements each. Discrete search checks at most 48 alternatives per coordinate/start within the shared budget, preserving numeric coordinates while varying one text/collection coordinate. Integer and short-decimal pairs are preferred across numeric coordinates; an exact representable calibrated value may also be used. Explanations preserve round-trippable numeric digits, escape invisible text characters, and show lengths and the first changed offset when full strings are too long. Full inputs stay available in the editor. Static verification must still succeed. A different outcome at a later external effect is never fabricated. Other languages and framework-owned state keep their existing static guides and explicit gaps.

`inputEvidence.ts` owns parser-backed vocabulary/provenance, `inputSpace.ts` owns the typed codec and features, `network.ts` owns weight learning, and `search.ts` / `discreteSearch.ts` own learned search and bounded refinement. `functionTutor/inputEvaluation/observation.ts` owns the teacher's labels independently of the network. These files remain internal to their feature public APIs.

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
