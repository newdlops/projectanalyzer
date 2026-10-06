/** Public native QA fixture: early return and ordered value changes produce two scenario note sets. */
fun total(enabled: Boolean, amount: Int): Int {
    if (!enabled) return 0
    val adjusted = amount + 5
    return adjusted
}
