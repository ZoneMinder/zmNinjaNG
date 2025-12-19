#!/usr/bin/env node

/**
 * Synchronizes version from package.json to Tauri configuration files
 * Run this before building to ensure all version numbers match
 */

const fs = require('fs');
const path = require('path');

// Read version from package.json
const packageJsonPath = path.join(__dirname, '../app/package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version;

console.log(`Syncing version ${version} to Tauri config files...`);

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

console.log(`✅ All version numbers synced to ${version}`);
