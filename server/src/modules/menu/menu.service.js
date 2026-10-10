// Port of IOS.master.cs#bindNavigationLink (sidebar menu), MainDashboard.aspx.cs
// (module tiles) and User/UserAccessRights.aspx.cs (permission editor).
//
// Menu data model (unchanged):
//   MasterMenu(Menuid 'M001', MenuName, MenuUrl, ActiveStatus)
//   SubMenu(Menuid, SubMenuid 'S001', SubMenuName, SubMenuUrl, ActiveStatus, division)
//   Sub_SubMenu(SubSubMenuId, Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division)
//   Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus)
//   Franchisee_Permission(Employeeid, ...) / Client_Permission(ClientId, ...)

import { exec, query, withTransaction } from '../../db/index.js';

// Server-side constants only — never built from input.
const PERMISSION_SOURCE = {
  employee: { table: 'Employee_Permission', key: 'Employeeid', subSubDivision: 'sub.division' },
  franchisee: { table: 'Franchisee_Permission', key: 'Employeeid', subSubDivision: 'sm.division' },
  client: { table: 'Client_Permission', key: 'ClientId', subSubDivision: 'sm.division' },
};

// by number, except MASTER (M008, db/dev/46-master-menus.sql) which sits right after GENERAL MASTER (M001)
const ORDER_MAIN = "case when mm.Menuid = 'M008' then 1.5 else cast(replace(mm.Menuid,'M','') as decimal(9,2)) end";

function buildTree(mains, subs, subSubs) {
  const trim = (v) => (v == null ? '' : String(v).trim());
  const bySub = new Map();
  for (const s of subSubs) {
    const key = `${trim(s.Menuid)}|${trim(s.SubMenuid)}`;
    if (!bySub.has(key)) bySub.set(key, []);
    bySub.get(key).push({ id: trim(s.SubSubMenuId), name: trim(s.SubMenuName), url: trim(s.SubMenuUrl) });
  }
  const byMain = new Map();
  for (const s of subs) {
    const mid = trim(s.Menuid);
    if (!byMain.has(mid)) byMain.set(mid, []);
    const node = { id: trim(s.SubMenuid), name: trim(s.SubMenuName), url: trim(s.SubMenuUrl) };
    const children = bySub.get(`${mid}|${node.id}`);
    if (children?.length) node.children = children;
    byMain.get(mid).push(node);
  }
  return mains.map((m) => ({
    id: trim(m.Menuid),
    name: trim(m.MenuName),
    url: trim(m.MenuUrl),
    children: byMain.get(trim(m.Menuid)) ?? [],
  }));
}

/** Sidebar menu for the logged-in user, filtered by role, permissions and division. */
export async function getMenuForUser(user) {
  const div = `%${user.divCode}%`;

  if (user.role === 'admin') {
    const [mains, subs, subSubs] = await Promise.all([
      query(`select mm.Menuid, mm.MenuName, mm.MenuUrl from MasterMenu mm
              where mm.ActiveStatus='Y' order by ${ORDER_MAIN}`),
      query(`select Menuid, SubMenuid, SubMenuName, SubMenuUrl from SubMenu
              where ActiveStatus='Y' and division like @div
              order by cast(replace(SubMenuid,'S','') as int)`, { div }),
      query(`select SubSubMenuId, Menuid, SubMenuid, SubMenuName, SubMenuUrl from Sub_SubMenu
              where ActiveStatus='Y' and division like @div order by SubSubMenuId`, { div }),
    ]);
    return buildTree(mains, subs, subSubs);
  }

  const src = PERMISSION_SOURCE[user.role];
  if (!src) return [];
  const uid = user.userId;
  const [mains, subs, subSubs] = await Promise.all([
    query(`select mm.Menuid, mm.MenuName, mm.MenuUrl from MasterMenu mm
            where mm.ActiveStatus='Y'
              and mm.Menuid in (select distinct MainMenuid from ${src.table} where ${src.key} = @uid)
            order by ${ORDER_MAIN}`, { uid }),
    query(`select distinct ep.MainMenuid as Menuid, sm.SubMenuid, sm.SubMenuName, sm.SubMenuUrl
             from ${src.table} ep inner join SubMenu sm on sm.SubMenuid = ep.Sub_Menuid
            where sm.ActiveStatus='Y' and ep.${src.key} = @uid and sm.division like @div`, { uid, div }),
    query(`select distinct ep.MainMenuid as Menuid, sm.SubMenuid, sub.SubSubMenuId,
                  sub.SubMenuName, sub.SubMenuUrl
             from ${src.table} ep
             inner join SubMenu sm on ep.Sub_Menuid = sm.SubMenuid
             inner join Sub_SubMenu sub on ep.Sub_SubMenuid = sub.SubSubMenuId
            where ep.${src.key} = @uid and sub.ActiveStatus='Y' and ${src.subSubDivision} like @div`, { uid, div }),
  ]);
  const num = (id) => Number(String(id).replace(/\D/g, '')) || 0;
  subs.sort((a, b) => num(a.SubMenuid) - num(b.SubMenuid));
  return buildTree(mains, subs, subSubs);
}

/** Module tiles on MainDashboard.aspx: TMS, HRM, CASH MANAGEMENT, ADMIN, MARKETING. */
export async function getDashboardModules(user) {
  const all = ['TMS', 'HRM', 'CASH MANAGEMENT', 'MARKETING', 'ADMIN'];
  if (user.role === 'admin') return all;
  const { recordset } = await exec('sp_getForMainDashboardAccess', { empCode: user.userId });
  const allowed = new Set(
    recordset.filter((r) => r.isActive === true || r.isActive === 1 || String(r.isActive).toLowerCase() === 'true')
      .map((r) => String(r.MenuName).trim().toUpperCase()),
  );
  return all.filter((m) => allowed.has(m));
}

// ---- Access-rights administration (User/UserAccessRights.aspx) -------------

/** Full catalogue of active menus (for the permissions editor). */
export async function getMenuCatalogue() {
  const [mains, subs, subSubs] = await Promise.all([
    query("select mm.Menuid, mm.MenuName, mm.MenuUrl from MasterMenu mm where mm.ActiveStatus='Y' order by mm.MenuName"),
    query("select Menuid, SubMenuid, SubMenuName, SubMenuUrl from SubMenu where ActiveStatus='Y' order by SubMenuName"),
    query("select SubSubMenuId, Menuid, SubMenuid, SubMenuName, SubMenuUrl from Sub_SubMenu where ActiveStatus='Y' order by SubMenuName"),
  ]);
  return buildTree(mains, subs, subSubs);
}

/** Employees selectable in the permission editor (login.select_Emp). */
export function listEmployees() {
  return query("select empcode as code, empname as name from employee_master order by empname");
}

/** Current permissions for one employee: [{ menuId, subMenuId, subSubMenuId|null }] */
export async function getEmployeePermissions(empCode) {
  const rows = await query(
    'select MainMenuid, Sub_Menuid, Sub_SubMenuid from Employee_Permission where Employeeid = @empCode',
    { empCode });
  return rows.map((r) => ({
    menuId: String(r.MainMenuid ?? '').trim(),
    subMenuId: String(r.Sub_Menuid ?? '').trim(),
    subSubMenuId: r.Sub_SubMenuid == null || String(r.Sub_SubMenuid).trim() === '' ? null : String(r.Sub_SubMenuid).trim(),
  }));
}

/**
 * Replace an employee's permissions (legacy: delete all, then insert each ticked box).
 * Now done in one transaction so a failure can't leave the user with no menu.
 */
export async function setEmployeePermissions(empCode, permissions) {
  await withTransaction(async (tx) => {
    await query('delete from Employee_Permission where Employeeid = @empCode', { empCode }, { tx });
    for (const p of permissions) {
      if (p.subSubMenuId) {
        await query(
          `insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus)
           values (@empCode, @menuId, @subMenuId, @subSubMenuId, 'Y')`,
          { empCode, menuId: p.menuId, subMenuId: p.subMenuId, subSubMenuId: p.subSubMenuId }, { tx });
      } else {
        await query(
          `insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, ActiveStatus)
           values (@empCode, @menuId, @subMenuId, 'Y')`,
          { empCode, menuId: p.menuId, subMenuId: p.subMenuId }, { tx });
      }
    }
  });
}
