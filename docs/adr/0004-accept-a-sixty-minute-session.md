---
status: accepted
---

# Accept a 60-minute session until the API grows refresh tokens

The API issues a JWT that lives 60 minutes and provides no refresh token, no logout, and no revocation. Pitaka Web stores the token in `localStorage`, attaches it via an interceptor, and on a 401 clears it and redirects to sign-in preserving a return URL. This is a workaround for a backend gap, not a design we like, and it is expected to be replaced by real refresh tokens as a joint frontend and backend change.

## Consequences

- **This ADR has a planned death date.** When refresh tokens land, the expiry handling here is deleted rather than extended. Do not build on it.
- `localStorage` is chosen because the alternatives are worse without a refresh token: `sessionStorage` dies with the tab and in-memory storage dies on every page refresh, so either would force a re-login on each F5. The XSS exposure is the accepted cost.
- A user can lose in-progress work when the hour lapses mid-task. We are accepting that until the real fix; it is the most visible defect in the app.
- On boot, a stored token is **verified** with `GET /api/auth/me` before the authenticated shell renders, not merely decoded. The API loads the user row on every request and returns 401 even for a cryptographically valid token if that row is gone — and the response supplies the current name and email the shell needs anyway, which a cached copy would serve stale.
- Registration chains straight into login, because `POST /register` returns no token.
