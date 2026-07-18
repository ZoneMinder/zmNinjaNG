# Documentation playbook

Read before editing user or developer documentation.

## Scope

- User-visible behavior changes update `docs/user-guide/`.
- New APIs, components, hooks, utilities, services, or traced paths update `docs/developer-guide/`.
- A changed user-visible flow updates its trace in `call-flows.rst`. Add a trace only for a main journey not already covered.
- Developer docs teach a competent programmer with no React experience. Explain a React mechanism where it first affects behavior, or link `02-react-fundamentals.rst`.

## Placement

- API modules: `07-api-and-data-fetching.rst`
- Feature components: `05-component-architecture.rst`
- Shared components, utilities, services: `12-shared-services-and-components.rst`
- Hooks: feature chapter they serve

Connect each artifact to its user-visible behavior and relevant flow. Examples must grep-hit the codebase, unless explicitly marked simplified. Use exact constants, verify cross-reference targets, and state platform gotchas.

## Call flows

- Name flow after user action.
- Start with whole shape and one counterintuitive fact.
- Use one Mermaid sequence or graph diagram.
- Give 8 to 14 numbered steps: behavior, exact file and symbol, ordering reason, source link, and reference chapter.
- State important absences where a reader would expect behavior.
- End with adjacent flow.

## Style

- Follow `01-introduction.rst` tone and `call-flows.rst` structure.
- No top-level TOC, next-step section, recap, em-dash, or padded rewrite.
- RST links use `:doc:`; Markdown links use `{doc}`.
- Before committing a new or rewritten chapter, run banned-word and em-dash checks from the previous version of this guidance.
- Developer docs cite AGENTS rule numbers instead of copying process rules.

