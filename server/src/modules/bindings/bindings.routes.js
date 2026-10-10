// Setting bindings REST API — replaces Setting/Bind_Destinationtobranch, Franchisee_Bind_Branch,
// Bind_Franchisee_to_Client and Franchisee_to_Client_View.
//
//   GET   /api/bindings/branches                        branches (franchisee ones marked)
//   GET   /api/bindings/states
//   GET   /api/bindings/destinations?branch&state        cities of the state with the branch's bindings
//   PUT   /api/bindings/destinations                    (staff) { branch, state, franchiseeType, cities[{city, bound, courier, parcel, ftl}] }
//   GET   /api/bindings/franchisees?type=1|2            franchisees / master franchisees not bound yet
//   GET   /api/bindings/franchisee-branches?type&franchisee
//   GET   /api/bindings/franchisee-branch               franchisee ↔ branch list
//   POST  /api/bindings/franchisee-branch               (staff) { type, franchisee, branch, active }
//   PATCH /api/bindings/franchisee-branch/:id/status    (staff) { active }
//   GET   /api/bindings/franchisee-list                 franchisees for client binding
//   GET   /api/bindings/clients?search=                 clients of the division with their current franchisee
//   GET   /api/bindings/franchisee-client?search=       franchisee ↔ client list
//   POST  /api/bindings/franchisee-client               (staff) { franchisee, clients[] }
//   PATCH /api/bindings/franchisee-client/:id/status    (staff) { active }
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './bindings.service.js';

const router = Router();
router.use(requireAuth);
const staff = requireRole('admin', 'employee');

const code = z.string().trim().min(1).max(20);
const id = z.object({ id: z.coerce.number().int().positive() });
const type = z.coerce.number().int().min(1).max(2);
const search = z.object({ search: z.string().trim().max(60).optional().default('') });
const active = z.object({ active: z.boolean() });

router.get('/branches', asyncHandler(async (req, res) => res.json(await svc.destinationBranches())));
router.get('/states', asyncHandler(async (req, res) => res.json(await svc.states())));
router.get('/destinations', validate({ query: z.object({ branch: code, state: code }) }),
  asyncHandler(async (req, res) => res.json(await svc.destinations(req.query.branch, req.query.state))));
router.put('/destinations', staff, validate({
  body: z.object({
    branch: code, state: code, franchiseeType: z.coerce.number().int().min(0).max(2).default(0),
    cities: z.array(z.object({
      city: code, bound: z.boolean().default(false), courier: z.boolean().default(false),
      parcel: z.boolean().default(false), ftl: z.boolean().default(false),
    })).max(2000),
  }),
}), asyncHandler(async (req, res) => res.json(await svc.saveDestinations(req.user, req.body.branch, req.body.state, req.body))));

router.get('/franchisees', validate({ query: z.object({ type }) }), asyncHandler(async (req, res) => res.json(await svc.franchisees(req.query.type))));
router.get('/franchisee-branches', validate({ query: z.object({ type, franchisee: code }) }),
  asyncHandler(async (req, res) => res.json(await svc.franchiseeBranches(req.query.type, req.query.franchisee))));
router.get('/franchisee-branch', asyncHandler(async (req, res) => res.json(await svc.listFranchiseeBranches())));
router.post('/franchisee-branch', staff, validate({
  body: z.object({ type, franchisee: z.string().trim().min(1, 'Select franchisee').max(20), branch: z.string().trim().min(1, 'Select branch').max(20), active: z.boolean().default(true) }),
}), asyncHandler(async (req, res) => res.status(201).json(await svc.createFranchiseeBranch(req.user, req.body))));
router.patch('/franchisee-branch/:id/status', staff, validate({ params: id, body: active }),
  asyncHandler(async (req, res) => res.json(await svc.setFranchiseeBranchStatus(req.params.id, req.body.active))));

router.get('/franchisee-list', asyncHandler(async (req, res) => res.json(await svc.franchiseeList())));
router.get('/clients', validate({ query: search }), asyncHandler(async (req, res) => res.json(await svc.clientsForBinding(req.user, req.query.search))));
router.get('/franchisee-client', validate({ query: search }), asyncHandler(async (req, res) => res.json(await svc.listFranchiseeClients(req.user, req.query.search))));
router.post('/franchisee-client', staff, validate({
  body: z.object({
    franchisee: z.coerce.number({ invalid_type_error: 'Select franchisee' }).int().positive('Select franchisee'),
    clients: z.array(code).min(1, 'Please select at least one client').max(500),
  }),
}), asyncHandler(async (req, res) => res.status(201).json(await svc.bindClients(req.user, req.body))));
router.patch('/franchisee-client/:id/status', staff, validate({ params: id, body: active }),
  asyncHandler(async (req, res) => res.json(await svc.setFranchiseeClientStatus(req.user, req.params.id, req.body.active))));

export default router;
