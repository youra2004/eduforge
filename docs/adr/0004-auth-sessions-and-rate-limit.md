# ADR-0004: Sessions and login rate limiting

- Sessions live in a `sessions` table; the cookie holds a random 32-byte token and the row id is its SHA-256, so a DB leak does not give usable cookies. Cookie: HttpOnly, SameSite=Lax, Secure in production; TTL from `SESSION_TTL_SECONDS`. JSON endpoints require `Content-Type: application/json`, which also blocks cross-site form (login CSRF) posts.
- Login attempts go to `login_attempts`, counted per email and per client IP in `LOGIN_WINDOW_SECONDS`. An attempt is reserved under a Postgres advisory lock before the password is checked (so parallel guesses cannot beat the limit) and released on success. Over `LOGIN_MAX_ATTEMPTS` the login answers 429, even for the right password. DB-backed so limits survive restarts and multiple instances.
- The IP comes from X-Forwarded-For only as far as `TRUSTED_PROXY_HOPS` says (0 = header ignored, per-IP limit off); the client-supplied part of the header is never trusted.
- Accepted: an attacker can lock a known email out for a window (the email limit has to block the right password too), and registration is not rate limited. Revisit if it matters.
- Self-registration only gives `student` (+ `terms` consent, optional `research`); every other role comes from an admin, and the last admin cannot lose the role.
