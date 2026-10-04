/** Kotlin flow fixtures deliberately use source structure, not executable runtime outcomes. */
class FlowSamples {
    fun select(flag: Boolean, code: Int): String = if (flag) {
        when (code) {
            0 -> "zero"
            else -> "other"
        }
    } else "off"

    fun choose(flag: Boolean): Int {
        val result = if (flag) 1 else 2
        return result
    }

    fun optional(user: User?): String {
        val name = user?.fetch() ?: return missing()
        return name
    }

    fun repeated(values: List<Int>) {
        outer@ for (value in values) {
            while (active()) {
                if (value == 0) continue@outer
                if (value < 0) break@outer
                tick(value)
            }
        }
        do { tick(1) } while (active())
        done()
    }

    fun cleanup() {
        try { work() } catch (error: Exception) { failed(error) } finally { release() }
        done()
    }

    suspend fun scopes(value: Int): Int {
        fun local() = hidden(99)
        listOf(value).forEach { item -> hidden(item) }
        val task = { hidden(88) }
        return value
    }

    fun mixed(a: Boolean, b: Boolean, c: Boolean): Boolean = a && b || c
}
