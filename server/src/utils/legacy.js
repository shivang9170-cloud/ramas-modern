// Small helpers that reproduce conventions baked into the legacy data model.

/**
 * Many legacy columns/values are stored as "NAME:CODE" (e.g. "HEAD OFFICE:B1001",
 * "ACME PVT LTD:CL0012"). CommonHelperDAL.GetSplitValue(value, ":", i).
 */
function splitPart(value, index) {
  if (value === null || value === undefined) return '';
  const parts = String(value).trim().split(':');
  return (parts[index] ?? '').trim();
}

export const codeOf = (v) => splitPart(v, 1);

/** "2024-2025" -> { from: '2024-04-01', to: '2025-03-31' } (Indian FY). */
export function financialYearRange(fy) {
  const [a, b] = String(fy || '').split('-').map((s) => s.trim());
  if (!a || !b) return null;
  return { from: `${a}-04-01`, to: `${b}-03-31` };
}
