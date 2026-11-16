# ADR-0004: Sessions and login rate limiting

- Sessions live in a `sessions` table; the cookie holds a random 32-byte token and the row id is its SHA-256, so a DB leak does not give usable cookies. Cookie: HttpOnly, SameSite=Lax, Secure in production; TTL from `SESSION_TTL_SECONDS`.
- Failed logins go to `login_attempts`, counted per email and per client IP (`x-forwarded-for`, so it assumes a trusted proxy) in `LOGIN_WINDOW_SECONDS`; over `LOGIN_MAX_ATTEMPTS` the login answers 429, even for the right password. Chosen over in-memory counters so limits survive restarts and multiple instances.
- Self-registration only gives `student` (+ `terms` consent, optional `research`); every other role comes from an admin, and the last admin cannot lose the role.
