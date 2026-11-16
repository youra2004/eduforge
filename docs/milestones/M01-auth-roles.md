# M01 — Authentication and roles

**Depends on:** M00 · **SPEC requirements:** section 3, NFR-1, NFR-2, NFR-4, F11 (partly)

## Goal
Users, roles, sessions and a basic UI shell in Ukrainian.

## Scope
- Tables `users`, `user_roles`, `consents`.
- Registration, login, logout; passwords with argon2; server-side sessions in a cookie (HttpOnly, Secure, SameSite).
- Role middleware/guard (`student`, `author`, `expert`, `admin`); one person can have several roles.
- A script to create an admin; an admin page for assigning roles.
- A basic layout (uk), placeholder pages per role, error messages.
- Rate limiting on login.
- A consent component and service (`consents`): records version and time.

## Out of scope
OAuth/SSO, password recovery by email (if needed — a separate small milestone).

## Acceptance criteria
- [ ] An unauthenticated user sees no protected pages or APIs
- [ ] The guard blocks actions outside a role on the server (not only in the UI)
- [ ] An admin can assign/remove roles; changes persist
- [ ] Passwords are not stored in plain text; login is rate-limited
- [ ] Consent is recorded with a version and a time
- [ ] e2e: register → log in → reach the page for your role

## Tests
Unit: guard. Integration: role-based APIs. e2e (Playwright): the full login flow.
