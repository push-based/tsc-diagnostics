#!/bin/bash
set -e

# Optimized diagnostics workflow using CLI only
# Features:
# - Centralized output with TSD_OUTPUT
# - Single timestamp directory (no duplicates)
# - Automatic deduplication on aggregation
# - Clean summary

REPORTS_DIR="workflow/reports-clean"
PROJECTS_FILE="workflow/tsconfig-projects.txt"

# 1. Clear old reports
echo "🧹 Cleaning old reports..."
rm -rf "$REPORTS_DIR" 2>/dev/null
mkdir -p "$REPORTS_DIR"

# 2. Set centralized output
export TSD_OUTPUT="$REPORTS_DIR"

# 3. Read project count
total=$(wc -l < "$PROJECTS_FILE")
current=0
success=0
failed=0

echo "📊 Running extended diagnostics on $total projects..."
echo ""

# 4. Run diagnostics on each project
while IFS= read -r project; do
  current=$((current + 1))
  printf "[%3d/%d] %-50s" "$current" "$total" "$project"

  # Run with tsconfig.lib.json for consistent library measurement
  if npx tsc-diagnostics diagnostics "$project" \
      --mode extendedDiagnostics -p tsconfig.lib.json --trace 2>&1 > /dev/null; then
    echo " ✓"
    success=$((success + 1))
  else
    echo " ✗"
    failed=$((failed + 1))
  fi
done < "$PROJECTS_FILE"

echo ""
echo "✅ Diagnostics Complete"
echo "━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Total:   $total projects"
echo "Success: $success"
echo "Failed:  $failed"
echo "Rate:    $((success * 100 / total))%"
echo ""

# 5. Aggregate all reports
echo "📈 Aggregating reports..."
npx tsc-diagnostics aggregate \
    "$REPORTS_DIR/ts-diagnostics/**/*-ts-diagnostics.json" \
    -o workflow/diagnostics-final.json

echo ""
echo "✓ Reports:"
ls -lh workflow/diagnostics-final.*

# Show summary
echo ""
node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('workflow/diagnostics-final.json', 'utf8'));
console.log('📊 Final Summary');
console.log('━━━━━━━━━━━━━━━');
console.log('Total Configs:  ' + data.reportCount);
console.log('Timestamp:      ' + data.generatedAt);
"
