---
status: accepted
---

# Translate three domain terms at the HTTP adapter

The API's names are mostly good, and Pitaka Web mirrors them — except in three places where mirroring would import an imprecision into the product's own language. `RecurringTransaction` becomes **Schedule**, because it is a standing instruction rather than money that has moved. The user-identity surface is never called an account, because `Account` already means a container of money; it is **Profile**. A transaction created by a schedule is a **generated transaction**, distinct from one a person typed.

Translation happens in the HTTP adapter and nowhere above it. See [CONTEXT.md](../../CONTEXT.md) for the full glossary.

## Consequences

- The translation budget is the small, explicit set recorded here and in its amendments. Every other API name passes through unchanged, because a translation layer that renames things for taste becomes a full-time job and a second vocabulary to learn.
- Route, folder, and type names above the adapter use the product term: `schedules`, not `recurring-transactions`.
- A future reader comparing the two repos will find `SchedulesService` calling `/api/recurring-transactions`. That mismatch is deliberate and lives in one file.

## Amendment (2026-09-13): Profile is now shared language

The API now calls the identity resource `Profile` too, so that term no longer needs translation at the adapter. The product meaning is unchanged; only Schedule and generated transaction still deliberately diverge from API names.

## Amendment (2026-09-15): A cancelled Schedule is Stopped

The product makes stopping a Schedule a deliberate terminal act, distinct from reversible Pause. The API calls that state `Cancelled` and currently permits it to return to `Active`; the client calls it **Stopped** and never offers that reversal. `Cancelled` therefore becomes **Stopped** at the Schedule HTTP adapter. The explicit translation set is again three terms: Schedule, generated transaction, and Stopped.
