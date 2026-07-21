"""Self-check for the role-sync fix in auth.get_current_user (fail-closed
provisioning without demoting existing users on a claim-less token).

Mirrors the exact branching in auth.py rather than driving the full JWT/Clerk
flow (get_current_user is deeply coupled to token verification) - see
test_mechanic_flow.py for the same pattern.
"""

def resolve_role(existing_role, token_role):
    """existing_role: role already stored for the user, or None if new.
    token_role: metadata.get("role") from the JWT - None if the claim is absent."""
    if existing_role is None:
        return token_role or "Viewer"  # new user: fail closed
    if token_role is not None:
        return token_role  # token explicitly asserts a role: honor it
    return existing_role  # token silent: never demote


def main():
    assert resolve_role(None, None) == "Viewer", "new user, no claim -> fail closed to Viewer"
    assert resolve_role(None, "Editor") == "Editor", "new user, explicit claim -> honored"
    assert resolve_role("Admin", None) == "Admin", "existing Admin, claim-less token -> NOT demoted"
    assert resolve_role("Admin", "Viewer") == "Viewer", "existing user, explicit demotion -> honored"
    assert resolve_role("Viewer", "Admin") == "Admin", "existing user, explicit promotion -> honored"
    print("test_auth_role_sync.py self-check passed.")


if __name__ == "__main__":
    main()
