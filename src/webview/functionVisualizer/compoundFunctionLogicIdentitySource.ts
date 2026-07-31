/** Browser-source fragment for opaque identities in one attached function scene. */

/** Returns identity helpers shared by compound scene construction and routing. */
export function getCompoundFunctionLogicIdentitySource(): string {
  return /* js */ `
    /** Creates stable browser-only identities without exposing new Host authority. */
    function createCompoundBlockId(scopeId, blockId) { return "compound-block:" + scopeId + ":" + blockId; }
    /** Creates stable browser-only edge identities inside one compound scene. */
    function createCompoundEdgeId(scopeId, edgeId) { return "compound-edge:" + scopeId + ":" + edgeId; }
    /** Namespaces one value binding inside its attached function scope. */
    function createCompoundBindingId(scopeId, bindingId) { return "compound-binding:" + scopeId + ":" + bindingId; }
    /** Namespaces one value-flow relation inside its attached function scope. */
    function createCompoundValueFlowId(scopeId, valueFlowId) { return "compound-value-flow:" + scopeId + ":" + valueFlowId; }
    /** Indexes an original block within its function scope. */
    function createScopeBlockKey(scopeId, blockId) { return scopeId + "::" + blockId; }
    /** Joins scope and binding identities without relying on display labels. */
    function createScopeBindingKey(scopeId, bindingId) { return scopeId + "\\u0000" + bindingId; }
  `;
}
