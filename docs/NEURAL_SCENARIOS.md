# Local neural scenario inference

## Contract

The function reader needs inputs that explain a changed decision, including decisions made after intermediate value updates. The explicit **Find inputs with neural network** action trains a small function-specific network on the local CPU. No chat model, account, source upload, or execution of workspace code is involved.

The first implementation covers the bounded TypeScript/JavaScript IR interpreter. Complete caller tuples and declared shapes initialize the input space. Numeric leaves are continuous features; literal alternatives and booleans are categorical features. Unsupported calls, framework state, unknown inputs, and interpreter limits remain gaps. This is a function-specific numerical surrogate, not a pretrained model that understands arbitrary source or domain intent.

## Learning and inference

- The teacher is the existing bounded IR evaluator. It observes numeric comparison operands **after preceding assignments**, only at reached decisions. Unreached decisions have no training label.
- A seeded dense network with a nonlinear hidden layer and a linear residual learns normalized comparison margins by backpropagation and Adam. Weights are initialized and updated locally; predictions and input gradients use these learned weights.
- Separate held-out samples report normalized prediction error. They never update weights. This measures local approximation error, not a probability of correct program analysis or completeness.
- Gradient-guided input search targets a zero comparison margin. Bounded static refinement and neighboring values check the resulting boundary. A proposal needs a new checked outcome or a checked pair with different outcomes at the same decision. Merely changing an ordinary number is insufficient.
- Training, search, dimensions, samples, interpreter steps, and retained results have explicit limits. Work yields to the event loop and supports cancellation. Weights and samples remain in memory for the request.

This approach is informed by [NEUZZ](https://arxiv.org/abs/1807.05620), but uses typed function inputs and a static teacher instead of binary instrumentation. [Revisiting Neural Program Smoothing for Fuzzing](https://arxiv.org/abs/2309.16618) motivates reporting an untrained ablation and bounded comparisons rather than assuming a network outperforms simpler search.

## UI contract and acceptance

Reuse the existing scenario action, help, live status, and scenario rows. Keep VS Code theme tokens, typography, spacing, focus treatment, and responsive wrapping. No new visual system or decorative animation. The primary flow is train → review the checked input and reason → apply it explicitly → follow value changes.

Pending work disables duplicate requests and exposes Cancel. Success and empty results show actual training and held-out sample counts and normalized error; unsupported functions, cancellation, errors, and stale replies have distinct messages. A late reply must preserve selection, edited inputs, playback, graph clarity, and focus. Retain at most eight neural cases. Long Korean/English text must wrap at 390, 768, and 1440 px; keyboard navigation and live status must remain usable.

Functional acceptance includes real weight learning, gradient checks, masked unreachable branches, cancellation, reproducibility, input shape validation, derived numeric boundaries, and rejection of redundant or unsupported proposals. Visual acceptance uses the actual generated webview and real local inference at the three sizes above. Measured results and limitations are recorded after verification.

## Public surface and limits

`src/analyzer/neuralScenarios/index.ts` exports `inferNeuralScenarios(problem, options)` and typed problem/result/report contracts. `src/application/scenarioInputs/index.ts` exposes the local provider and typed model adapter. The Host preserves graph/request correlation and independently rechecks boundary witnesses before projection. Neither the browser nor source text supplies executable instructions.

One request uses at most 16 parameters, 32 input dimensions, 16 observed comparison heads, 400 unique sampled tuples, 1,400 teacher evaluations during sampling/search, and four pairs/eight proposals. Explanations and Host validation perform additional bounded checks of those pairs. The default network has 24 tanh units plus a learned linear residual, trained for 240 full-batch Adam epochs. Sampling and training yield to cancellation; the existing Host timeout is 120 seconds. The variance/mean normalizers use training labels only. Loops supply only their first reached comparison observation.

Numeric dimensions use a symmetric finite domain: twice the largest scanned IR numeric literal or example magnitude, with a minimum radius of 16 and maximum radius of 1,000,000. Numeric object leaves and existing array elements can vary; string content, collection length and object shape stay fixed to one complete tuple. Declared literals and booleans use bounded categorical coordinates. Unknown dynamic call arguments are not inferred as facts. Learning currently needs numeric binary comparisons; it is not a semantic language model, general constraint solver, runtime fuzzer, or framework simulator.

Search uses up to six starts, including complete caller/planner anchors, up to 80 learned-gradient steps, and up to three numeric coordinates with at most 56 bisection refinements each. Displayed pairs change one numeric leaf. Integer and short-decimal pairs are preferred across coordinates; an exact representable calibrated value may also be used. Explanations preserve round-trippable numeric digits so different equality outcomes cannot appear to have the same input. Static verification must still succeed. A different outcome at a later external effect is never fabricated. Other languages and framework-owned state keep their existing static guides and explicit gaps.

## Diagnostic results — September 8, 2026

Run `npm run benchmark:neural` after installing development dependencies. This builds the production code and evaluates a separate eight-program diagnostic corpus with a reproducible seed. The trained and random searches share a maximum teacher budget of 1,400; they do not consume equal time or necessarily the same number of evaluations. The untrained pipeline keeps the quality gate, so its zero accepted pairs is **not** an isolated gradient-search ablation. Its held-out error, alongside the unit test's changed weights and analytic gradient check, demonstrates actual learning.

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
