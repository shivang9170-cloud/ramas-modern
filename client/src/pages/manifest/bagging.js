// Manifest bagging logic (no React). The user groups by hand: tick dockets → "Make bag"; tick bags → "Make master bag"
// (packets optional, below bags). The screen keeps a flat list of containers
//   { key: 'P1' | 'B1' | 'M1', level: 'PACKET' | 'BAG' | 'MASTER', parent: 'M1' | '', sealNo, dockets: [docketNo] }
// A container holds dockets and / or smaller containers; a docket outside every container goes on the manifest loose.
// The server numbers the containers on save (manifest.service.js planBags).
export const LEVELS = ['PACKET', 'BAG', 'MASTER'];
export const LEVEL_LABEL = { PACKET: 'Packet', BAG: 'Bag', MASTER: 'Master bag' };
const RANK = { PACKET: 1, BAG: 2, MASTER: 3 };
const SHORT = { PACKET: 'P', BAG: 'B', MASTER: 'M' };

function nextKey(nodes, level) {
  const nums = nodes.filter((n) => n.level === level).map((n) => Number(n.key.slice(1)) || 0);
  return `${SHORT[level]}${Math.max(0, ...nums) + 1}`;
}

/** Remove containers left with nothing in them (no dockets, no smaller containers) until nothing changes. */
export function prune(nodes) {
  let list = nodes;
  for (;;) {
    const keep = list.filter((n) => n.dockets?.length || list.some((c) => c.parent === n.key));
    const keys = new Set(keep.map((n) => n.key));
    const fixed = keep.map((n) => (n.parent && !keys.has(n.parent) ? { ...n, parent: '' } : n));
    if (fixed.length === list.length) return fixed;
    list = fixed;
  }
}

/** Dockets (of `all`) that are in no container. */
export function looseDockets(nodes, all) {
  const inBag = new Set(nodes.flatMap((n) => n.dockets ?? []));
  return all.filter((d) => !inBag.has(d));
}

/** Containers of a level that are not inside a bigger one yet. */
export const looseContainers = (nodes, level) => nodes.filter((n) => n.level === level && !n.parent);

/** Which container a docket is in, and the chain above it: ['P1', 'B1', 'M1']. */
export function pathOf(nodes, docketNo) {
  const start = nodes.find((n) => n.dockets?.includes(docketNo));
  const path = [];
  for (let n = start; n; n = nodes.find((x) => x.key === n.parent)) path.push(n.key);
  return path;
}

/**
 * Make a container of `level` from the ticked loose dockets and the ticked loose smaller containers.
 * Returns { nodes, key } (key = '' when nothing could go in).
 */
export function makeContainer(nodes, level, { dockets = [], children = [] }) {
  const kids = children.filter((k) => {
    const c = nodes.find((n) => n.key === k);
    return c && !c.parent && RANK[c.level] < RANK[level];
  });
  const loose = new Set(looseDockets(nodes, dockets));
  const ds = dockets.filter((d) => loose.has(d));
  if (!kids.length && !ds.length) return { nodes, key: '' };
  const key = nextKey(nodes, level);
  const list = nodes.map((n) => (kids.includes(n.key) ? { ...n, parent: key } : n));
  return { nodes: [...list, { key, level, parent: '', sealNo: '', dockets: ds }], key };
}

/** Open a container: its dockets and smaller containers go back to loose. */
export function breakContainer(nodes, key) {
  return prune(nodes.filter((n) => n.key !== key).map((n) => (n.parent === key ? { ...n, parent: '' } : n)));
}

/** Take one docket out of its container (it becomes loose). */
export const removeDocket = (nodes, docketNo) =>
  prune(nodes.map((n) => (n.dockets?.includes(docketNo) ? { ...n, dockets: n.dockets.filter((d) => d !== docketNo) } : n)));

/** Keep only the dockets still on the manifest. */
export function keepSelected(nodes, selected) {
  const set = new Set(selected);
  return prune(nodes.map((n) => ({ ...n, dockets: (n.dockets ?? []).filter((d) => set.has(d)) })));
}

const chunk = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));

/**
 * Optional one-click bagging of the loose dockets: packets of `docketsPerPacket` (if packets are used), bags of
 * `itemsPerBag`, one master bag per `bagsPerMasterBag` bags. Existing containers stay as they are.
 */
export function autoBag(nodes, docketNos, levels, limits) {
  const lv = LEVELS.filter((l) => levels[l]);
  const loose = looseDockets(nodes, docketNos);
  if (!lv.length || !loose.length) return nodes;
  const cap = { PACKET: limits.docketsPerPacket, BAG: limits.itemsPerBag, MASTER: limits.bagsPerMasterBag };
  let list = [...nodes];
  let items = null;   // keys of the containers made at the previous level
  for (const level of lv) {
    const size = Math.max(1, Number(cap[level]) || 10);
    const next = [];
    for (const group of chunk(items ?? loose, size)) {
      const made = makeContainer(list, level, items ? { children: group } : { dockets: group });
      list = made.nodes;
      if (made.key) next.push(made.key);
    }
    items = next;
  }
  return list;
}

/** Totals of a container (dockets, packages, weight) through its children. */
export function totals(nodes, key, rowsByNo) {
  const node = nodes.find((n) => n.key === key);
  const own = (node?.dockets ?? []).reduce((t, d) => {
    const r = rowsByNo.get(d);
    return { dockets: t.dockets + 1, packages: t.packages + (Number(r?.packages) || 0), weight: t.weight + (Number(r?.weight) || 0) };
  }, { dockets: 0, packages: 0, weight: 0 });
  return nodes.filter((c) => c.parent === key).map((c) => totals(nodes, c.key, rowsByNo))
    .reduce((t, c) => ({ dockets: t.dockets + c.dockets, packages: t.packages + c.packages, weight: t.weight + c.weight }), own);
}

/** The body the API takes. */
export const toBagsPayload = (nodes) =>
  nodes.map((n) => ({ key: n.key, level: n.level, parent: n.parent || '', sealNo: n.sealNo || '', dockets: n.dockets ?? [] }));
