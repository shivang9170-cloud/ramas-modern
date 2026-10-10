// Employee Master REST API — replaces Master/Employee_Master.aspx.
//
//   GET    /api/employees/options             designations, branches, departments, companies, cities, divisions, fixed lists
//   GET    /api/employees/locations?branch=
//   GET    /api/employees?q&status&designation
//   GET    /api/employees/:id                 (empid, the page's grid key)
//   POST   /api/employees                     (staff)
//   PUT    /api/employees/:id                 (staff)
//   DELETE /api/employees/:id                 (staff; refused while the employee is in use)
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './employees.service.js';
import { today } from '../../utils/values.js';

const router = Router();
router.use(requireAuth);
const staff = requireRole('admin', 'employee');

const up = (max) => z.string().trim().max(max).optional().default('').transform((v) => v.toUpperCase());
const text = (max) => z.string().trim().max(max).optional().default('');
const oneOf = (key, msg) => z.enum(svc.LISTS[key].map((x) => x.value), { errorMap: () => ({ message: msg }) });
const date = (msg) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg);
const pin = z.string().trim().optional().default('').refine((v) => !v || /^\d{6}$/.test(v), 'PIN code: 6 digits');

const reference = z.object({ name: up(100), address: up(300), relation: up(50), mobile: text(15) })
  .refine((r) => !r.mobile || /^\d{10}$/.test(r.mobile), { path: ['mobile'], message: 'Reference mobile: 10 digits' });

const employeeSchema = z.object({
  name: z.string().trim().min(2, 'Enter employee name').max(200).transform((v) => v.toUpperCase().replace(/\s+/g, ' ')),
  designation: z.string().trim().min(1, 'Select designation').max(20),
  branch: z.string().trim().min(1, 'Select branch').max(20),
  location: text(20),
  department: z.string().trim().min(1, 'Select department').max(20),
  company: z.string().trim().min(1, 'Select company').max(20),
  reportsTo: text(50),
  divisions: z.array(z.string().trim().min(1).max(20)).min(1, 'Tick at least one division').max(20),
  employmentType: oneOf('employmentTypes', 'Select on roll / off roll').default('OnRole'),
  joiningType: oneOf('joiningTypes', 'Select joining type').default('1'),
  joiningDate: date('Enter joining date'),
  effectiveFrom: date('Enter effective-from date'),
  guardianType: oneOf('guardianTypes', 'Select guardian').default('Father'),
  guardianName: z.string().trim().min(1, "Enter guardian's name").max(100).transform((v) => v.toUpperCase()),
  gender: oneOf('genders', 'Select gender'),
  dob: date('Enter date of birth'),
  maritalStatus: oneOf('maritalStatus', 'Select marital status').default('1'),
  religion: oneOf('religions', 'Select religion'),
  category: oneOf('categories', 'Select category'),
  nationality: oneOf('nationalities', 'Select nationality'),
  bloodGroup: oneOf('bloodGroups', 'Select blood group'),
  mobile: z.string().trim().regex(/^\d{10}$/, 'Mobile: 10 digits'),
  landline: text(20),
  email: z.string().trim().min(1, 'Enter e-mail').max(100).refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Invalid e-mail'),
  presentAddress: z.string().trim().min(1, 'Enter present address').max(500).transform((v) => v.toUpperCase()),
  presentCity: z.string().trim().min(1, 'Select present city').max(10),
  presentPin: pin,
  permanentAddress: z.string().trim().min(1, 'Enter permanent address').max(500).transform((v) => v.toUpperCase()),
  permanentCity: z.string().trim().min(1, 'Select permanent city').max(10),
  permanentPin: pin,
  qualification: text(100),
  totalExperience: z.union([z.number(), z.string()]).optional().nullable()
    .transform((v) => (v === '' || v === null || v === undefined ? null : Number(v)))
    .refine((v) => v === null || (Number.isFinite(v) && v >= 0 && v < 60), 'Total experience: years'),
  pan: z.string().trim().toUpperCase().max(10).optional().default('').refine((v) => !v || /^[A-Z]{5}\d{4}[A-Z]$/.test(v), 'PAN: AAAAA9999A'),
  passport: up(20),
  previousCompany: z.object({ name: up(200), address: up(300), phone: text(20) }).default({}),
  references: z.array(reference).max(3).default([]),
  pf: z.boolean().default(false),
  esi: z.boolean().default(false),
  professionalTax: z.boolean().default(false),
  lwf: z.boolean().default(false),
  costVisible: z.boolean().default(false),
  sapCode: text(20),
  manualCode: text(20),
  active: z.boolean().default(true),
}).superRefine((b, ctx) => {
  if (b.effectiveFrom < b.joiningDate) ctx.addIssue({ code: 'custom', path: ['effectiveFrom'], message: 'Effective-from date should not be before the joining date' });
  if (b.dob >= b.joiningDate) ctx.addIssue({ code: 'custom', path: ['dob'], message: 'Date of birth must be before the joining date' });
  if (b.dob > today()) ctx.addIssue({ code: 'custom', path: ['dob'], message: 'Date of birth cannot be in the future' });
});
const idParam = z.object({ id: z.coerce.number().int().positive() });

router.get('/options', asyncHandler(async (req, res) => res.json(await svc.options())));
router.get('/locations', validate({ query: z.object({ branch: z.string().trim().min(1).max(20) }) }),
  asyncHandler(async (req, res) => res.json(await svc.locations(req.query.branch))));
router.get('/', validate({
  query: z.object({
    q: z.string().trim().max(60).optional().default(''),
    status: z.enum(['all', 'active', 'inactive']).default('all'),
    designation: z.string().trim().max(20).optional().default(''),
  }),
}), asyncHandler(async (req, res) => res.json(await svc.listEmployees(req.user, req.query))));
router.get('/:id', validate({ params: idParam }), asyncHandler(async (req, res) => res.json(await svc.getEmployee(req.user, req.params.id))));
router.post('/', staff, validate({ body: employeeSchema }), asyncHandler(async (req, res) => {
  res.status(201).json(await svc.createEmployee(req.user, req.body));
}));
router.put('/:id', staff, validate({ params: idParam, body: employeeSchema }), asyncHandler(async (req, res) => {
  res.json(await svc.updateEmployee(req.user, req.params.id, req.body));
}));
router.delete('/:id', staff, validate({ params: idParam }), asyncHandler(async (req, res) => {
  res.json(await svc.deleteEmployee(req.user, req.params.id));
}));

export default router;
