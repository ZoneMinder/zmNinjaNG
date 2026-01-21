# zmNg Developer Guide

This guide teaches you how to work on the zmNg codebase. It's written for developers who may not have React experience, explaining concepts from first principles with real examples from the code.

## How to Use This Guide

**New to React?** Start with Chapter 2 (React Fundamentals), then Chapter 3 (Zustand). These explain the core concepts you'll encounter throughout the codebase.

**Adding a feature?** Read Chapter 9 (Contributing) for the workflow, then Chapter 6 (Testing) to understand the test requirements.

**Debugging an issue?** Check Chapter 8 (Common Pitfalls) - it catalogs the bugs we've hit before and how to avoid them.

**Understanding the architecture?** Chapter 5 (Component Architecture) explains how files are organized, and Chapter 11 (Application Lifecycle) explains how the app runs from start to finish.

## Table of Contents

1. **[Introduction](./01-introduction.md)**
   - What is zmNg
   - Who this guide is for
   - Learning path recommendations

2. **[React Fundamentals](./02-react-fundamentals.md)**
   - What is React and how it works
   - Components, props, and state
   - Hooks (useState, useEffect, useCallback, useRef, useMemo)
   - Rendering and re-rendering explained
   - Object identity and why it matters

3. **[State Management with Zustand](./03-state-management-zustand.md)**
   - Why global state management
   - Creating and using stores
   - Selectors for optimizing re-renders
   - Persistence and working outside React
   - **Critical**: Object references and infinite loops (preview)

4. **[Pages and Views](./04-pages-and-views.md)**
   - Dashboard page and DashboardLayout
   - Montage page for multi-monitor view
   - Monitors, Events, and Settings pages
   - **Real Example**: Infinite loop bugs and fixes with actual code
   - ResizeObserver pattern and the ref solution

5. **[Component Architecture](./05-component-architecture.md)**
   - Component organization (monitors/, dashboard/, events/, ui/)
   - MonitorCard and MontageMonitor components
   - Dashboard widgets and grid layout
   - Event components and video player
   - Testing data attributes and patterns

6. **[Testing Strategy](./06-testing-strategy.md)**
   - Unit tests with Vitest and React Testing Library
   - E2E tests with Playwright and Gherkin
   - Test organization and running tests
   - Dynamic selectors for server-agnostic tests
   - Test-driven development workflow

7. **[API and Data Fetching](./07-api-and-data-fetching.md)**
   - ZoneMinder API overview
   - Authentication and connection keys
   - React Query integration
   - Queries, mutations, and infinite queries
   - Complete data flow example

8. **[Common Pitfalls](./08-common-pitfalls.md)**
   - React pitfalls (unstable dependencies, missing cleanup, etc.)
   - Zustand pitfalls (object references as dependencies)
   - React Query pitfalls (missing enabled, incorrect keys)
   - Testing pitfalls (hardcoded values, missing mocks)
   - Performance, i18n, and security issues
   - Pre-code review checklist

9. **[Contributing](./09-contributing.md)**
   - Development workflow
   - Branch naming and commit messages
   - Testing requirements
   - Code review guidelines
   - Common contribution scenarios

10. **[Key Libraries](./10-key-libraries.md)**
    - UI and Visualization (react-grid-layout, vis-timeline)
    - Data and Logic (date-fns, react-hook-form)
    - Mobile Platform (@capacitor)

11. **[Application Lifecycle](./11-application-lifecycle.md)**
    - The "Runtime Map" from entry point to main loop
    - Authentication, Hydration, and Mobile Lifecycle

12. **[Shared Services and Components](./12-shared-services-and-components.md)**
    - Logger, HTTP Client, Download Utilities
    - Proxy Utils, URL Builder, Time Utils
    - Crypto, Secure Storage, Platform Detection
    - Reusable UI Components
    - Domain Components and Usage Patterns


---

## Key Concepts (Quick Reference)

### The Three Rules

1. **Never use `console.*`** - Use `log.componentName(message, LogLevel.X)` from `lib/logger.ts`
2. **Never use raw `fetch()`** - Use `httpGet`, `httpPost` from `lib/http.ts`
3. **Never skip tests** - Write tests before/during implementation, verify they pass

### State Types

| Type | Where | Example | When to Use |
|------|-------|---------|-------------|
| **Local** | `useState` | Form inputs, UI toggles | Component-specific, temporary |
| **Global** | Zustand stores | Current profile, settings | Shared across components |
| **Server** | React Query | Monitor list, events | Data from ZoneMinder API |

### File Organization

```
src/
├── api/          # API functions (thin wrappers around http client)
├── components/   # React components (visual)
├── hooks/        # Custom React hooks (component logic)
├── lib/          # Pure utilities (no React dependencies)
├── pages/        # Route-level views
├── services/     # Platform-specific code (Capacitor plugins)
├── stores/       # Global state (Zustand)
└── locales/      # i18n translations (en, de, es, fr, zh)
```

### Common Patterns

```tsx
// Logging (never use console.*)
import { log, LogLevel } from '../lib/logger';
log.monitor('Stream started', LogLevel.INFO, { monitorId });

// HTTP requests (never use raw fetch)
import { httpGet, httpPost } from '../lib/http';
const data = await httpGet<MonitorsResponse>(url, { token });

// Translations (never hardcode strings)
const { t } = useTranslation();
<Button>{t('common.delete')}</Button>

// Test selectors (always add data-testid)
<Button data-testid="delete-button">{t('common.delete')}</Button>
```

---

## Quick Start

```bash
cd app
npm install
npm run dev      # Start development server
npm test         # Run unit tests
npm run build    # Build for production
```

### Reading Order

**New to React:**
1. Chapter 2: React Fundamentals
2. Chapter 3: State Management (Zustand)
3. Chapter 4: Pages and Views
4. Chapter 6: Testing Strategy

**Experienced React developers:**
1. Chapter 3: Zustand patterns
2. Chapter 4: Infinite loop issues (important!)
3. Chapter 8: Common Pitfalls

**Before contributing:**
1. Chapters 4-5: Understand the codebase
2. Chapter 6: Testing requirements
3. Chapter 9: Contribution workflow
4. Check `AGENTS.md` for all requirements


## Additional Resources

- **AGENTS.md**: Development guidelines and pre-commit checklist
- **tests/README.md**: Testing documentation

## Getting Help

- Questions about code: Review relevant chapter in this guide
- Bug reports: Create GitHub issue
- Feature requests: Create GitHub issue
- Contributing: See **Chapter 9**

## Contributing

We welcome contributions! Please read **[Chapter 9: Contributing](./09-contributing.md)** for the complete workflow and guidelines.

Key points:
- Write tests BEFORE or DURING implementation
- Update all language files
- Follow commit message format
- Verify all tests pass before pushing
- Reference issues in commits

## License

See LICENSE file in repository root.
