#!/usr/bin/env node

/**
 * Synchronizes version from package.json to Tauri and iOS configuration files.
 * Run this before building to ensure all version numbers match.
 */

const fs = require('fs');
const path = require('path');

// Read version from package.json
const packageJsonPath = path.join(__dirname, '../app/package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version;

console.log(`Syncing version ${version} to config files...`);

// Update tauri.conf.json
const tauriConfPath = path.join(__dirname, '../app/src-tauri/tauri.conf.json');
const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
tauriConf.version = version;
fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');
console.log(`✓ Updated ${tauriConfPath}`);

// Update Cargo.toml
const cargoTomlPath = path.join(__dirname, '../app/src-tauri/Cargo.toml');
let cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');
cargoToml = cargoToml.replace(
  /^version = ".*"$/m,
  `version = "${version}"`
);
fs.writeFileSync(cargoTomlPath, cargoToml);
console.log(`✓ Updated ${cargoTomlPath}`);

// Update iOS project.pbxproj — MARKETING_VERSION and CURRENT_PROJECT_VERSION
const pbxprojPath = path.join(__dirname, '../app/ios/App/App.xcodeproj/project.pbxproj');
if (fs.existsSync(pbxprojPath)) {
  let pbxproj = fs.readFileSync(pbxprojPath, 'utf8');

  // MARKETING_VERSION uses major.minor (e.g., "0.2" from "0.2.4")
  const parts = version.split('.');
  const marketingVersion = `${parts[0]}.${parts[1]}`;

  // Read current CURRENT_PROJECT_VERSION and increment it
  const buildNumMatch = pbxproj.match(/CURRENT_PROJECT_VERSION = (\d+);/);
  const currentBuildNum = buildNumMatch ? parseInt(buildNumMatch[1], 10) : 0;
  const newBuildNum = currentBuildNum + 1;

  // Replace all MARKETING_VERSION entries
  pbxproj = pbxproj.replace(
    /MARKETING_VERSION = [^;]+;/g,
    `MARKETING_VERSION = ${marketingVersion};`
  );

  // Replace all CURRENT_PROJECT_VERSION entries
  pbxproj = pbxproj.replace(
    /CURRENT_PROJECT_VERSION = \d+;/g,
    `CURRENT_PROJECT_VERSION = ${newBuildNum};`
  );

  fs.writeFileSync(pbxprojPath, pbxproj);
  console.log(`✓ Updated ${pbxprojPath} (MARKETING_VERSION=${marketingVersion}, build=${newBuildNum})`);
} else {
  console.log(`⚠ Skipped iOS pbxproj (not found at ${pbxprojPath})`);
}

console.log(`✅ All version numbers synced to ${version}`);
