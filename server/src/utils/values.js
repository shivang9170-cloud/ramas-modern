// Value helpers shared by the services: SQL rows come back with nulls, padded strings and Date objects.

/** Trimmed string; '' for null / undefined. */
export const s = (v) => (v === null || v === undefined ? '' : String(v).trim());
/** Number; 0 for null / undefined / ''. */
export const n = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));
/** yyyy-mm-dd of a date value; '' when empty. */
export const iso = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '');
/** Today as yyyy-mm-dd. */
export const today = () => new Date().toISOString().slice(0, 10);
/** Rounded to paise. */
export const round2 = (v) => Math.round(v * 100) / 100;
