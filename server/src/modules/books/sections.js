// What an account group is — the section decides where its ledgers appear in the Trial Balance, Profit & Loss and
// Balance Sheet. Stored per group in tblAccountGroupInfo (45-accounts-books.sql); the nature follows from the section.
export const SECTIONS = [
  { key: 'CAPITAL', label: 'Capital Account', nature: 'LIABILITY' },
  { key: 'LOANS', label: 'Loans (Liability)', nature: 'LIABILITY' },
  { key: 'CREDITORS', label: 'Sundry Creditors', nature: 'LIABILITY' },
  { key: 'TAXES', label: 'Duties & Taxes', nature: 'LIABILITY' },
  { key: 'CURR_LIAB', label: 'Current Liabilities & Provisions', nature: 'LIABILITY' },
  { key: 'BRANCH', label: 'Branch / Divisions', nature: 'LIABILITY' },
  { key: 'FIXED', label: 'Fixed Assets', nature: 'ASSET' },
  { key: 'BANK', label: 'Bank Accounts', nature: 'ASSET' },
  { key: 'CASH', label: 'Cash-in-Hand', nature: 'ASSET' },
  { key: 'DEBTORS', label: 'Sundry Debtors', nature: 'ASSET' },
  { key: 'ADVANCES', label: 'Loans & Advances (Asset)', nature: 'ASSET' },
  { key: 'CURR_ASSET', label: 'Current Assets', nature: 'ASSET' },
  { key: 'DIRECT_INC', label: 'Direct Income', nature: 'INCOME' },
  { key: 'INDIRECT_INC', label: 'Indirect Income', nature: 'INCOME' },
  { key: 'DIRECT_EXP', label: 'Direct Expenses', nature: 'EXPENSE' },
  { key: 'INDIRECT_EXP', label: 'Indirect Expenses', nature: 'EXPENSE' },
];

export const SECTION = new Map(SECTIONS.map((x) => [x.key, x]));
export const NATURES = { ASSET: 'Asset', LIABILITY: 'Liability', INCOME: 'Income', EXPENSE: 'Expense' };
export const sectionOptions = () => SECTIONS.map((x) => ({ value: x.key, label: x.label, nature: NATURES[x.nature] }));

// the group a new ledger of a section goes to when nobody named one (created if the chart has none)
export const DEFAULT_GROUP = {
  CAPITAL: 'CAPITAL ACCOUNT', LOANS: 'LOANS (LIABILITY)', CREDITORS: 'SUNDRY CREDITORS', TAXES: 'DUTIES & TAXES',
  CURR_LIAB: 'CURRENT LIABILITIES', BRANCH: 'BRANCH / DIVISIONS', FIXED: 'FIXED ASSETS', BANK: 'BANK ACCOUNTS', CASH: 'CASH-IN-HAND',
  DEBTORS: 'SUNDRY DEBTORS', ADVANCES: 'LOANS & ADVANCES (ASSET)', CURR_ASSET: 'CURRENT ASSETS', DIRECT_INC: 'DIRECT INCOME',
  INDIRECT_INC: 'INDIRECT INCOME', DIRECT_EXP: 'DIRECT EXPENSES', INDIRECT_EXP: 'INDIRECT EXPENSES',
};
