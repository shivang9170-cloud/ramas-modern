// Context of the quick-add system (provider: QuickAdd.jsx). Kept apart so the form and the select can use it without
// importing the provider (no import cycle).
import { createContext, useContext } from 'react';

export const QuickAddContext = createContext({ ready: false, def: () => null, open: async () => null });

/** { ready, def(key) -> public master definition | null, open(key, { initial }) -> Promise<new row | null> } */
export function useQuickAdd() {
  return useContext(QuickAddContext);
}

/** "City Master" -> "City", "Product / Service Master" -> "Product / Service" */
export function masterNoun(def) {
  return String(def?.title ?? '').replace(/\s+Master$/i, '').trim() || 'record';
}

/**
 * Values of a form that also exist (same name, any case) in another master's fields — so "+ New City" from a location
 * whose state is already picked opens the city form with that state filled in.
 */
export function carryOver(values, targetDef) {
  const out = {};
  if (!values || !targetDef) return out;
  const byLower = new Map(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]));
  for (const f of targetDef.fields ?? []) {
    if (f.name === targetDef.keyField || f.createOnly) continue;
    const v = byLower.get(f.name.toLowerCase());
    if (v !== undefined && v !== null && v !== '' && f.type === 'select') out[f.name] = v;
  }
  return out;
}
