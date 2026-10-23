/**
 * CLI Test Runner for PixelVault
 * Runs in Node.js via tsx
 */

import { runPixelVaultTests } from '../src/lib/test-suite.ts';

async function main() {
  console.log('='.repeat(70));
  console.log('🧪 PixelVault Comprehensive Test Suite (RFC 2083 & Format v1)');
  console.log('='.repeat(70));

  let passedCount = 0;
  let failedCount = 0;

  const results = await runPixelVaultTests((test) => {
    if (test.status === 'running') {
      process.stdout.write(`\n⏳ [RUNNING] ${test.name}...`);
    } else if (test.status === 'passed') {
      process.stdout.write(`\r✅ [PASSED]  ${test.name} (${test.durationMs}ms)\n`);
      if (test.details) {
        console.log(`   └─ ${test.details}`);
      }
      passedCount++;
    } else if (test.status === 'failed') {
      process.stdout.write(`\r❌ [FAILED]  ${test.name} (${test.durationMs}ms)\n`);
      if (test.error) {
        console.error(`   └─ ERROR: ${test.error}`);
      }
      failedCount++;
    }
  });

  console.log('\n' + '='.repeat(70));
  console.log(`Test Execution Summary: ${passedCount} passed, ${failedCount} failed (${results.length} total)`);
  console.log('='.repeat(70));

  if (failedCount > 0) {
    process.exit(1);
  } else {
    console.log('🎉 All automated tests completed successfully!');
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
