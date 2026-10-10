// Port of wwwroot/login.aspx.cs + ClassLibrary/dal/login_dal.cs +
// Client_Master_Dal.Client_Login + wwwroot/User_LoginInfo.ascx.cs (branch switcher).

import crypto from 'node:crypto';
import { exec, query } from '../../db/index.js';
import { signToken } from '../../middleware/auth.js';
import { badRequest, forbidden, unauthorized } from '../../middleware/errors.js';
import { config } from '../../config.js';

const HEAD_OFFICE = { name: 'HEAD OFFICE', code: 'B1001' };

function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? '').trim());
  const y = Buffer.from(String(b ?? '').trim());
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ---- lookups shown on the login screen --------------------------------------

export function getDivisions() {
  // login_dal.GetDivision
  return query('select DivCode, DivName from DivisionMaster where isnull(IsActive,0) = 1 order by id');
}

export function getFinancialYears() {
  // Branch_Master_Dal.Get_Financial_Year
  return query("select ID, Financial_Year from Financial_Year where Status='true' order by ID desc");
}

// ---- login -------------------------------------------------------------------

async function adminLogin(username, password) {
  // login_dal.select_login_details_admin -> sp_select_login_admin('admin', pass)
  if (String(username).trim().toLowerCase() !== 'admin') return null;
  const { recordset } = await exec('sp_select_login_admin', { userid: 'admin', userpasswd: password });
  const row = recordset[0];
  if (!row || !safeEqual(password, row.user_password)) return null;
  return {
    role: 'admin',
    userId: 'admin',
    userName: 'Admin',
    homeBranch: HEAD_OFFICE,
    currentBranch: HEAD_OFFICE,
    branchIds: '',
  };
}

function staffProcFor(loginType, username) {
  if (loginType === 'employee') return 'sp_select_login_160219';
  // Franchisee users are identified by the prefix before the first "1" of the
  // user id (legacy: EmpCode.Split('1')[0]) — "FRS..." or "MFRS...".
  const prefix = String(username).split('1')[0];
  if (prefix === 'FRS') return 'SP_FRANCHISE_LOGIN160219';
  if (prefix === 'MFRS') return 'sp_Master_Franchisee_login';
  return null;
}

async function staffLogin(loginType, username, password, divCode) {
  const proc = staffProcFor(loginType, username);
  if (!proc) return null;
  const { recordset } = await exec(proc, { userid: username, userpasswd: password, Division: divCode });
  const row = recordset[0];
  if (!row) return null;
  if (!safeEqual(username, row.user_id) || !safeEqual(password, row.user_password)) return null;
  if (String(row.user_id).trim() === 'admin') return null;
  // User Master can deactivate a login (users.user_status); procedures that do not return the column are unaffected.
  if (String(row.user_status ?? '').trim().toLowerCase() === 'inactive') throw forbidden('This login is inactive. Contact the administrator.');

  const empType = String(row.user_emp_type ?? '');
  const isFranchisee = empType === 'Franchisee' || empType === 'Master Franchisee';
  if (!String(row.user_branch ?? '').trim()) {
    throw forbidden('Sorry, no branch is assigned to this user.');
  }
  const branch = { name: String(row.home_branch ?? '').trim(), code: String(row.branch ?? '').trim() };
  return {
    role: isFranchisee ? 'franchisee' : 'employee',
    userId: String(row.user_id).trim(),
    userName: String(row.empname ?? '').trim(),
    empType,
    homeBranch: branch,
    currentBranch: branch,
    branchIds: String(row.user_branch ?? ''),
  };
}

async function clientLogin(username, password, divCode) {
  // Client_Master_Dal.Client_Login -> sp_select_Client_login
  const { recordset } = await exec('sp_select_Client_login', { userid: username, userpasswd: password, Divcode: divCode });
  const row = recordset[0];
  if (!row) return null;
  if (!safeEqual(username, row.user_id) || !safeEqual(password, row.user_password)) return null;
  const branch = { name: String(row.home_branch ?? '').trim(), code: String(row.branch_code ?? '').trim() };
  if (!branch.name) throw forbidden('Sorry, no branch is assigned to this user.');
  return {
    role: 'client',
    userId: String(row.user_id).trim(),
    userName: String(row.client_name ?? '').trim(),
    homeBranch: branch,
    currentBranch: branch,
    branchIds: String(row.user_branch ?? ''),
  };
}

export async function login({ loginType, username, password, divCode, financialYear }) {
  const divisions = await getDivisions();
  const division = divisions.find((d) => d.DivCode === divCode);
  if (!division) throw badRequest('Please select a valid division');

  let identity = null;
  if (loginType === 'client') {
    identity = await clientLogin(username, password, divCode);
  } else {
    identity = await staffLogin(loginType, username, password, divCode);
    // The legacy page fell back to the admin check whenever the staff lookup failed.
    if (!identity) identity = await adminLogin(username, password);
  }
  if (!identity) throw unauthorized('Invalid user id or password');

  const claims = {
    ...identity,
    divCode: division.DivCode,
    divName: division.DivName,
    financialYear,
    cityCode: null,
  };
  claims.cityCode = await cityCodeFor(claims, claims.currentBranch.code);
  // a default / weak password: the session can only change it (middleware/auth.js) until it is changed
  const mustChangePassword = config.forcePasswordChange && isWeakPassword(password, username);
  if (mustChangePassword) claims.pwc = true;
  return { token: signToken(claims), user: claims, mustChangePassword };
}

// ---- password policy ---------------------------------------------------------------
// Passwords that came with the system / are commonly guessed: never accepted as a new password, and a login with one
// must change it (when FORCE_PASSWORD_CHANGE is on — the default in production).
const DEFAULT_PASSWORDS = new Set(['emp123', 'admin123', 'admin', 'client123', 'franch123', 'franchisee123', 'password', 'password123',
  'pass123', 'welcome', 'welcome123', '123456', '1234567', '12345678', '123456789', 'qwerty', 'ramas', 'ramas123', 'abc123', 'test123']);

export function isWeakPassword(pw, userId = '') {
  const p = String(pw || '');
  return p.length < 8 || DEFAULT_PASSWORDS.has(p.toLowerCase()) || p.toLowerCase() === String(userId).toLowerCase()
    || !/[a-z]/i.test(p) || !/\d/.test(p);
}

// ---- branches / branch switching (User_LoginInfo.ascx.cs) --------------------

/** Branches the user may switch to: [{ code, name, cityCode }] */
export async function allowedBranches(user) {
  if (user.role === 'admin') {
    const { recordset } = await exec('sp_select_Branch_Master_Details');
    return recordset.map((r) => ({
      code: String(r.branch_code).trim(),
      name: String(r.branch_name).trim(),
      cityCode: r.City_Code ?? r.city_code ?? null,
    }));
  }
  if (user.role === 'franchisee') {
    // Branch_Master_Dal.Get_Franchinse_Branch (was string-concatenated; now parameterised)
    const rows = await query(
      `select b.branch_code, b.branch_name, b.city_code
         from Branch_Master b
         inner join Bind_Franch_Branch bfb on bfb.Branch_Code = b.branch_code
        where (b.IsFranchisee = 'true' or b.IsMasterFranchisee = 'true')
          and bfb.Franchise_Code = @code and b.status = 'Active'
        order by b.branch_code asc`,
      { code: user.userId },
    );
    return rows.map((r) => ({ code: String(r.branch_code).trim(), name: String(r.branch_name).trim(), cityCode: r.city_code }));
  }
  // employee / client: user_branch holds a comma-separated list of branch_master.branchid
  const ids = String(user.branchIds || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!ids.length) return [];
  const params = {};
  const placeholders = ids.map((id, i) => { params[`b${i}`] = id; return `@b${i}`; });
  const rows = await query(
    `select branch_code, branch_name, city_code from branch_master where branchid in (${placeholders.join(',')})`,
    params,
  );
  return rows.map((r) => ({ code: String(r.branch_code).trim(), name: String(r.branch_name).trim(), cityCode: r.city_code }));
}

async function cityCodeFor(user, branchCode) {
  try {
    const list = await allowedBranches(user);
    return list.find((b) => b.code === branchCode)?.cityCode ?? null;
  } catch {
    return null;
  }
}

export async function switchBranch(user, branchCode) {
  const list = await allowedBranches(user);
  const target = list.find((b) => b.code === branchCode);
  if (!target) throw forbidden('You do not have access to that branch');
  const { iat, exp, ...rest } = user; // eslint-disable-line no-unused-vars
  const claims = { ...rest, currentBranch: { name: target.name, code: target.code }, cityCode: target.cityCode ?? null };
  return { token: signToken(claims), user: claims };
}

// ---- change password (User/Change_Password.aspx, users_dal.change_users_password) --

// Table per role. Constants only — never derived from input.
const PASSWORD_TABLE = {
  employee: 'users',
  admin: 'users',
  franchisee: 'Franchisee_Users',
  client: 'ClientLogin_Users',
};

export async function changePassword(user, oldPassword, newPassword) {
  const table = PASSWORD_TABLE[user.role];
  if (!table) throw forbidden();
  // The legacy page did NOT check the old password and concatenated both values
  // into the UPDATE (SQL injection). We verify the old password first.
  const rows = await query(`select user_password from ${table} where user_id = @id`, { id: user.userId });
  if (!rows[0] || !safeEqual(oldPassword, rows[0].user_password)) throw badRequest('Old password is incorrect');
  if (newPassword === oldPassword) throw badRequest('The new password must be different from the old one');
  if (isWeakPassword(newPassword, user.userId)) {
    throw badRequest('Choose a stronger password: at least 8 characters with letters and numbers, not a default password or your user id');
  }
  // NOTE: the legacy schema stores plain-text passwords and the login SPs compare
  // them in SQL, so we keep writing plain text until those SPs are migrated to
  // hashes. See docs/SECURITY.md.
  await query(`update ${table} set user_password = @pw where user_id = @id`, { pw: newPassword, id: user.userId });
  // a fresh session without the "must change password" mark
  const { iat, exp, pwc, ...rest } = user; // eslint-disable-line no-unused-vars
  return { token: signToken(rest), user: rest };
}
