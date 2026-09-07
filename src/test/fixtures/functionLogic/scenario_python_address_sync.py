"""Scenario fixture for multiline Python types, walrus writes, and DB effects."""


def unrelated_before_target(value: str) -> str:
    return value


def edit_director_ceo_address_change_event(
    user: AppUser,
    director: Director,
    ceo_address_changes: list[CeoAddressChangeInput],
) -> None:
    existing_events = {
        (event.date, event.address): event.id
        for event in CeoAddressChangeEvent.objects.filter(director=director)
    }
    new_events = {(change["date"], change["address"]) for change in ceo_address_changes}

    if events_to_delete := existing_events.keys() - new_events:
        bulk_delete_director_ceo_address_change_events(
            director,
            events_to_delete,
        )

    if events_to_add := new_events - existing_events.keys():
        bulk_create_director_ceo_address_change_events(
            user,
            director,
            events_to_add,
        )
