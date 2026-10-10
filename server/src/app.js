import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import compression from 'compression';
import { config } from './config.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { apiLimiters, corsOptions, csrfGuard, redactUrl } from './middleware/security.js';
import authRoutes from './modules/auth/auth.routes.js';
import menuRoutes from './modules/menu/menu.routes.js';
import masterRoutes from './modules/masters/masters.routes.js';
import docketRoutes from './modules/docket/docket.routes.js';
import reportRoutes from './modules/reports/reports.routes.js';
import pickupRoutes from './modules/pickup/pickup.routes.js';
import manifestRoutes from './modules/manifest/manifest.routes.js';
import challanRoutes from './modules/challan/challan.routes.js';
import arrivalRoutes from './modules/arrival/arrival.routes.js';
import drsRoutes from './modules/drs/drs.routes.js';
import deliveryRoutes from './modules/delivery/delivery.routes.js';
import podRoutes from './modules/pod/pod.routes.js';
import { courierRouter as podCourierRoutes, receiveRouter as podReceiveRoutes } from './modules/podho/podho.routes.js';
import branchRoutes from './modules/branches/branches.routes.js';
import vendorRoutes from './modules/vendors/vendors.routes.js';
import vehicleRoutes from './modules/vehicles/vehicles.routes.js';
import clientRoutes from './modules/clients/clients.routes.js';
import employeeRoutes from './modules/employees/employees.routes.js';
import accountRoutes from './modules/accounts/accounts.routes.js';
import contraRoutes from './modules/contra/contra.routes.js';
import paymentRoutes from './modules/payment/payment.routes.js';
import booksRoutes from './modules/books/books.routes.js';
import userRoutes from './modules/users/users.routes.js';
import contractRoutes, { ratesRouter } from './modules/contracts/contracts.routes.js';
import odaRoutes from './modules/oda/oda.routes.js';
import prsDrsRoutes from './modules/prsdrs/prsdrs.routes.js';
import vendorRateRoutes from './modules/vendorrates/vendorrates.routes.js';
import franchiseeRateRoutes from './modules/franchiseerates/franchiseerates.routes.js';
import loadingSheetRoutes from './modules/loadingsheet/loadingsheet.routes.js';
import bindingRoutes from './modules/bindings/bindings.routes.js';
import docketFyRoutes from './modules/docketfy/docketfy.routes.js';
import effDateRoutes from './modules/effdate/effdate.routes.js';
import odaConfigRoutes from './modules/odaconfig/odaconfig.routes.js';
import shipperRoutes from './modules/shippers/shippers.routes.js';
import approvalRoutes from './modules/approvals/approvals.routes.js';
import vendorVehicleRoutes from './modules/vendorvehicles/vendorvehicles.routes.js';
import autoMisRoutes from './modules/automis/automis.routes.js';
import clientBillRoutes from './modules/clientbill/clientbill.routes.js';
import billReceiptRoutes from './modules/billreceive/billreceive.routes.js';
import otherBillRoutes from './modules/otherbill/otherbill.routes.js';
import octroiBillRoutes from './modules/octroibill/octroibill.routes.js';
import vendorInvoiceRoutes from './modules/vendorinvoice/vendorinvoice.routes.js';
import franchiseeInvoiceRoutes from './modules/franchiseeinvoice/franchiseeinvoice.routes.js';
import dashboardRoutes from './modules/dashboard/dashboard.routes.js';
import businessRoutes from './modules/business/business.routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  // gzip responses (the React bundle shrinks to about a third — matters over slow or tunnelled links)
  app.use(compression());
  app.use(cors(corsOptions));
  // never log a password / token that sits in a query string
  morgan.token('safe-url', (req) => redactUrl(req.originalUrl));
  if (config.env !== 'test') {
    app.use(morgan(config.isProd
      ? ':remote-addr - :remote-user [:date[clf]] ":method :safe-url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"'
      : ':method :safe-url :status :response-time ms - :res[content-length]'));
  }
  // rate limits + cross-site (CSRF) guard for the whole API
  const limiters = apiLimiters();
  if (limiters.length) app.use('/api', ...limiters);
  app.use('/api', csrfGuard);
  // POD dispatch uploads images and parses its own (larger) body in pod.routes.js, after the login check.
  const json = express.json({ limit: '2mb' });
  const ownParser = (p) => p === '/api/pod' || p.startsWith('/api/pod/');
  app.use((req, res, next) => (ownParser(req.path) ? next() : json(req, res, next)));

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.use('/api/auth', authRoutes);
  app.use('/api/menu', menuRoutes);
  app.use('/api/masters', masterRoutes);
  app.use('/api/business', businessRoutes);
  app.use('/api/dockets', docketRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/pickups', pickupRoutes);
  app.use('/api/manifests', manifestRoutes);
  app.use('/api/loading-sheets', loadingSheetRoutes);
  app.use('/api/challans', challanRoutes);
  app.use('/api/arrivals', arrivalRoutes);
  app.use('/api/drs', drsRoutes);
  app.use('/api/delivery', deliveryRoutes);
  app.use('/api/pod', podRoutes);
  app.use('/api/pod-courier', podCourierRoutes);
  app.use('/api/pod-receive', podReceiveRoutes);
  app.use('/api/branches', branchRoutes);
  app.use('/api/vendors', vendorRoutes);
  app.use('/api/vehicles', vehicleRoutes);
  app.use('/api/clients', clientRoutes);
  app.use('/api/employees', employeeRoutes);
  app.use('/api/account-ledgers', accountRoutes);
  app.use('/api/contra-entries', contraRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/books', booksRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/contracts', contractRoutes);
  app.use('/api/general-rates', ratesRouter('GENERAL'));
  app.use('/api/oda-charges', odaRoutes);
  app.use('/api/prs-drs-rates', prsDrsRoutes);
  app.use('/api/vendor-rates', vendorRateRoutes);
  app.use('/api/franchisee-rates', franchiseeRateRoutes);
  // Setting folder
  app.use('/api/bindings', bindingRoutes);
  app.use('/api/docket-fy', docketFyRoutes);
  app.use('/api/effective-dates', effDateRoutes);
  app.use('/api/oda-config', odaConfigRoutes);
  app.use('/api/shippers', shipperRoutes);
  app.use('/api/approvals', approvalRoutes);
  app.use('/api/vendor-vehicles', vendorVehicleRoutes);
  app.use('/api/auto-mis', autoMisRoutes);
  // Invoice folder
  app.use('/api/client-bills', clientBillRoutes);
  app.use('/api/bill-receipts', billReceiptRoutes);
  app.use('/api/other-bills', otherBillRoutes);
  app.use('/api/octroi-bills', octroiBillRoutes);
  app.use('/api/vendor-invoices', vendorInvoiceRoutes);
  app.use('/api/franchisee-invoices', franchiseeInvoiceRoutes);
  app.use('/api/dashboard', dashboardRoutes);

  app.use('/api', notFoundHandler);

  // Optional: serve the built React app from the same server (one process to
  // deploy behind IIS/nginx). Set CLIENT_DIST to client/dist.
  if (config.clientDist && fs.existsSync(config.clientDist)) {
    // never hand out source maps (they would show the app's source code) even if a build left some behind
    app.use((req, res, next) => (/\.map$/i.test(req.path) ? res.status(404).end() : next()));
    app.use(express.static(config.clientDist, { index: false, maxAge: '1h', dotfiles: 'deny' }));
    app.get('*', (req, res) => res.sendFile(path.join(config.clientDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
