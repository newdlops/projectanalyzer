(* OCaml pipe-forward fixture: the previous value becomes the final argument. *)
type billing_record = {
  account_id : string;
  amount : int;
  billable : bool;
}

let keep_billable records =
  records |> List.filter (fun record -> record.billable)

let normalize_all records =
  records |> List.map (fun record -> { record with amount = abs record.amount })

let expand_all records =
  records |> List.concat_map (fun record -> [record; record])

let summarize records =
  records |> List.fold_left (fun total record -> total + record.amount) 0

let ignored_marker = "not |> a pipeline stage"

let run_functional_chain records =
  records
  |> keep_billable
  |> normalize_all
  |> expand_all
  |> summarize
