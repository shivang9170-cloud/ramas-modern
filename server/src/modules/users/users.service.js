// User Master (staff logins) — port of wwwroot/User/User_Master.aspx(.cs) and users_bal.
//
// A login belongs to an employee (users.user_id = empcode). users.user_branch lists the branch ids the user may work
// in; the first one is the home branch the login starts in. Menu rights are given separately (Admin → User Access Rights).
//
// Fixed legacy bugs (docs/SECURITY.md):
//   * choosing an employee who already had a login wrote the current password into the page's HTML (input value) —
//     passwords are never sent to the browser now; a new one can be set instead;
//   * the status popup picked the user by employee *name* (duplicates changed the wrong login) and its UPDATE also set
//     user_password from an empty field — status and password are changed for the chosen user id only;
//   * reading the access branches concatenated the employee code into SQL — parameters;
//   * any failure showed "Sorry Duplicate!" (every exception was swallowed) — real messages now;
//   * inactive logins could still sign in (the login did not look at user_status) — refused now.
//
// Passwords stay in plain text because the login procedures compare them in SQL (docs/SECURITY.md #4).

import { query } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../middleware/errors.js';
import { s } from '../../utils/values.js';

const ids = (v) => s(v).split(',').map((x) => x.trim()).filter(Boolean);

async function branchMap() {
  const rows = await query('select branchid, branch_code, branch_name, status from branch_master order by branch_name');
  return rows.map((b) => ({ id: s(b.branchid), code: s(b.branch_code), name: s(b.branch_name), active: s(b.status) === 'Active' }));
}

export async function options(user) {
  const [branches, employees] = await Promise.all([
    branchMap(),
    query(
      `select e.empcode, e.empname, e.branch from employee_master e
        where isnull(e.IsActive, 1) = 1 and ',' + isnull(e.DivCode, '') + ',' like '%,' + @div + ',%'
          and not exists (select 1 from users u where u.user_id = e.empcode)
        order by e.empname`, { div: user.divCode }),
  ]);
  return {
    branches: branches.filter((b) => b.active).map((b) => ({ value: b.id, label: `${b.name} : ${b.code}` })),
    employees: employees.map((e) => ({ value: s(e.empcode), label: `${s(e.empname)} : ${s(e.empcode)}`, branch: s(e.branch) })),
  };
}

// Staff logins of the user's division (the admin account is not listed).
export async function listUsers(user, { q = '', status = 'all' } = {}) {
  const [rows, branches] = await Promise.all([
    query(
      `select u.user_id, u.user_branch, u.user_status, u.user_created_date, e.empname, e.IsActive as emp_active
         from users u join employee_master e on e.empcode = u.user_id
        where u.user_id <> 'admin' and ',' + isnull(e.DivCode, '') + ',' like '%,' + @div + ',%'
        order by e.empname`, { div: user.divCode }),
    branchMap(),
  ]);
  const byId = new Map(branches.map((b) => [b.id, b]));
  const term = q.toUpperCase();
  return rows.map((r) => {
    const list = ids(r.user_branch).map((id) => byId.get(id)).filter(Boolean);
    return {
      userId: s(r.user_id),
      name: s(r.empname),
      homeBranch: list[0]?.name ?? '',
      branches: list.map((b) => ({ id: b.id, code: b.code, name: b.name })),
      active: s(r.user_status).toLowerCase() !== 'inactive',
      employeeActive: r.emp_active === null || r.emp_active === undefined ? true : Boolean(r.emp_active),
      createdAt: r.user_created_date ? new Date(r.user_created_date).toISOString().slice(0, 10) : '',
    };
  })
    .filter((u) => !term || [u.userId, u.name, u.homeBranch].some((x) => x.toUpperCase().includes(term)))
    .filter((u) => status === 'all' || (status === 'active' ? u.active : !u.active));
}

export async function getUser(user, userId) {
  const found = (await listUsers(user)).find((u) => u.userId === userId);
  if (!found) throw notFound(`Login ${userId} not found in this division`);
  return found;
}

/** Home branch first, then the other ticked branches (the login starts in the first one). */
async function branchList(body) {
  const known = new Set((await branchMap()).filter((b) => b.active).map((b) => b.id));
  const all = [...new Set([body.homeBranch, ...body.branches])];
  const unknown = all.filter((id) => !known.has(id));
  if (unknown.length) throw badRequest(`Unknown or inactive branch id(s): ${unknown.join(', ')}`);
  return all.join(',');
}

export async function createUser(user, body) {
  const [emp] = await query(
    `select empcode, empname from employee_master
      where empcode = @e and isnull(IsActive, 1) = 1 and ',' + isnull(DivCode, '') + ',' like '%,' + @div + ',%'`,
    { e: body.employee, div: user.divCode });
  if (!emp) throw badRequest('Select an active employee of this division');
  const [existing] = await query('select user_id from users where user_id = @e', { e: body.employee });
  if (existing) throw conflict(`${s(emp.empname)} : ${body.employee} already has a login`);
  const branches = await branchList(body);
  await query(
    `insert into users(user_id, user_password, user_type, user_emp_type, user_branch, user_status, user_created_date)
     values (@id, @pwd, 'employee', 'Employee', @branches, @status, getdate())`,
    { id: body.employee, pwd: body.password, branches, status: body.active ? 'Active' : 'Inactive' });
  return { userId: body.employee, message: `Login created for ${s(emp.empname)} : ${body.employee}` };
}

export async function updateUser(user, userId, body) {
  if (userId === 'admin') throw badRequest('The admin login is changed from Change Password');
  const current = await getUser(user, userId);
  const branches = await branchList(body);
  await query(
    `update users set user_branch = @branches, user_status = @status,
            user_password = case when @pwd = '' then user_password else @pwd end
      where user_id = @id`,
    { branches, status: body.active ? 'Active' : 'Inactive', pwd: body.password || '', id: userId });
  return { userId, message: `Login ${current.name} : ${userId} updated${body.password ? ' (new password set)' : ''}` };
}

export async function deleteUser(user, userId, actor) {
  if (userId === 'admin') throw badRequest('The admin login cannot be deleted');
  if (userId === actor.userId) throw badRequest('You cannot delete your own login');
  const current = await getUser(user, userId);
  await query('delete from users where user_id = @id', { id: userId });
  return { userId, message: `Login ${current.name} : ${userId} deleted (menu rights are kept)` };
}
