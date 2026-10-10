// Account Master REST API — replaces Accounts/LedgerBind_Add.aspx and the account-group binding.
//
//   GET    /api/account-ledgers/options            groups, ledger types, Dr/Cr, main ledgers
//   PUT    /api/account-ledgers/:code/parent       (staff) put any ledger under a main ledger / take it out
//   POST   /api/account-ledgers/:code/sub-ledgers  (staff) create a sub-ledger under this ledger { name, openingBal }
//   GET    /api/account-ledgers/groups             account groups (with ledger counts)
//   POST   /api/account-ledgers/groups             (staff) create an account group { name, section }
//   PUT    /api/account-ledgers/groups/:code/section  (staff) what the group is (Trial Balance / P&L / Balance Sheet section)
//   GET    /api/account-ledgers?q&status&group&type
//   GET    /api/account-ledgers/:code
//   POST   /api/account-ledgers                    (staff)
//   PUT    /api/account-ledgers/:code              (staff; party/system ledgers are read-only here)
//   DELETE /api/account-ledgers/:code              (staff; refused while the ledger has entries)
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './accounts.service.js';

const router = Router();
router.use(requireAuth);
const staff = requireRole('admin', 'employee');

const ledgerSchema = z.object({
  name: z.string().trim().min(2, 'Enter the ledger name').max(100).transform((v) => v.toUpperCase()),
  groupCode: z.string().trim().min(1, 'Select an account group').max(20),
  ledgerType: z.enum(svc.LEDGER_TYPES.map((t) => t.value), { errorMap: () => ({ message: 'Select a ledger type' }) }),
  openingBal: z.coerce.number({ invalid_type_error: 'Enter opening balance' }).min(-9999999999, 'Too small').max(9999999999, 'Too large').default(0),
  drCr: z.enum(['DR', 'CR']).default('DR'),
  active: z.boolean().default(true),
  isMain: z.boolean().default(false),                                   // main ledger: only the total of its sub-ledgers
  parentCode: z.string().trim().max(20).optional().default(''),          // or: sub-ledger of this main ledger
});

const section = z.string({ required_error: 'Select what the group is (its type)' }).trim().min(1, 'Select what the group is (its type)').max(20);
const groupSchema = z.object({ name: z.string().trim().min(2, 'Enter the group name').max(100).transform((v) => v.toUpperCase()), section });

router.get('/options', asyncHandler(async (req, res) => res.json(await svc.options(req.user))));
router.get('/groups', asyncHandler(async (req, res) => res.json(await svc.listGroups())));
router.post('/groups', staff, validate({ body: groupSchema }), asyncHandler(async (req, res) => {
  res.status(201).json(await svc.createGroup(req.body, req.user));
}));
router.put('/groups/:code/section', staff, validate({ body: z.object({ section }) }), asyncHandler(async (req, res) => {
  res.json(await svc.setGroupSection(req.user, req.params.code, req.body.section));
}));
router.get('/', validate({
  query: z.object({
    q: z.string().trim().max(60).optional().default(''),
    status: z.enum(['all', 'active', 'inactive']).default('all'),
    group: z.string().trim().max(20).optional().default(''),
    type: z.string().trim().max(30).optional().default(''),
  }),
}), asyncHandler(async (req, res) => res.json(await svc.listLedgers(req.user, req.query))));
router.get('/:code', asyncHandler(async (req, res) => res.json(await svc.getLedger(req.user, req.params.code.toUpperCase()))));
router.post('/', staff, validate({ body: ledgerSchema }), asyncHandler(async (req, res) => {
  res.status(201).json(await svc.createLedger(req.user, req.body));
}));
router.put('/:code', staff, validate({ body: ledgerSchema }), asyncHandler(async (req, res) => {
  res.json(await svc.updateLedger(req.user, req.params.code.toUpperCase(), req.body));
}));
// "+ Sub-Ledger": a new ledger under this main ledger (a normal ledger becomes main on its first sub-ledger)
router.post('/:code/sub-ledgers', staff, validate({
  body: z.object({
    name: z.string().trim().min(2, 'Enter the sub-ledger name').max(100),
    openingBal: z.coerce.number().min(-9999999999).max(9999999999).optional().default(0),
  }),
}), asyncHandler(async (req, res) => res.status(201).json(await svc.createSubLedger(req.user, req.params.code.toUpperCase(), req.body))));
// any ledger (party / system ones too) can be put under a main ledger or taken out
router.put('/:code/parent', staff, validate({ body: z.object({ parentCode: z.string().trim().max(20).optional().default('') }) }),
  asyncHandler(async (req, res) => res.json(await svc.setLedgerParent(req.user, req.params.code.toUpperCase(), req.body.parentCode))));
router.delete('/:code', staff, asyncHandler(async (req, res) => {
  res.json(await svc.deleteLedger(req.user, req.params.code.toUpperCase()));
}));

export default router;
