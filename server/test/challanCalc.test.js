import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateChallan } from '../../shared/challanCalc.js';

test('freight = labour + hire + other + overload - deduction (clcFreight)', () => {
  const r = calculateChallan({ labourCharge: 500, hireCharge: 20000, otherCharge: 100, overloadCharge: 250, deductionAmt: 600 });
  assert.equal(r.freight, 20250);
});

test('TDS on freight, vendor credit = freight - TDS, balance = freight - advance', () => {
  const r = calculateChallan({ hireCharge: 12345.67, tdsPercent: 2, advance: 5000 });
  assert.equal(r.tds, 246.91);
  assert.equal(r.vendorAmount, 12098.76);
  assert.equal(r.balance, 7345.67);
});

test('blank / missing values count as zero', () => {
  assert.deepEqual(calculateChallan({ hireCharge: '', advance: null }), { freight: 0, tds: 0, vendorAmount: 0, advance: 0, balance: 0 });
});
