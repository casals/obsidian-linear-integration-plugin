#!/usr/bin/env node

// Build verification script for Linear Obsidian Plugin

const fs = require('fs');
const path = require('path');

console.log('🔍 Verifying Linear Obsidian Plugin build...\n');

// Check required files exist
const requiredFiles = [
    'main.ts',
    'manifest.json',
    'package.json',
    'tsconfig.json',
    'styles.css',
    'versions.json',
    'esbuild.config.mjs'
];

const requiredSourceFiles = [
    'src/api/linear-client.ts',
    'src/features/autocomplete-system.ts',
    'src/features/conflict-resolver.ts',
    'src/features/local-config-system.ts',
    'src/models/types.ts',
    'src/parsers/markdown-parser.ts',
    'src/sync/sync-manager.ts',
    'src/ui/issue-modal.ts',
    'src/ui/settings-tab.ts',
    'src/utils/frontmatter.ts'
];

let allFilesExist = true;

console.log('📁 Checking core files...');
requiredFiles.forEach(file => {
    if (fs.existsSync(file)) {
        console.log(`  ✅ ${file}`);
    } else {
        console.log(`  ❌ ${file} - MISSING`);
        allFilesExist = false;
    }
});

console.log('\n📁 Checking source files...');
requiredSourceFiles.forEach(file => {
    if (fs.existsSync(file)) {
        console.log(`  ✅ ${file}`);
    } else {
        console.log(`  ❌ ${file} - MISSING`);
        allFilesExist = false;
    }
});

// Check package.json structure
console.log('\n📦 Checking package.json...');
try {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    
    const requiredScripts = ['build', 'dev'];
    const requiredDevDeps = ['typescript', 'esbuild', 'obsidian'];
    
    requiredScripts.forEach(script => {
        if (packageJson.scripts && packageJson.scripts[script]) {
            console.log(`  ✅ Script: ${script}`);
        } else {
            console.log(`  ❌ Script: ${script} - MISSING`);
            allFilesExist = false;
        }
    });
    
    requiredDevDeps.forEach(dep => {
        if (packageJson.devDependencies && packageJson.devDependencies[dep]) {
            console.log(`  ✅ Dependency: ${dep}`);
        } else {
            console.log(`  ❌ Dependency: ${dep} - MISSING`);
            allFilesExist = false;
        }
    });
    
} catch (error) {
    console.log(`  ❌ package.json parsing failed: ${error.message}`);
    allFilesExist = false;
}

// Check manifest.json structure
console.log('\n📋 Checking manifest.json...');
try {
    const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
    
    const requiredFields = ['id', 'name', 'version', 'minAppVersion', 'description', 'author'];
    
    requiredFields.forEach(field => {
        if (manifest[field]) {
            console.log(`  ✅ Field: ${field}`);
        } else {
            console.log(`  ❌ Field: ${field} - MISSING`);
            allFilesExist = false;
        }
    });
    
} catch (error) {
    console.log(`  ❌ manifest.json parsing failed: ${error.message}`);
    allFilesExist = false;
}

// Check TypeScript config
console.log('\n⚙️ Checking tsconfig.json...');
try {
    const tsconfig = JSON.parse(fs.readFileSync('tsconfig.json', 'utf8'));
    
    if (tsconfig.compilerOptions) {