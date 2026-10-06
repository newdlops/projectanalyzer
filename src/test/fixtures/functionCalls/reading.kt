// Cross-file call reading retains Kotlin declarations and guard syntax.
fun checkout(enabled: Boolean, amount: Int): Int {
  if (!enabled) return zero()
  val adjusted = addFee(amount)
  return double(adjusted)
}
fun zero(): Int { return 0 }
