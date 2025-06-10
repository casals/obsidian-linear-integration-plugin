#!/bin/bash

# Linear Obsidian Plugin Build Script

echo "🔧 Building Linear Obsidian Plugin..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 16+ first."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Run TypeScript check
echo "🔍 Running TypeScript checks..."
npx tsc --noEmit --skipLibCheck

if [ $? -ne 0 ]; then
    echo "❌ TypeScript check failed. Please fix the errors above."
    exit 1
fi

# Build the plugin
echo "🏗️ Building plugin..."
npm run build

if [ $? -eq 0 ]; then
    echo "✅ Build completed successfully!"
    echo ""
    echo "📁 Output files:"
    echo "   - main.js"
    echo "   - manifest.json" 
    echo "   - styles.css"
    echo ""
    echo "🚀 To install in Obsidian:"
    echo "   1. Copy these files to: .obsidian/plugins/linear-integration/"
    echo "   2. Enable the plugin in Obsidian Settings > Community Plugins"
    echo ""
else
    echo "❌ Build failed. Check the errors above."
    exit 1
fi