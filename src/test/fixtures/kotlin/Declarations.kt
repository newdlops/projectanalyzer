/** Service fixture covers callable source facts and lexical nesting. */
class Service {
    fun helper(value: Int): Int = value

    suspend fun run(
        name: String? = null,
        vararg values: Int
    ): Int {
        fun local(value: Int = 1) = helper(value)
        val action = { helper(99) }
        return local()
    }
}

fun String.decorate(suffix: String = "!") = this + suffix

object Singleton {
    fun start() = Service()
}
