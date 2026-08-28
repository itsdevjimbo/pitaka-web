---
status: accepted
---

# Hand-write the API client instead of generating it from OpenAPI

The Pitaka API serves an OpenAPI document at `/openapi/v1.json`, so generating a typed client looks like the obvious move. It isn't: every action returns `Task<IActionResult>` and the codebase contains **zero** `[ProducesResponseType]` attributes, so the document carries no response schemas and no documented status codes. A generated client would type all ~50 calls as `any`, and we would hand-correct every one of them.

We therefore hand-write the TypeScript types and a thin service per resource over `HttpClient`.

## Consequences

- Hand-written types can encode contract truths OpenAPI structurally cannot: that `CategoryResource` omits the icon and colour it just accepted, that `PUT /transactions/{id}` writes only four fields and nulls omitted ones, that `TransferToAccountId` is required if and only if the type is `Transfer`.
- The client is the only place that knows the API returns **four** distinct failure shapes — ProblemDetails with a `detail`, ValidationProblemDetails with PascalCase `errors` keys, a bodyless 400 (ten call sites), and a bare JSON string on failed login. One interceptor normalises all four into a single error type; nothing above the adapter sees the difference.
- Where a bodyless 400 arrives, the UI states the possible causes and blames no individual field. A wrong red outline on the right field is worse than no outline. These are logged with their endpoint, to justify fixing them server-side later.
- Revisit if the endpoint count outgrows what one person can hold in their head, or if `[ProducesResponseType]` is added across the API — either would make generation genuinely cheaper than maintenance.
