# Development Guidelines

## Quick Reference
1. **Internationalization**: Update ALL language files (en, de, es, fr, zh + any future)
2. **Cross-platform**: iOS, Android, Desktop, mobile portrait
3. **Settings**: Profile-scoped, never global
4. **Testing**: Data tags required, tests updated
5. **Logging**: Use log.* functions, never console.*

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

### Unit Tests (Required for New Functionality)
- **Location**: Next to source in `__tests__/` subdirectory
- **Example**: `app/src/lib/crypto.ts` → `app/src/lib/__tests__/crypto.test.ts`
- **Run**: `npm test` (fast, < 2 seconds)
- **Guide**: `app/tests/README.md`

### E2E Tests (Required for Large Changes)
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
- Tests must interact with UI elements, not just load views
- Use data-testid selectors for reliability

---

## Logging

**Never use console.* - always use structured logging.**

### Import
```typescript
import { log } from '../lib/logger'; // adjust path depth as needed
```

### Methods
- **Standard**: `log.debug(msg, context, ...args)`, `log.info()`, `log.warn()`, `log.error()`
- **Domain-specific**: `log.api(msg, details)`, `log.auth()`, `log.profile()`, `log.monitor()`

### Context Format
```typescript
log.info('Profile loaded', { component: 'Profiles', action: 'loadProfile', profileId: id })
```

### Reference
- Full implementation: `app/src/lib/logger.ts:177-190`

---

## Settings & Data Management

### Profile-Scoped Settings
- Settings belong to individual profiles, not global app config
- **Ask**: "Does this apply per-server or globally?"
  - Per-server → profile-scoped
  - App-wide (theme, language) → global store
- **Access**: `useProfileStore → currentProfile() → settings`

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

**Use conventional commit format:**
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation
- `test:` - Tests
- `chore:` - Maintenance
- `refactor:` - Code restructuring

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
- [ ] Used log.* functions (no console.*)

---
