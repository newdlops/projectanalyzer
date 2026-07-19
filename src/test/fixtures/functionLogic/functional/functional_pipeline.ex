# Elixir pipe-forward fixture: the previous value becomes the first argument.
defmodule BillingPipeline do
  def keep_billable(records), do: Enum.filter(records, & &1.billable)
  def normalize_all(records), do: Enum.map(records, &Map.update!(&1, :amount, fn value -> abs(value) end))
  def expand_all(records), do: Enum.flat_map(records, fn record -> [record, record] end)
  def audit_all(records, audit), do: Enum.map(records, fn record -> audit.(record); record end)
  def summarize(records), do: Enum.reduce(records, 0, &(&1.amount + &2))

  @ignored_marker "not |> a pipeline stage"

  def run_functional_chain(records, audit) do
    records
    |> keep_billable()
    |> normalize_all()
    |> expand_all()
    |> audit_all(audit)
    |> summarize()
  end
end

defmodule AlternatePipeline do
  def keep_billable(records), do: records
  def normalize_all(records), do: records
  def summarize(records), do: records
end
