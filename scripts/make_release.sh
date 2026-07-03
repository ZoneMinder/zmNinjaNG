#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_DIR"

PKG_JSON="app/package.json"
SYNC_SCRIPT="scripts/sync-version.js"

# --- Read version ---
get_version() {
  if [ -f "$PKG_JSON" ]; then
    grep '"version":' "$PKG_JSON" | head -1 | awk -F: '{ print $2 }' | sed 's/[", ]//g'
  else
    echo "NONE"
  fi
}

# --- Update version in package.json, then sync to platform configs ---
set_version() {
    local new_ver="$1"
    sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"${new_ver}\"/" "$PKG_JSON"
    node "$SYNC_SCRIPT"
}

VERSION=$(get_version)
if [[ "$VERSION" == "NONE" ]]; then
    echo "$PKG_JSON not found. Run ./scripts/make_release.sh from the project root."
    exit 1
fi

TAG="zmNinjaNg-$VERSION"

echo "==================================================="
echo "   zmNinjaNg Release Script"
echo "==================================================="
echo "Detected Version: $VERSION"
echo "Target Tag:       $TAG"
echo "==================================================="
echo ""

# Get current branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

# --- Step 1: Check if tag already exists ---
TAG_EXISTS=false
if git rev-parse "$TAG" >/dev/null 2>&1; then
    TAG_EXISTS=true
fi
if git ls-remote --exit-code --tags origin "$TAG" >/dev/null 2>&1; then
    TAG_EXISTS=true
fi

# Draft cache shared between the bump suggestion below and the developer-notice
# step later, so Claude is called at most once per release. Cleaned up on exit.
RELEASE_DRAFT_CACHE="$(mktemp -t zmninja-release-draft.XXXXXX)"
DRAFT_CACHE_VALID=false
OVERWRITE_TAG=false
cleanup() { rm -f "$RELEASE_DRAFT_CACHE"; }
trap cleanup EXIT

# Commit and push a version bump, then update VERSION/TAG for the rest of the run.
apply_bump() {
    local new_ver="$1"
    echo ""
    echo "Bumping version: $VERSION -> $new_ver"
    set_version "$new_ver"
    VERSION="$new_ver"
    TAG="zmNinjaNg-$VERSION"
    git add "$PKG_JSON" app/ios/App/App.xcodeproj/project.pbxproj app/android/app/build.gradle
    git commit -m "chore: bump version to $VERSION"
    git push origin "$CURRENT_BRANCH"
    echo "✅ Version bumped to $VERSION, committed and pushed"
    echo ""
}

if [ "$TAG_EXISTS" = true ]; then
    # Deterministic bump targets for the menu (also the fallback when Claude is unavailable).
    MAJOR=$(echo "$VERSION" | cut -d. -f1)
    MINOR=$(echo "$VERSION" | cut -d. -f2)
    PATCH=$(echo "$VERSION" | cut -d. -f3)
    V_PATCH="${MAJOR}.${MINOR}.$((PATCH + 1))"
    V_MINOR="${MAJOR}.$((MINOR + 1)).0"
    V_MAJOR="$((MAJOR + 1)).0.0"

    echo "⚠️  Tag '$TAG' already exists. You likely want a new version."
    echo ""
    echo "Analyzing closed issues to recommend a bump (one Claude call, closed-issue based)..."

    # --plan is best-effort: it always exits 0. Human progress prints to stderr
    # (visible); the KEY=VALUE result lines print to stdout (captured here).
    PLAN_OUT="$(node scripts/generate_notice.mjs --plan --version "$VERSION" --cache "$RELEASE_DRAFT_CACHE")" || true
    REC_BUMP="$(printf '%s\n' "$PLAN_OUT" | sed -n 's/^RECOMMENDED_BUMP=//p' | tail -1)"
    SUGGESTED_VERSION="$(printf '%s\n' "$PLAN_OUT" | sed -n 's/^SUGGESTED_VERSION=//p' | tail -1)"

    if [ -n "$REC_BUMP" ] && [ -n "$SUGGESTED_VERSION" ]; then
        DRAFT_CACHE_VALID=true
        echo ""
        echo "🤖 Claude recommends a ${REC_BUMP} release: $VERSION -> ${SUGGESTED_VERSION}"
    else
        REC_BUMP="patch"
        SUGGESTED_VERSION="$V_PATCH"
        echo ""
        echo "ℹ️  No Claude suggestion available. Defaulting to a patch bump; you can still choose below."
    fi

    echo ""
    echo "How should this release be versioned?"
    echo "  1) Suggested: ${REC_BUMP} -> ${SUGGESTED_VERSION}"
    echo "  2) patch      -> ${V_PATCH}"
    echo "  3) minor      -> ${V_MINOR}"
    echo "  4) major      -> ${V_MAJOR}"
    echo "  5) Enter a version manually"
    echo "  6) Move existing tag to current commit (no bump, overwrite)"
    read -p "Choose [1-6] or anything else to abort: " choice
    case "$choice" in
        1) apply_bump "$SUGGESTED_VERSION" ;;
        2) apply_bump "$V_PATCH" ;;
        3) apply_bump "$V_MINOR" ;;
        4) apply_bump "$V_MAJOR" ;;
        5)
            read -p "New version (X.Y.Z): " manual_ver
            if ! printf '%s' "$manual_ver" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
                echo "❌ '$manual_ver' is not a valid X.Y.Z version. Aborting."
                exit 1
            fi
            apply_bump "$manual_ver"
            ;;
        6)
            echo ""
            echo "Will move tag '$TAG' to current commit."
            OVERWRITE_TAG=true
            echo ""
            ;;
        *)
            echo "Aborted."
            exit 0
            ;;
    esac
fi

# --- Step 2: Check for uncommitted changes ---
DIRTY_FILES=$(git status --porcelain)
if [ -n "$DIRTY_FILES" ]; then
    echo "❌ Error: You have uncommitted changes in your working directory."
    echo ""
    git status --short
    echo ""
    echo "Please commit or stash your changes before creating a release."
    exit 1
fi

# Check if branch has an upstream
if ! git rev-parse --abbrev-ref @{u} >/dev/null 2>&1; then
    echo "❌ Error: Current branch '$CURRENT_BRANCH' has no upstream branch."
    echo ""
    echo "Please push your branch first:"
    echo "  git push -u origin $CURRENT_BRANCH"
    echo ""
    exit 1
fi

# Check for unpushed commits
UNPUSHED=$(git rev-list @{u}..HEAD --count)
if [[ "$UNPUSHED" -gt 0 ]]; then
    echo "❌ Error: You have $UNPUSHED unpushed commit(s) on branch '$CURRENT_BRANCH'."
    echo ""
    echo "Please push your commits before creating a release:"
    echo "  git push origin $CURRENT_BRANCH"
    echo ""
    exit 1
fi

echo "✅ Working directory is clean"
echo "✅ All commits are pushed to origin"
echo ""

# --- Confirm before proceeding ---
REMOTE_URL=$(git remote get-url origin)
echo "--- Release summary ---"
echo "  Version:  $VERSION"
echo "  Tag:      $TAG"
echo "  Branch:   $CURRENT_BRANCH"
echo "  Remote:   $REMOTE_URL"
echo ""
echo "This will:"
echo "  1. Generate CHANGELOG.md"
echo "  2. Create and push git tag '$TAG'"
echo "  3. Trigger GitHub Actions to build and create release"
echo ""
read -p "Proceed? [y/N] " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi

# --- Step 3: Generate changelog ---
if [ -f "Gemfile" ] && command -v bundle &> /dev/null; then
    echo ""
    echo "📋 Generating CHANGELOG.md..."
    if CHANGELOG_GITHUB_TOKEN=$(gh auth token 2>/dev/null) bundle exec github_changelog_generator --future-release "$TAG"; then
        if [[ -n $(git diff --name-only CHANGELOG.md 2>/dev/null) ]] || [[ -n $(git ls-files --others --exclude-standard CHANGELOG.md 2>/dev/null) ]]; then
            echo "📝 CHANGELOG.md updated, committing..."
            git add CHANGELOG.md
            git commit -m "chore: update CHANGELOG.md for $TAG"
            git push origin "$CURRENT_BRANCH"
            echo "✅ CHANGELOG.md committed and pushed"
        else
            echo "ℹ️  CHANGELOG.md unchanged"
        fi
    else
        echo "❌ Changelog generation failed"
        exit 1
    fi
else
    echo ""
    echo "❌ Gemfile or bundler not found"
    echo "   Run: bundle install"
    exit 1
fi

# --- Step 3.5: Developer notice (minor/major releases only) ---
# Offer a notice only for minor/major releases (patch = 0) that don't already
# have one. When the bump step above already ran --plan, reuse that cached draft
# so Claude is not called a second time; otherwise generate_notice makes its own
# call. It halts the release on any failure (no error guard): a missing tool or
# unparseable draft must stop the release, not ship silently.
NOTICE_PATCH=$(echo "$VERSION" | cut -d. -f3)
if [ "$NOTICE_PATCH" = "0" ] && ! grep -qF "\"release-$VERSION\"" docs/notices.json 2>/dev/null; then
    echo ""
    read -p "Generate a developer notice for $VERSION? [y/N] " -r
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        if [ "$DRAFT_CACHE_VALID" = true ] && [ -s "$RELEASE_DRAFT_CACHE" ]; then
            echo "Reusing the draft Claude already produced for the bump (no second Claude call)."
            node scripts/generate_notice.mjs --write --version "$VERSION" --cache "$RELEASE_DRAFT_CACHE"
        else
            node scripts/generate_notice.mjs "$VERSION"
        fi
        # generate_notice only writes docs/notices.json; commit and push it so
        # the release ships the notice (the feed is served from this branch).
        if [[ -n $(git status --porcelain docs/notices.json) ]]; then
            git add docs/notices.json
            git commit -m "chore: add release notice for $VERSION"
            git push origin "$CURRENT_BRANCH"
        fi
    fi
fi

# --- Step 4: Tag ---
if [ "$OVERWRITE_TAG" = true ]; then
    echo ""
    echo "Removing existing tag $TAG..."
    git tag -d "$TAG" 2>/dev/null || true
    git push origin --delete "$TAG" 2>/dev/null || true
fi

echo ""
echo "Creating tag $TAG..."
git tag "$TAG"

echo "Pushing tag to origin..."
git push origin "$TAG" --force

echo ""
echo "✅ Release triggered! Check GitHub Actions for progress."
echo "   https://github.com/ZoneMinder/zmNinjaNg/actions"
echo ""
echo "The create-release workflow will:"
echo "  - Generate release notes with changelog"
echo "  - Create the GitHub Release"
echo "  - Build workflows will attach platform binaries"
