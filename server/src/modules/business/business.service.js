// What the user's division works like (tblDivisionProfile, db/dev/47-business-international.sql):
//   businessType        COURIER | CARGO | FTL | INTERNATIONAL
//   useBagging          manifests put dockets in packets → bags → master bags (courier). TMS (cargo / FTL) manifests whole
//                       dockets in one entry — the bagging screens never show and the server takes no bags.
//   allowInternational  a docket may be booked as Export / Import
//   limits              defaults for automatic bagging
// A division without a profile row (e.g. one added later) is judged by its name, as the set-up script does.
import { query } from '../../db/index.js';
import { s } from '../../utils/values.js';

export const BUSINESS_TYPES = ['COURIER', 'CARGO', 'FTL', 'INTERNATIONAL'];

function inferred(divName) {
  const n = String(divName ?? '').toUpperCase();
  const type = /INTERNATIONAL|EXPORT/.test(n) ? 'INTERNATIONAL' : /COURIER/.test(n) ? 'COURIER' : /FTL|TRUCK/.test(n) ? 'FTL' : 'CARGO';
  return { businessType: type, useBagging: type === 'COURIER' || type === 'INTERNATIONAL', allowInternational: type !== 'FTL' };
}

export async function profile(divCode, { tx } = {}) {
  const [r] = await query(
    `select d.DivCode, d.DivName, p.BusinessType, p.UseBagging, p.AllowInternational, p.DocketsPerPacket, p.ItemsPerBag, p.BagsPerMasterBag
       from DivisionMaster d left join tblDivisionProfile p on p.DivCode = d.DivCode
      where d.DivCode = @d`, { d: divCode }, { tx });
  const base = r && r.BusinessType
    ? { businessType: s(r.BusinessType), useBagging: Boolean(r.UseBagging), allowInternational: Boolean(r.AllowInternational) }
    : inferred(r?.DivName);
  const tms = base.businessType === 'CARGO' || base.businessType === 'FTL';
  return {
    divCode: s(divCode),
    divName: s(r?.DivName),
    ...base,
    tms,
    limits: {
      docketsPerPacket: Number(r?.DocketsPerPacket) || 10,
      itemsPerBag: Number(r?.ItemsPerBag) || 10,
      bagsPerMasterBag: Number(r?.BagsPerMasterBag) || 10,
    },
  };
}
