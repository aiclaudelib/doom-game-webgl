set -uo pipefail

REPORT_DIR="report/jscpd"
REPORT_FILE="$REPORT_DIR/jscpd-report.json"

rm -rf "$REPORT_DIR"

echo "🔍 Checking for code duplicates..."

bun run copies 2>&1 || true
JSCPD_EXIT=${PIPESTATUS[0]}

if [ ! -f "$REPORT_FILE" ]; then
  echo "⚠️  jscpd report not generated at $REPORT_FILE"
  exit "${JSCPD_EXIT:-1}"
fi

node -e "
  const r = require('./$REPORT_FILE');
  const dupes = r.duplicates || [];
  if (dupes.length === 0) {
    console.log('✅ No code duplicates found.');
    process.exit(0);
  }
  console.log('');
  console.log('📋 Duplicate report (' + dupes.length + ' clone(s)):');
  console.log('');
  for (const d of dupes) {
    const a = d.firstFile || {};
    const b = d.secondFile || {};
    const lines = d.lines || '?';
    const tokens = d.tokens || '?';
    console.log('  Clone (' + lines + ' lines, ' + tokens + ' tokens):');
    console.log('    ' + (a.name || '?').replace(process.cwd() + '/', '') + ':' + (a.startLoc ? a.startLoc.line : '?') + '-' + (a.endLoc ? a.endLoc.line : '?'));
    console.log('    ' + (b.name || '?').replace(process.cwd() + '/', '') + ':' + (b.startLoc ? b.startLoc.line : '?') + '-' + (b.endLoc ? b.endLoc.line : '?'));
    console.log('');
  }
  const stats = r.statistics || {};
  const total = stats.total || {};
  const pct = typeof total.percentage === 'number' ? total.percentage : 0;
  const threshold = typeof r.threshold === 'number' ? r.threshold : 0.1;
  console.log('  Total: ' + pct + '% duplicated lines (' + (total.duplicatedLines || 0) + '/' + (total.lines || 0) + ' lines)');
  console.log('  Threshold: ' + threshold + '%');
  if (pct > threshold) {
    console.log('❌ Duplicated lines (' + pct + '%) exceed threshold (' + threshold + '%)');
    process.exit(1);
  }
  console.log('✅ Duplicates within threshold.');
  process.exit(0);
"
