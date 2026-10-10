import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as menu from './menu.service.js';

const router = Router();
router.use(requireAuth);

// GET /api/menu -> sidebar tree for the current user
router.get('/', asyncHandler(async (req, res) => res.json(await menu.getMenuForUser(req.user))));

// GET /api/menu/modules -> dashboard tiles the user may open
router.get('/modules', asyncHandler(async (req, res) => res.json(await menu.getDashboardModules(req.user))));

// ---- access rights (admin only) ----
const admin = requireRole('admin');

router.get('/catalogue', admin, asyncHandler(async (req, res) => res.json(await menu.getMenuCatalogue())));
router.get('/employees', admin, asyncHandler(async (req, res) => res.json(await menu.listEmployees())));

router.get('/permissions/:empCode', admin, asyncHandler(async (req, res) => {
  res.json(await menu.getEmployeePermissions(req.params.empCode));
}));

const permissionSchema = z.object({
  permissions: z.array(z.object({
    menuId: z.string().trim().min(1).max(20),
    subMenuId: z.string().trim().min(1).max(20),
    subSubMenuId: z.string().trim().max(20).nullable().optional(),
  })).max(5000),
});

router.put('/permissions/:empCode', admin, validate({ body: permissionSchema }), asyncHandler(async (req, res) => {
  await menu.setEmployeePermissions(req.params.empCode, req.body.permissions);
  res.json({ message: 'Permissions saved' });
}));

export default router;
