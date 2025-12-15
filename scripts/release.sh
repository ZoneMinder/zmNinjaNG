#!/bin/bash
set -e

# Function to read version from package.json
get_version() {
  if [ -f "app/package.json" ]; then
    grep '"version":' app/package.json | head -1 | awk -F: '{ print $2 }' | sed 's/[", ]//g'
  else
    echo "NONE"
  fi
}

VERSION=$(get_version)
if [[ "$VERSION" == "NONE" ]]; then
    echo "app/package.json not found. Please make sure you run ./scripts/release.sh from the root project dir"
    echo . 
    exit 1
fi

TAG="zmNg-$VERSION"

echo "==================================================="
echo "   ZoneMinder Next Gen (zmNg) Release Script"
echo "==================================================="
echo "Detected Version: $VERSION"
echo "Target Tag:       $TAG"
echo "==================================================="
echo ""
echo "This script will:"
echo "1. Create a local git tag '$TAG'"
echo "2. Push the tag to 'origin'"
echo "3. Trigger GitHub Actions workflows to build and release"
echo ""
read -p "Are you sure you want to proceed? (y/N) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Release cancelled."
    exit 1
fi

# Check if tag exists locally
if git rev-parse "$TAG" >/dev/null 2>&1; then
    echo "Error: Tag '$TAG' already exists locally."
    exit 1
fi

# Check if tag exists remotely
if git ls-remote --exit-code --tags origin "$TAG" >/dev/null 2>&1; then
    echo "Error: Tag '$TAG' already exists on remote."
    exit 1
fi

echo "Creating tag $TAG..."
git tag "$TAG"

echo "Pushing tag to origin..."
git push origin "$TAG"

echo ""
echo "✅ Standard release triggered! Check GitHub Actions for progress."
echo "   https://github.com/pliablepixels/zmNg/actions"

