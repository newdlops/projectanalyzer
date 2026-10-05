/** Narrative grounding fixture: guards stop before later Kotlin return expressions. */
fun classifyOrder(enabled: Boolean, amount: Int): String {
    if (!enabled) return "disabled"
    if (amount > 100) return "priority"
    return "ordinary"
}
