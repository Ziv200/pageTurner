#!/bin/bash
cd "$(dirname "$0")"
echo "----------------------------------------"
echo "🚀 Starting Page Turner App..."
echo "----------------------------------------"

# Check if npm is available
if ! command -v npm &> /dev/null; then
    echo "❌ Error: 'npm' command not found."
    echo "Please ensure Node.js is installed and valid in your PATH."
    echo "PATH: $PATH"
else
    npm start
fi

echo ""
echo "----------------------------------------"
read -p "Press [Enter] to close this window..."
