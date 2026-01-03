# AGENTS.md Analysis & Testing Gaps

## Critical Problem Identified

**Issue**: Agent implements features, runs build, claims "it works" → breaks when user tests it.

**Root Cause**: AGENTS.md doesn't enforce a mandatory test-verify-commit workflow.

---

## Current State Analysis

### What Exists ✅
- 46 unit test files covering stores, components, libs, api, pages, services
- 7 e2e feature files with Gherkin scenarios
- Clear testing guidelines stating tests are "required"
- Good test infrastructure (vitest, playwright-bdd)

### What's Missing ❌

#### 1. **No Mandatory Test Execution Before Claiming Success**
Current workflow I followed for infinite loop fixes:
```
Fix code → Run `npm run build` → Commit → Push → "Done!"
```

What SHOULD happen:
```
Fix code → Run unit tests → Run relevant e2e tests → Verify pass → Commit → Push
```

**Evidence**: I fixed DashboardLayout.tsx infinite loop but never ran:
- `npm test` to verify no regressions
- `npm run test:e2e -- dashboard.feature` to verify widget adding still works
- I only ran `npm run build` which checks TypeScript compilation, not behavior

#### 2. **Weak Language Around Test Requirements**
Current: "Required for New Functionality and any changes to existing functionality"
Problem: "Required" but no enforcement or verification step

#### 3. **No Test Writing Guidance**
Recent changes I made:
- Added `imageLoaded` state to MontageMonitor.tsx (UI change) → No test written
- Fixed infinite loop in DashboardLayout.tsx (behavior change) → No test written
- Added skeleton loaders with aspect ratio (UI change) → No test written

AGENTS.md doesn't tell me:
- WHEN to write tests (before/during/after implementation)
- WHAT to test (specific scenarios to cover)
- HOW to verify tests catch the bug I'm fixing

#### 4. **Build ≠ Working**
I consistently ran `npm run build` and said "no errors" but:
- Build only checks TypeScript compilation
- Build doesn't verify UI renders correctly
- Build doesn't verify user interactions work
- Build doesn't catch runtime errors

#### 5. **Missing Test Coverage for Recent Work**
Files changed in last session:
- `Montage.tsx` - No unit test exists, e2e test doesn't cover skeleton loading
- `MontageMonitor.tsx` - No unit test exists
- `DashboardLayout.tsx` - Unit test exists but wasn't run or updated

E2E test gaps:
- `dashboard.feature` tests "Timeline" and "Monitor Stream" but NOT "Recent Events" widget
- Doesn't test adding multiple widgets in sequence (which triggers the infinite loop)
- Doesn't verify skeleton boxes show correct aspect ratio

---

## Proposed AGENTS.md Improvements

### 1. Add Mandatory "Verification Workflow" Section

```markdown
## Verification Workflow (MANDATORY)

**CRITICAL**: Never claim a fix works or mark a task complete without verification.

### For Every Code Change:

1. **Run Unit Tests**
   ```bash
   npm test
   ```
   - Tests must PASS (not just "no errors")
   - If tests fail → fix is NOT complete
   - If tests don't exist → WRITE THEM FIRST

2. **Run Type Check**
   ```bash
   npm run typecheck
   ```

3. **Run Build**
   ```bash
   npm run build
   ```

4. **Run Relevant E2E Tests**
   - UI changes: `npm run test:e2e -- <relevant-feature>.feature`
   - Navigation changes: `npm run test:e2e -- full-app-walkthrough.feature`
   - Full regression: `npm run test:e2e`

5. **Only After All Tests Pass**
   - Commit the code
   - State "Tests verified: [list which tests were run]"

### Build Success ≠ Working Code

- ✅ Build checks: TypeScript compilation
- ❌ Build does NOT check: UI rendering, user interactions, runtime behavior, edge cases

Never say "build succeeded, no errors" as proof that code works.
```

### 2. Strengthen Test Requirements

```markdown
## Testing (MANDATORY)

### Test-First Development

**Rule**: Write tests BEFORE or DURING implementation, not after.

**Why**: Tests written after are often skipped or forgotten.

**Workflow**:
1. Understand the bug/feature
2. Write a failing test that reproduces the issue
3. Implement the fix
4. Verify test now passes
5. Run full test suite to check for regressions

### Unit Tests (REQUIRED - No Exceptions)

**When**: For ALL code changes
- ✅ New functionality → Write new tests
- ✅ Bug fixes → Write test that reproduces bug
- ✅ Refactoring → Ensure existing tests still pass
- ✅ Changes to existing functionality → Update tests

**What to Test**:
- Happy path (normal usage)
- Edge cases (empty arrays, null values, boundary conditions)
- Error cases (network failures, invalid input)
- State changes (before/after behavior)

**Location**: Next to source in `__tests__/` subdirectory
**Run**: `npm test` (must complete in < 2 seconds)
**Coverage**: Aim for all logic paths covered

### E2E Tests (REQUIRED for UI/Navigation Changes)

**When**:
- ✅ Any UI component changes
- ✅ Any navigation/routing changes
- ✅ Any user interaction changes
- ✅ New user journeys

**What Counts as UI Change**:
- Adding/removing UI elements
- Changing how elements render
- Changing interaction behavior
- Adding skeleton loaders, loading states
- Changing layout or grid behavior

**Must Use Gherkin**: Write .feature files, never .spec.ts directly

**What to Test**:
- User can complete the intended action
- UI renders correctly in the new state
- Error states display properly
- Navigation works as expected

**Run**: `npm run test:e2e -- <feature-file>.feature`

### Test Updates (MANDATORY)

If you change ANY of the following, you MUST update tests:
- UI selectors (data-testid) → Update e2e tests
- Component props or behavior → Update unit tests
- Navigation routes → Update e2e tests
- Store actions/state shape → Update store tests
- API responses → Update API tests

**Verification**:
- Run affected tests
- Ensure they PASS
- If tests fail → fix tests AND code
```

### 3. Add "Test Coverage Checklist" to Pre-Commit

```markdown
## Pre-Commit Checklist

### ALL Changes (No Exceptions)
- [ ] Unit tests written/updated
- [ ] Unit tests run and PASS: `npm test`
- [ ] Type check passes: `npm run typecheck`
- [ ] Build succeeds: `npm run build`
- [ ] No console.* logging (use structured logging)

### UI Changes
- [ ] Data tags added for new/changed elements
- [ ] E2E tests written/updated in .feature file
- [ ] E2E tests run and PASS: `npm run test:e2e -- <feature>.feature`
- [ ] Responsive reflow verified (mobile portrait)
- [ ] All language files updated

### Functional Changes
- [ ] Test reproduces the bug/validates the feature
- [ ] Test passes with new code
- [ ] Full test suite passes (no regressions)
- [ ] Component-specific logging helpers used with explicit LogLevel

### Before Commit
- [ ] State which tests were run and passed
- [ ] Example: "Tests verified: npm test ✓, npm run test:e2e -- dashboard.feature ✓"

### Never Commit If
- ❌ Tests are failing
- ❌ Tests don't exist for new functionality
- ❌ You haven't run the tests
- ❌ Build fails
```

### 4. Add "What to Test" Examples

```markdown
## Testing Examples

### Example 1: Bug Fix (Infinite Loop)

**Bug**: Adding "Recent Events" widget causes infinite loop

**Test Approach**:
1. Write e2e test that adds Recent Events widget
2. Verify test fails with infinite loop error
3. Implement fix (use ref pattern in useCallback)
4. Verify test passes
5. Run full e2e suite to check no regressions

**Test Location**: `tests/features/dashboard.feature`
```gherkin
Scenario: Add Recent Events widget without infinite loop
  When I navigate to the "Dashboard" page
  When I open the Add Widget dialog
  And I select the "Events" widget type
  And I enter widget title "Recent Events"
  And I click the Add button in the dialog
  Then the widget "Recent Events" should appear on the dashboard
  And no console errors should be present
```

### Example 2: UI Change (Skeleton Loader)

**Feature**: Show skeleton with correct aspect ratio while image loads

**Test Approach**:
1. Write component test for MontageMonitor
2. Test that skeleton renders before image loads
3. Test that skeleton has correct aspect ratio style
4. Test that skeleton disappears after image loads
5. Write e2e test that verifies skeletons show on page load

**Test Location**: `src/components/monitors/__tests__/MontageMonitor.test.tsx`
```typescript
describe('MontageMonitor skeleton loading', () => {
  it('shows skeleton with correct aspect ratio before image loads', () => {
    const monitor = { Width: 1920, Height: 1080, ... };
    render(<MontageMonitor monitor={monitor} ... />);

    const skeleton = screen.getByText(/1920 × 1080/);
    expect(skeleton).toBeInTheDocument();
    expect(skeleton.parentElement).toHaveStyle({
      aspectRatio: '1.78' // 1920/1080
    });
  });

  it('hides skeleton after image loads', async () => {
    // ... test image load event hides skeleton
  });
});
```

### Example 3: Store Change (Dashboard Layout)

**Change**: Use ref pattern for profileId in useCallback

**Test Approach**:
1. Update existing dashboard store tests
2. Test that updateLayouts is called with correct profileId
3. Test that callback doesn't recreate on profileId change
4. Run store tests to verify

**Test Location**: `src/stores/__tests__/dashboard.test.ts`
```typescript
it('should update layouts with current profileId using ref', () => {
  // Test that profileId is correctly passed even when it changes
});
```
```

### 5. Add "Common Test Failures" Section

```markdown
## Common Testing Mistakes

### ❌ Mistake 1: Only Running Build
**Wrong**: "npm run build succeeded, no errors!"
**Right**: "Tests verified: npm test ✓, npm run test:e2e -- dashboard.feature ✓, npm run build ✓"

### ❌ Mistake 2: Skipping Test Updates
**Wrong**: Change data-testid → Don't update tests → Tests fail for user
**Right**: Change data-testid → Update affected e2e tests → Run tests → Verify pass

### ❌ Mistake 3: Not Testing the Actual Bug
**Wrong**: Fix infinite loop → Don't write test that adds Recent Events widget
**Right**: Fix infinite loop → Write test that specifically adds Recent Events widget and verifies no error

### ❌ Mistake 4: Assuming Tests Exist
**Wrong**: Change MontageMonitor.tsx → Assume tests exist → Don't check
**Right**: Change MontageMonitor.tsx → Check if tests exist → Write them if missing

### ❌ Mistake 5: Not Running E2E for UI Changes
**Wrong**: Add skeleton loader → Only run unit tests
**Right**: Add skeleton loader → Run unit tests + e2e tests that load the page
```

---

## Immediate Actions Needed

### 1. Write Missing Tests for Recent Changes
- [ ] `MontageMonitor.test.tsx` - Test skeleton loading with aspect ratio
- [ ] `Montage.test.tsx` - Test ResizeObserver and width measurement
- [ ] Update `dashboard.feature` - Add "Recent Events" widget scenario
- [ ] Update `dashboard.feature` - Add multiple widgets in sequence scenario

### 2. Run Full Test Suite
- [ ] `npm test` - Verify all unit tests pass
- [ ] `npm run test:e2e` - Verify all e2e tests pass
- [ ] Fix any failures before considering work complete

### 3. Document Test Commands
Add to AGENTS.md:
```markdown
## Test Commands Reference

### Unit Tests
- Run all: `npm test`
- Run specific file: `npm test -- MontageMonitor.test.tsx`
- Run with coverage: `npm test -- --coverage`
- Watch mode: `npm test -- --watch`

### E2E Tests
- Run all: `npm run test:e2e`
- Run specific feature: `npm run test:e2e -- dashboard.feature`
- Debug mode: `npm run test:e2e -- --debug`
- Headed mode: `npm run test:e2e -- --headed`

### Type Checking
- Run: `npm run typecheck`

### Build
- Run: `npm run build`
```

---

## Summary

### Current Problem
AGENTS.md says tests are "required" but doesn't enforce execution, leading to:
- Code that compiles but doesn't work
- Tests that exist but aren't run
- Tests that don't cover actual bugs being fixed

### Solution
1. **Mandatory verification workflow** - Must run tests before claiming success
2. **Stronger language** - "REQUIRED" → "REQUIRED (No Exceptions)"
3. **Test-first approach** - Write tests before/during implementation
4. **Clear examples** - Show exactly what to test for common scenarios
5. **Enforcement** - Pre-commit checklist that requires test verification

### Key Principle
**"Build passes" ≠ "Code works"**

Only when ALL tests pass can we claim code works:
- Unit tests validate logic
- E2E tests validate user experience
- Build validates compilation
- Together they validate the app works
