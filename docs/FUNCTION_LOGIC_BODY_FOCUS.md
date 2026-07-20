# Dynamic Function Logic body frames

Function Logic keeps every analyzer-provided compound-body rectangle, but the
Webview projects only the outermost rectangle in each body hierarchy at first.
This avoids drawing nested dashed frames over the same nodes and routes.

## Interaction contract

- Every body-forming owner has a textual `BODY` badge.
- The initial projection shows compound groups without another body owner above
  them. Nested body frames remain hidden; their statement nodes stay visible.
- Activating a nested owner promotes exactly that owner's body rectangle to the
  visible outer frame. Node selection and callable/JSX/event expansion still run.
- `Parent body`, an ancestor breadcrumb, and `Outermost` change only the frame
  projection. They do not relayout nodes, reroute edges, or alter branch choices.
- Focus survives attached-function relayouts while the root graph session is
  stable. If the focused owner disappears, the projection safely returns to the
  current outermost bodies.

## Module boundary and public API

`src/webview/codeFlow/bodyFocus/` owns the feature.

- `createFunctionLogicBodyHierarchy(blocks, groups)` builds the nearest-owner
  parent index using iterative parent-chain walks and cycle guards.
- `createFunctionLogicBodyFocusProjection(hierarchy, ownerId?)` returns either
  all outer groups or one focused group plus its root-to-focus path.
- `getFunctionLogicBodyFocusBrowserSource()` adapts the pure projection to the
  compound layer, owner nodes, and in-flow navigation controls.
- `getFunctionLogicBodyFocusStyles()` provides theme, responsive, and
  forced-colors styling without placing controls over the graph canvas.

The pure projection module has no DOM, VS Code, analyzer, protocol, or storage
dependency. The browser adapter sends no Host messages and treats compound
geometry as an opaque input from the existing layout projection.

## Bounds and failure behavior

Function Logic already limits the visible block set. Body ancestry uses explicit
loops and visited sets over that bounded set; it does not recurse. A malformed
parent cycle is cut at a deterministic owner so the component still exposes an
outer frame instead of hiding every body.
