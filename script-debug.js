// replace-console-logs.js - Run with Node.js to replace all console calls in .ts files
const fs = require('fs');
const path = require('path');

// Configuration
const TARGET_EXTENSION = '.ts';
const EXCLUDED_DIRS = ['node_modules', '.git', 'dist', 'build', 'coverage'];

/**
 * Recursively finds all TypeScript files in the directory tree
 * @param {string} dir - Directory to search
 * @param {string[]} fileList - Accumulator for found files
 * @returns {string[]} Array of file paths
 */
function findTypeScriptFiles(dir, fileList = []) {
    try {
        const files = fs.readdirSync(dir);
        
        files.forEach(file => {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);
            
            if (stat.isDirectory()) {
                // Skip excluded directories
                if (!EXCLUDED_DIRS.includes(file)) {
                    findTypeScriptFiles(filePath, fileList);
                }
            } else if (file.endsWith(TARGET_EXTENSION)) {
                fileList.push(filePath);
            }
        });
    } catch (error) {
        console.error(`Error reading directory ${dir}:`, error.message);
    }
    
    return fileList;
}

/**
 * Calculates the relative import path for the debug utility
 * @param {string} filePath - Path to the file being processed
 * @returns {string} Import statement
 */
function getDebugImportPath(filePath) {
    const relativePath = path.relative(path.dirname(filePath), 'src/utils/debug');
    const normalizedPath = relativePath.replace(/\\/g, '/');
    
    // Ensure the path starts with './' for relative imports
    const importPath = normalizedPath.startsWith('.') ? normalizedPath : `./${normalizedPath}`;
    
    return `import { debugLog } from '${importPath}';\n`;
}

/**
 * Processes a single TypeScript file to replace console calls
 * @param {string} filePath - Path to the file to process
 */
function processFile(filePath) {
    if (!fs.existsSync(filePath)) {
        console.log(`⚠️  File not found: ${filePath}`);
        return;
    }

    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;

    // Check if any console calls exist before processing
    const hasConsoleCalls = /console\.(log|warn|error|info|debug|trace|table|group|groupEnd|time|timeEnd|assert|clear|count|countReset|dir|dirxml)\s*\(/g.test(content);
    
    if (!hasConsoleCalls) {
        console.log(`⏭️  No console calls found: ${filePath}`);
        return;
    }

    // Add import if not already present and console calls exist
    if (!content.includes("import { debugLog } from")) {
        // Find the right place to add import (after other imports)
        const importRegex = /^((?:import.*?;?\n)*)/m;
        const match = content.match(importRegex);
        
        const importToAdd = getDebugImportPath(filePath);
        
        if (match) {
            const existingImports = match[1];
            if (existingImports.trim()) {
                // Add after existing imports
                content = content.replace(importRegex, existingImports + importToAdd);
            } else {
                // Add at the beginning if no imports exist
                content = importToAdd + content;
            }
            modified = true;
        }
    }

    // Define all console method replacements
    const consoleReplacements = [
        // Standard logging methods
        { pattern: /console\.log\(/g, replacement: 'debugLog.log(' },
        { pattern: /console\.warn\(/g, replacement: 'debugLog.warn(' },
        { pattern: /console\.error\(/g, replacement: 'debugLog.error(' },
        { pattern: /console\.info\(/g, replacement: 'debugLog.info(' },
        { pattern: /console\.debug\(/g, replacement: 'debugLog.debug(' },
        
        // Trace and debugging methods
        { pattern: /console\.trace\(/g, replacement: 'debugLog.trace(' },
        { pattern: /console\.table\(/g, replacement: 'debugLog.table(' },
        
        // Grouping methods
        { pattern: /console\.group\(/g, replacement: 'debugLog.group(' },
        { pattern: /console\.groupCollapsed\(/g, replacement: 'debugLog.groupCollapsed(' },
        { pattern: /console\.groupEnd\(/g, replacement: 'debugLog.groupEnd(' },
        
        // Timing methods
        { pattern: /console\.time\(/g, replacement: 'debugLog.time(' },
        { pattern: /console\.timeEnd\(/g, replacement: 'debugLog.timeEnd(' },
        { pattern: /console\.timeLog\(/g, replacement: 'debugLog.timeLog(' },
        
        // Counting methods
        { pattern: /console\.count\(/g, replacement: 'debugLog.count(' },
        { pattern: /console\.countReset\(/g, replacement: 'debugLog.countReset(' },
        
        // Other methods
        { pattern: /console\.assert\(/g, replacement: 'debugLog.assert(' },
        { pattern: /console\.clear\(/g, replacement: 'debugLog.clear(' },
        { pattern: /console\.dir\(/g, replacement: 'debugLog.dir(' },
        { pattern: /console\.dirxml\(/g, replacement: 'debugLog.dirxml(' }
    ];

    // Apply all replacements
    consoleReplacements.forEach(({ pattern, replacement }) => {
        const originalContent = content;
        content = content.replace(pattern, replacement);
        if (content !== originalContent) {
            modified = true;
        }
    });

    // Handle special debug section patterns (preserve existing functionality)
    const originalContent = content;
    content = content.replace(
        /console\.log\('=== (.+?) ==='\);/g,
        (match, label) => {
            return `debugLog.group('${label}');`;
        }
    );
    if (content !== originalContent) {
        modified = true;
    }

    // Write changes back to file
    if (modified) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`✅ Processed: ${filePath}`);
    } else {
        console.log(`⏭️  No changes needed: ${filePath}`);
    }
}

/**
 * Main execution function
 */
function main() {
    console.log('🔧 Finding and replacing console calls in TypeScript files...\n');
    
    const startTime = Date.now();
    const currentDir = process.cwd();
    console.log(`📁 Searching from: ${currentDir}\n`);
    
    // Find all TypeScript files recursively
    const tsFiles = findTypeScriptFiles(currentDir);
    
    if (tsFiles.length === 0) {
        console.log('❌ No TypeScript files found in the current directory tree.');
        return;
    }
    
    console.log(`📋 Found ${tsFiles.length} TypeScript file(s):\n`);
    tsFiles.forEach(file => console.log(`   ${file}`));
    console.log();
    
    // Process each file
    let processedCount = 0;
    let modifiedCount = 0;
    
    tsFiles.forEach(filePath => {
        const beforeContent = fs.readFileSync(filePath, 'utf8');
        processFile(filePath);
        const afterContent = fs.readFileSync(filePath, 'utf8');
        
        processedCount++;
        if (beforeContent !== afterContent) {
            modifiedCount++;
        }
    });
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.log('\n📊 Summary:');
    console.log(`   Files processed: ${processedCount}`);
    console.log(`   Files modified: ${modifiedCount}`);
    console.log(`   Duration: ${duration}ms`);
    
    console.log('\n✨ Done! Remember to:');
    console.log('1. Add debugMode to your LinearPluginSettings interface');
    console.log('2. Add debug toggle to settings tab');
    console.log('3. Initialize debug mode in main.ts');
    console.log('4. Ensure your debugLog utility supports all the console methods used');
    console.log('5. Test the debug toggle in plugin settings');
}

// Run the script
main();