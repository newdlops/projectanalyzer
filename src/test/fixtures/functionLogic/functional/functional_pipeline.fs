// F# pipe-forward fixture: the previous value becomes the final argument.
module BillingPipeline

type BillingRecord = {
    AccountId: string
    Amount: int
    Billable: bool
}

let keepBillable records =
    records |> List.filter (fun record -> record.Billable)

let normalizeAll records =
    records |> List.map (fun record -> { record with Amount = abs record.Amount })

let expandAll records =
    records |> List.collect (fun record -> [ record; record ])

let auditAll audit records =
    records |> List.map (fun record -> audit record; record)

let summarize records =
    records |> List.sumBy (fun record -> record.Amount)

let ignoredMarker = "not |> a pipeline stage"

let runFunctionalChain records audit =
    records
    |> keepBillable
    |> normalizeAll
    |> expandAll
    |> auditAll audit
    |> summarize
