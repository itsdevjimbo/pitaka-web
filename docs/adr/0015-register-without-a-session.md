---
status: accepted
---

# Register without a session, behind a confirmation gate

The API's auth module now sits on ASP.NET Core Identity (`pitaka` ADR 0011) with `RequireConfirmedAccount` on (`pitaka` ADR 0012). `POST /api/auth/register` no longer returns a token: it returns the Profile and sends a confirmation email. Until that email is confirmed, login answers `403` with a distinct reason rather than the generic `401` it used to give. Pitaka Web accepts the gate as it stands rather than papering over it: registering leads to a "check your inbox" state, not into the app.

## Consequences

- **Registration stops being a session transition.** `Session` owns the bearer token, the live Profile, and the moves between them; register no longer produces any of those, so it moves back onto `AuthService` and returns a `Profile`. Leaving a `register` on `Session` that establishes nothing is an invitation to wire `establish()` back in later.
- **One typed failure, not a status check in a component.** The unconfirmed `403` is the only auth failure that drives UI — it reveals a "resend confirmation" affordance the wrong-password `401` and the locked-out `423` must not show — so `AuthService` throws an `EmailNotConfirmedError`. Screens ask a domain question, never `error.status === 403`. Every other auth failure stays an `ApiError` with wording owned by `AuthService`, per ADR 0002.
- **The normalizer is not loosened.** `normalize-error` still collapses every `403` into the not-found message and still discards the server's `detail`; that suppression exists so a `403` can never confirm another person's row exists. `AuthService` substitutes its own wording by status, exactly as it already does for `401` on login and `409` on register.
- **The client writes the words.** The API's `403`/`423` details are sentences in a `switch`, not a contract. Copying them through would let the client's voice change whenever the API's does. This also means no lockout countdown: the duration is an Identity default the response does not carry, and a guessed "5 minutes" would be a fabrication.
- **The two link-landing screens sit outside `guestGuard`.** Confirming an email and resetting a password are operations on a Profile reached by link, not guest actions a live session makes meaningless. Guarding them would silently destroy a token the person came to spend. They must therefore not assume the absence of a session — confirm-email branches on it to decide where to land.
- **One dead-link state, always with an exit.** Expired, already-used, tampered, and malformed-URL are indistinguishable to us: the API returns one undifferentiated `400`, and security-stamp rotation (`pitaka` ADR 0013) means using one link invalidates its siblings, so naming any single cause would often be a lie. The screens say the link is no longer valid, offer no diagnosis, and offer the action that fixes it.
- **A successful reset clears the local session.** A live JWT survives a password reset for up to an hour — the API cannot revoke it (`pitaka` ADR 0011). We clear the one token we control and say nothing about the rest: the person cannot act on the gap, and the hour is a server default we do not own.
- **This ADR shares ADR 0004's death date.** The revocation gap above is the same gap that ADR records. When refresh tokens land, both are superseded together, not extended.
