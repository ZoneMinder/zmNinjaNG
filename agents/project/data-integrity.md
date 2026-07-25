# Data integrity playbook

Read before assistant tools, WebLLM configuration, or ZoneMinder schemas.

- A library's merged configuration is unknown until runtime verifies it. Absence in one source layer proves nothing.
- Treat every model tool argument as untrusted. Validate at `execute` entry, name valid values on failure, then query.
- ZoneMinder fields drift. Schemas must use `withFieldCatch(shape, identity)`; arrays use `tolerantArray(itemSchema, label)`.
- Keep unknown response fields stripped, never strict. ZoneMinder-controlled vocabularies use `z.string()`, not `z.enum()`.
- A row failing identity drops. A field failing type falls back to a type-matching default. Remain strict for values sent to ZoneMinder.
- Update `api/__tests__/types.test.ts` when adding schemas.
