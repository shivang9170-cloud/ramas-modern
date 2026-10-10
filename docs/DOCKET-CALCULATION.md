# Docket freight & GST calculation

Implemented once in `shared/docketCalc.js`; the API uses it to compute what is saved and the
React form uses it for the live summary. Unit tests: `server/test/docketCalc.test.js`.

Source: `OperationScript.js` (`CalculatedFright`, `CalOtherCharges`, `BindTaxRules`, CFT
calculation) and the commented-out server check in `OperationDAL.ValidateGrnEntry`.

## Steps

1. **Chargeable weight** = max(charge weight, minimum weight). **Packets** = max(packets, minimum boxes).
2. **Base freight** by "rate on":
   | Rate on | Freight |
   |---------|---------|
   | Document (any rate basis) | rate × packets |
   | WEIGHT | rate × chargeable weight |
   | BOX / BAG | rate × packets |
   | KM | rate × distance |
   | FTL | FTL amount |
   | CATEGORY | rate |
   | FREIGHT | amount typed by the user |
3. **Special discount %** — freight − freight × % (DIV1002: freight stays gross, discount is deducted from the grand total).
4. **Minimum freight** — freight = max(freight, min freight).
5. **Fuel surcharge** = freight × fuel % ("Nil" → 0).
6. **Other charges** = handling + halting + FOV + ODA + stationary + to-pay + logistics + DOD/DAC + OCS + service + risk + loading + unloading + collection + door delivery + hamali + statistical + local cartage + P&F + taxable additional charges.
7. **Taxable amount** = freight + other charges + docket charge + fuel surcharge.
8. **GST** — IGST: taxable × IGST %; GST: taxable × CGST % and taxable × SGST %; NA: 0. Tax type comes from `ups_Get_TaxType` (inter-state → IGST).
9. **Grand total** = taxable − (DIV1002 discount) + non-taxable additional charges + GST
   (GST is **not** added when "GST paid by" = Billing Party, i.e. reverse charge).

All amounts rounded to 2 decimals.

## Dimensions (CFT)

CFT = L × W × H × packets ÷ divisor — Inch 1728, mm 270000, cm 5000 for Air/Express (AI, EX)
else 27000, feet no divisor. Row charge weight = CFT × per-CFT. "Apply volumetric weight"
sets charge weight = max(actual weight, Σ row charge weights).

## Differences from the legacy page (please confirm)

| # | Legacy behaviour | New behaviour | Why |
|---|------------------|---------------|-----|
| 1 | Contractual, non-DIV1002: discount deducted from freight **and again** from the grand total. | Deducted once. | Looks like a bug (double discount). |
| 2 | Non-contractual customers: fuel surcharge was taxed but **not added** to the grand total. | Added for everyone. | Otherwise tax is charged on an amount not billed. Fuel % is normally 0 for these customers, so usually no difference. |
| 3 | Minimum weight was applied in the tax calculation but not always in the freight field. | Applied to chargeable weight before freight. | Consistent freight and tax base. |
| 4 | GST amounts kept to 4 decimals in the form. | 2 decimals. | Invoice presentation; totals were already rounded to 2. |
| 5 | Totals posted by the browser were saved as-is. | Server recomputes; posted totals ignored. | Security / integrity. |
| 6 | "Selected tax amount" display driven by per-client `Get_TaxRules`. | Not shown. | Display-only in legacy (did not change the tax charged). |
| 7 | Loading/unloading and collection/delivery could be auto-computed from per-kg contract rates with minimums. | Entered as amounts (contract rates are pre-filled for the fixed charges). | Pilot scope — add rate × weight helpers if needed. |
| 8 | Franchisee booking commission computed in the browser from slab tables. | Passed through (`bookingCommission`, `bookingCommissionPercent`). | Pilot scope — should move server-side. |
