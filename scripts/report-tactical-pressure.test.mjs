import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const script = new URL('./report-tactical-pressure.mjs', import.meta.url);
function run(args = []) {
  const dir = mkdtempSync(join(tmpdir(), 'mapwar-report-'));
  try {
    const input = join(dir, 'input.json'), prefix = join(dir, 'result');
    writeFileSync(input, JSON.stringify({
      sourceCommit: 'fixture-commit', plannedTurnsPerCase: 2,
      method: 'synthetic report regression, not model evidence', constraints: [],
      cases: [{ scenario: 'test', records: [1, 2].map(step => ({
        step, parseSucceeded: true, receipts: [], plannedOrders: [],
        planningRefusals: [], execution: [], events: [], initiative: { kind: 'hold' },
        state: { turn: step, date: step === 1 ? '1931-04-08' : '1931-04-15',
          cities: [{ gb: '156530600', owner: 'YUN', troops: 1, morale: 50, fort: 20 }],
          yun: { silver: 10, food: 10 } },
      })) }],
      requests: [1, 2].map(() => ({ status: 200, elapsedMs: 100 })),
    }));
    const proc = spawnSync(process.execPath, [script.pathname, input, prefix, ...args],
      { encoding: 'utf8' });
    return { status: proc.status, evidence: proc.status === 0
      ? JSON.parse(readFileSync(`${prefix}.json`, 'utf8')) : null };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('fresh runs count every valid decision as newly completed', () => {
  const { status, evidence } = run();
  assert.equal(status, 0);
  assert.equal(evidence.summary.newlyCompletedDecisions, 2);
  assert.equal(evidence.summary.includesPreviousOneDecision, false);
  assert.equal(evidence.sourceCommit, 'fixture-commit');
});
test('resumed runs use explicit prior count and commit rather than a historical hardcode', () => {
  const { status, evidence } = run(['1', 'new-commit']);
  assert.equal(status, 0);
  assert.equal(evidence.summary.newlyCompletedDecisions, 1);
  assert.equal(evidence.summary.includesPreviousOneDecision, true);
  assert.equal(evidence.sourceCommit, 'new-commit');
});
test('prior decisions cannot exceed the validated record count', () => {
  assert.notEqual(run(['3']).status, 0);
});
test('non-integer prior counts are rejected', () => {
  assert.notEqual(run(['0.5']).status, 0);
});
