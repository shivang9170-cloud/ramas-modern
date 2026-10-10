import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateDocket, dimensionRow } from '../../shared/docketCalc.js';

const base = { divCode: 'DIV1001', docType: 'NONDOC', rateOn: 'WEIGHT', packets: 5, chargeWeight: 100, rate: 12 };

test('weight freight = rate x charge weight', () => {
  const r = calculateDocket(base);
  assert.equal(r.freight, 1200);
  assert.equal(r.grandTotal, 1200);
});

test('minimum weight lifts the chargeable weight', () => {
  const r = calculateDocket({ ...base, chargeWeight: 10, minWeight: 25 });
  assert.equal(r.effectiveChargeWeight, 25);
  assert.equal(r.freight, 300);
});

test('minimum freight applies after discount', () => {
  const r = calculateDocket({ ...base, chargeWeight: 10, minFreight: 500, discountPercent: 10 });
  assert.equal(r.baseFreight, 120);
  assert.equal(r.freight, 500);
  assert.equal(r.minFreightApplied, true);
});

test('documents are charged per packet regardless of rate basis', () => {
  const r = calculateDocket({ ...base, docType: 'DOC', rate: 50 });
  assert.equal(r.freight, 250);
});

test('box / km / ftl / category / manual freight', () => {
  assert.equal(calculateDocket({ ...base, rateOn: 'BOX', rate: 40, minBox: 8 }).freight, 320);
  assert.equal(calculateDocket({ ...base, rateOn: 'KM', rate: 30, distance: 250 }).freight, 7500);
  assert.equal(calculateDocket({ ...base, rateOn: 'FTL', ftlAmount: 42000 }).freight, 42000);
  assert.equal(calculateDocket({ ...base, rateOn: 'CATEGORY', rate: 999 }).freight, 999);
  assert.equal(calculateDocket({ ...base, rateOn: 'FREIGHT', manualFreight: 1750.5 }).freight, 1750.5);
});

test('special discount is applied once (legacy double-deducted)', () => {
  const r = calculateDocket({ ...base, discountPercent: 10 });
  assert.equal(r.discountValue, 120);
  assert.equal(r.freight, 1080);
  assert.equal(r.grandTotal, 1080);
});

test('DIV1002 keeps gross freight and deducts discount from the total', () => {
  const r = calculateDocket({ ...base, divCode: 'DIV1002', discountPercent: 10, taxMode: 'IGST', igstRate: 18 });
  assert.equal(r.freight, 1200);
  assert.equal(r.taxableAmount, 1200);
  assert.equal(r.igstAmount, 216);
  assert.equal(r.grandTotal, 1200 - 120 + 216);
});

test('fuel surcharge = freight x fuel %; Nil means zero', () => {
  assert.equal(calculateDocket({ ...base, fuelPercent: 15 }).fuelSurcharge, 180);
  assert.equal(calculateDocket({ ...base, fuelPercent: 'Nil' }).fuelSurcharge, 0);
});

test('GST: tax on freight + others + docket charge + fuel; CGST+SGST', () => {
  const r = calculateDocket({
    ...base,
    fuelPercent: 10, // 120
    docketCharge: 50,
    charges: { handling: 30, fov: 20.5 },
    additionalCharges: [{ amount: 9.5 }],
    taxMode: 'GST', cgstRate: 9, sgstRate: 9,
  });
  assert.equal(r.otherCharges, 60);
  assert.equal(r.taxableAmount, 1200 + 60 + 50 + 120);
  assert.equal(r.cgstAmount, 128.7);
  assert.equal(r.sgstAmount, 128.7);
  assert.equal(r.grandTotal, 1430 + 257.4);
});

test('reverse charge: GST paid by billing party is not added to the total', () => {
  const r = calculateDocket({ ...base, taxMode: 'IGST', igstRate: 12, gstPaidBy: 'Billing Party' });
  assert.equal(r.igstAmount, 144);
  assert.equal(r.grandTotal, 1200);
});

test('non-taxable additional charges are added after tax', () => {
  const r = calculateDocket({ ...base, taxMode: 'IGST', igstRate: 10, additionalChargesTax: [{ amount: 100 }] });
  assert.equal(r.igstAmount, 120);
  assert.equal(r.grandTotal, 1200 + 120 + 100);
});

test('NA tax mode ignores rates', () => {
  const r = calculateDocket({ ...base, taxMode: 'NA', igstRate: 18, cgstRate: 9 });
  assert.equal(r.totalTax, 0);
});

test('dimension CFT divisors match legacy', () => {
  assert.deepEqual(dimensionRow({ length: 12, width: 12, height: 12, packets: 2, perCft: 6, unit: 'Inch' }), { cft: 2, chargeWeight: 12 });
  assert.deepEqual(dimensionRow({ length: 50, width: 40, height: 30, packets: 1, perCft: 6, unit: 'cm', bookingMode: 'SU' }), { cft: 2.22, chargeWeight: 13.32 });
  assert.deepEqual(dimensionRow({ length: 50, width: 40, height: 30, packets: 1, perCft: 1, unit: 'cm', bookingMode: 'AI' }), { cft: 12, chargeWeight: 12 });
  assert.deepEqual(dimensionRow({ length: 2, width: 2, height: 2, packets: 1, perCft: 5, unit: 'feet' }), { cft: 8, chargeWeight: 40 });
  assert.deepEqual(dimensionRow({ length: 0, width: 2, height: 2, packets: 1, perCft: 5 }), { cft: 0, chargeWeight: 0 });
});
