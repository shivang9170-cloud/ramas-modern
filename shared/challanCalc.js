// Challan (vehicle hire) amounts — port of dispatchentry_fleet.aspx.cs clcFreight().
// Used by the API (what is saved) and by the Challan Entry screen (live summary).
//
//   freight  = labour + hire + other + overload charge - deduction
//   TDS      = freight x vendor TDS % / 100
//   vendor   = freight - TDS        (credited to the vendor ledger)
//   balance  = freight - advance    (still payable to the vendor)

export const round2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? 0 : Number(v));

export function calculateChallan({
  labourCharge = 0, hireCharge = 0, otherCharge = 0, overloadCharge = 0, deductionAmt = 0, advance = 0, tdsPercent = 0,
} = {}) {
  const freight = round2(num(labourCharge) + num(hireCharge) + num(otherCharge) + num(overloadCharge) - num(deductionAmt));
  const tds = round2((freight * num(tdsPercent)) / 100);
  return {
    freight,
    tds,
    vendorAmount: round2(freight - tds),
    advance: round2(num(advance)),
    balance: round2(freight - num(advance)),
  };
}
