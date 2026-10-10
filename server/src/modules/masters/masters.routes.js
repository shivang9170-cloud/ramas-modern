// REST endpoints for declarative masters.
//   GET    /api/masters                         -> definitions (for building screens), each with canAdd for this user
//   GET    /api/masters/:key                    -> { definition (+ canAdd), rows }
//   GET    /api/masters/:key/options/:field     -> [{value,label}] for select fields
//   GET    /api/masters/:key/next-code?name=    -> { code } next free code for a new record (autoCode masters;
//                                                  name-based ones suggest it from the name typed)
//   GET    /api/masters/:key/autofill/:field?v= -> { otherField: value } filled from the field's value
//   GET    /api/masters/:key/:code              -> one row
//   POST   /api/masters/:key                    -> create
//   PUT    /api/masters/:key/:code              -> update
//   DELETE /api/masters/:key/:code              -> delete
// Writing (and the add-form helpers next-code / autofill) needs access to the master: admin always, an employee only
// when User Access Rights gave him its menu item (masters.service.js canWrite) — the same rule hides "+ New …".
import { Router } from 'express';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import * as svc from './masters.service.js';

const router = Router();
router.use(requireAuth);

// Masters are back-office data: clients never had access to these pages.
const staff = requireRole('admin', 'employee');

/** The definition of :key, after checking this user may write to it. */
async function writable(req) {
  const def = svc.getDefinition(req.params.key, req.user);
  await svc.assertCanWrite(def, req.user);
  return def;
}

router.get('/', asyncHandler(async (req, res) => res.json(await svc.listDefinitions(req.user))));

router.get('/:key', asyncHandler(async (req, res) => {
  const def = svc.getDefinition(req.params.key, req.user);
  const definition = { ...svc.publicDefinition(def), canAdd: await svc.canWrite(def, req.user) };
  res.json({ definition, rows: await svc.listRows(def) });
}));

router.get('/:key/options/:field', asyncHandler(async (req, res) => {
  const def = svc.getDefinition(req.params.key, req.user);
  res.json(await svc.fieldOptions(def, req.params.field));
}));

router.get('/:key/next-code', staff, asyncHandler(async (req, res) => {
  res.json(await svc.nextCode(await writable(req), req.query.name));
}));

router.get('/:key/autofill/:field', staff, asyncHandler(async (req, res) => {
  res.json(await svc.autofill(await writable(req), req.params.field, req.query.v));
}));

router.get('/:key/:code', asyncHandler(async (req, res) => {
  const def = svc.getDefinition(req.params.key, req.user);
  res.json(await svc.getRow(def, req.params.code));
}));

router.post('/:key', staff, asyncHandler(async (req, res) => {
  res.status(201).json(await svc.createRow(await writable(req), req.body, req.user));
}));

router.put('/:key/:code', staff, asyncHandler(async (req, res) => {
  res.json(await svc.updateRow(await writable(req), req.params.code, req.body, req.user));
}));

router.delete('/:key/:code', staff, asyncHandler(async (req, res) => {
  await svc.deleteRow(await writable(req), req.params.code, req.user);
  res.status(204).end();
}));

export default router;
