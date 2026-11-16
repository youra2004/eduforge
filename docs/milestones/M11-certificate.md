# M11 — Certificate and verification

**Depends on:** M09 · **SPEC requirements:** F10 (R1–R5), D-25, D-26, NFR-2

## Goal
A signed certificate with public verification, without a photo or biometrics.

## Scope
- Tables `signing_keys`, `certificates`; an Ed25519 key-generation script (the private key lives only in env/secrets).
- Canonical payload serialization (stable key order) and a `crypto.sign` signature.
- Issuance after a successful exam: payload (course, version, rating, score, date, per-skill levels, LLM description), `certificate_id`, `kid`, SHA-256.
- A public page `/verify/<id>`: signature verification, status `valid | revoked`; a QR code.
- Public keys under `/.well-known/`.
- Revocation by an admin with a reason.
- A print/PDF version via printing from HTML (optional).

## Out of scope
Blockchain, Open Badges/Verifiable Credentials (may be mentioned in the thesis as future work).

## Acceptance criteria
- [ ] Changing any payload field breaks the signature (test)
- [ ] A revoked certificate is shown as invalid
- [ ] The verification page works without an account
- [ ] The payload and the page contain no photo/biometrics
- [ ] Canonicalization is deterministic: the same payload → the same signing input (unit test)
- [ ] The public key by `kid` is available and verifies the signature with an independent script

## Tests
Unit: canonicalization, sign/verify, skill levels. Integration: issuance, verification, revocation. e2e: exam → certificate → open `/verify`.
