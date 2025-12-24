# Development Guidelines

## Quick Reference
1. **Internationalization**: Update ALL language files (en, de, es, fr, zh + any future)
2. **Cross-platform**: iOS, Android, Desktop, mobile portrait
3. **Settings**: Must be profile-scoped; read/write via profile settings only
4. **Testing**: Data tags required, tests updated
5. **Logging**: Use component-specific helpers (e.g., `log.secureStorage(msg, LogLevel.INFO, details)`), never `console.*`
6. **Coding**: DRY principles, keep code files small and modular

---

## Internationalization

**Every user-facing string must be internationalized.**

- **Location**: `app/public/locales/{lang}/translation.json`
- **Current languages**: en, de, es, fr, zh
- **Rule**: Update ALL existing language directories, including any added in the future
- **Usage**:
  ```typescript
  const { t } = useTranslation();
  <Text>{t('setup.title')}</Text>
  ```
- **When adding text**: Add the same key to every translation.json file

---

## UI & Cross-Platform

**All UI must work across platforms and viewports.**

### Platform Support
- Test on iOS, Android, Desktop
- Verify mobile portrait reflow before committing
- Use responsive design patterns

### Data Tags (Required)
- **Format**: `data-testid="kebab-case-name"`
- **Add to**: All interactive elements and key containers
- **Examples**:
  ```tsx
  <div data-testid="profile-list">
    <div data-testid="profile-card">
      <button data-testid="add-profile-button">
        <span data-testid="profile-name">{name}</span>
  ```

### Navigation
- In-view clicks must use stacked navigation with back arrow
- Maintain proper routing history

---

## Testing

### Unit Tests (Required for New Functionality and any changes to existing functionality)
- **Location**: Next to source in `__tests__/` subdirectory
- **Example**: `app/src/lib/crypto.ts` → `app/src/lib/__tests__/crypto.test.ts`
- **Run**: `npm test` (fast, < 2 seconds)
- **Guide**: `app/tests/README.md`

### E2E Tests (Required for Large Changes or any UI changes)
- **Must start with Gherkin** - no non-Gherkin e2e tests
- **Location**: `app/tests/features/*.feature`
- **Steps**: `app/tests/steps.ts`
- **Run**: `npm run test:e2e`
- **Workflow**: Write .feature file → playwright-bdd generates .spec → run tests
- **Never** write .spec.ts files directly
- **Guide**: `app/tests/README.md`

### Test Updates
- If UI selectors change → update affected tests
- If navigation changes → update affected tests
- If functionality changes → update affected tests
- Tests must interact with UI elements, not just load views
- Use data-testid selectors for reliability
- Always make sure tests work for android (mobile devices use different files like capacitor HTTP that are not triggered when web/desktop are tested)

---

## Logging

**Never use console.* - always use structured logging.**

### Import
```typescript
import { log, LogLevel } from '../lib/logger'; // adjust path depth as needed
```

### Component-Specific Logging (Preferred)
Use component-specific helpers with explicit log levels:

```typescript
// Component-specific helpers automatically add { component: 'X' } context
log.secureStorage('Value encrypted', LogLevel.DEBUG, { key });
log.profileForm('Testing connection', LogLevel.INFO, { portalUrl });
log.monitorCard('Stream failed, regenerating connkey', LogLevel.WARN);
log.download('Failed to download file', LogLevel.ERROR, { url }, error);
```

**Available component helpers:**
- Services: `log.notifications()`, `log.profileService()`, `log.push()`
- Pages: `log.eventDetail()`, `log.monitorDetail()`, `log.profileForm()`
- Components: `log.monitorCard()`, `log.montageMonitor()`, `log.videoPlayer()`, `log.errorBoundary()`, `log.imageError()`
- Libraries: `log.download()`, `log.crypto()`, `log.http()`, `log.navigation()`, `log.secureStorage()`, `log.time()`, `log.discovery()`
- Stores: `log.dashboard()`, `log.queryCache()`
- Domain: `log.api()`, `log.auth()`, `log.profile()`, `log.monitor()`

**Signature:** `log.componentName(message: string, level: LogLevel, details?: unknown)`

### Standard Logging (Legacy - avoid for new code)
```typescript
log.debug(msg, context, ...args)
log.info(msg, context, ...args)
log.warn(msg, context, ...args)
log.error(msg, context, ...args)
```

### Best Practices
- ✅ Use component-specific helpers for all new logging
- ✅ Always specify explicit `LogLevel` (DEBUG, INFO, WARN, ERROR)
- ✅ Include relevant context in the `details` object
- ✅ Pass errors as part of `details`, not as separate arguments
- ❌ Don't manually add `{ component: 'X' }` - use helpers instead
- ❌ Don't use `console.log`, `console.error`, etc.

### Examples
```typescript
// Good ✅
log.secureStorage('Failed to encrypt value', LogLevel.ERROR, { key }, error);
log.monitorDetail('Regenerating connkey', LogLevel.INFO, { monitorId });

// Bad ❌
log.info('Failed to encrypt', { component: 'SecureStorage', key });
console.log('Regenerating connkey');
```

### Reference
- Full implementation: `app/src/lib/logger.ts`

---

## Settings & Data Management

### Profile-Scoped Settings
- Settings must be stored under `ProfileSettings` and read/write through `getProfileSettings(currentProfile?.id)` and `updateProfileSettings(profileId, ...)`.
- Do not read or write settings from any global singleton or module-level state.

### Breaking Changes
- Detect version/structure changes in stored data
- If incompatible → prompt user to reset (don't crash)
- Example: "Profile data format has changed. Reset to continue?"
- Avoid silent failures or complex auto-migrations

---

## Code Quality

### Keep It Simple
- DRY, modular, simple code
- Avoid duplication
- Don't over-engineer
- Three similar lines > premature abstraction

## Keep It Small
- Keep each file small (SLOC count) and cohesive

### Remove Legacy Code
- When replacing functionality, delete old code
- Don't leave unused files or commented code
- Clean as you go

### Documentation
- Write concise comments
- Avoid grandiose wording
- Comment the "why", not the "what"

---

## Platform-Specific Code

### iOS/Android Native Code
- Capacitor regenerates some files
- Check before modifying native code
- Document any custom native modifications
- Ensure changes won't be overwritten on regeneration

---

## Commits

- **CRITICAL:** Commit messages must be detailed and descriptive (no vague summaries).
- **CRITICAL:** Split unrelated changes into separate commits (one logical change per commit).
- **Use conventional commit format:**
    - `feat:` - New feature
    - `fix:` - Bug fix
    - `docs:` - Documentation
    - `test:` - Tests
    - `chore:` - Maintenance
    - `refactor:` - Code restructuring
- When you commit code, and the code contains multiple things, break each item into separate commits




## Issue handling
- When Github issues are created, make sure code fixes refer to that issue in commit messages
- Use `refs #<id>` for references and `fixes #<id>` when the commit should close the issue
- When working in github issues, make changes, validate tests and then ask me to test before pushing code to github

---

## Pre-Commit Checklist

### UI Changes
- [ ] Data tags added for new/changed elements
- [ ] Responsive reflow verified (mobile portrait)
- [ ] All language files updated
- [ ] Tests updated for selector/navigation changes

### Functional Changes
- [ ] Unit tests added/updated
- [ ] E2E tests updated if user journeys changed
- [ ] No crash on migration (prompt for reset if needed)
- [ ] Used component-specific logging helpers with explicit LogLevel (no console.*)

---
