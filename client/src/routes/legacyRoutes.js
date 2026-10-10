// Maps legacy WebForms URLs (as stored in MasterMenu / SubMenu / Sub_SubMenu)
// to React routes. The menu tables do NOT need to change during the migration:
// when you convert a page, add one line here.
//
//   legacy : path of the .aspx relative to the site root (case-insensitive)
//   query  : optional query-string values that must match (e.g. GrnEntry.aspx?x=1)
//   to     : React route
//
// Any menu URL without an entry opens /legacy?page=... ("not migrated yet").

const legacyRoutes = [
  // ---- General masters (generic master engine)
  { legacy: 'General/State_Master.aspx', to: '/masters/state' },
  { legacy: 'General/Zone_Master.aspx', to: '/masters/zone' },
  { legacy: 'General/City_Master.aspx', to: '/masters/city' },
  { legacy: 'General/Commodity_Master.aspx', to: '/masters/commodity' },
  { legacy: 'General/Item_master.aspx', to: '/masters/item' },
  { legacy: 'General/DepartmentMaster.aspx', to: '/masters/department' },
  { legacy: 'General/Division_Master.aspx', to: '/masters/division' },
  { legacy: 'General/District_Master.aspx', to: '/masters/district' },
  { legacy: 'General/NewLocationMaster.aspx', to: '/masters/location' },
  { legacy: 'General/LocationMaster.aspx', to: '/masters/location' },
  { legacy: 'General/Container_Master.aspx', to: '/masters/container' },
  { legacy: 'General/VehicleName_Master.aspx', to: '/masters/vehicle-name' },
  { legacy: 'General/Vehicle_Maker_Master.aspx', to: '/masters/vehicle-maker' },
  { legacy: 'General/Train_Master.aspx', to: '/masters/train' },
  { legacy: 'Master/Courier_Master.aspx', to: '/masters/courier' },
  { legacy: 'General/Product_Master.aspx', to: '/masters/product' },
  { legacy: 'General/Booking_Mode_Master.aspx', to: '/masters/booking-mode' },
  { legacy: 'General/Delivery_Mode_Master.aspx', to: '/masters/delivery-mode' },
  { legacy: 'General/Charge_Code_Master.aspx', to: '/masters/charge-code' },
  { legacy: 'General/Sla_Stock_Reason_Master.aspx', to: '/masters/undelivered-reason' },
  { legacy: 'General/Nature_Of_Business_Master.aspx', to: '/masters/nature-of-business' },
  { legacy: 'General/Distance_Master.aspx', to: '/masters/distance' },
  { legacy: 'General/Sac_Master.aspx', to: '/masters/sac' },
  { legacy: 'General/Designation_Master.aspx', to: '/masters/designation' },
  { legacy: 'General/Country_Master.aspx', to: '/masters/country' },
  { legacy: 'General/Port_Master.aspx', to: '/masters/port' },
  { legacy: 'General/Currency_Master.aspx', to: '/masters/currency' },
  { legacy: 'General/AirLine_Master.aspx', to: '/masters/carrier' },
  { legacy: 'General/Sea_Master.aspx', to: '/masters/carrier' },
  { legacy: 'General/Driver_Master.aspx', to: '/masters/driver' },
  { legacy: 'Master/ConsignerConsignee.aspx', to: '/masters/consignor' },
  { legacy: 'Master/Temporary_Vendor_Master.aspx', to: '/masters/temp-vendor' },

  // ---- Masters with their own screens
  { legacy: 'Master/Branch_Master.aspx', to: '/masters/branches' },
  { legacy: 'Master/Vendor_Entry.aspx', to: '/masters/vendors' },
  { legacy: 'Master/View_Vechile_Master.aspx', to: '/masters/vehicles' },
  { legacy: 'Master/Vechile_Master.aspx', to: '/masters/vehicles' },
  { legacy: 'Master/Client_Master.aspx', to: '/masters/clients' },
  { legacy: 'Master/Employee_Master.aspx', to: '/masters/employees' },
  { legacy: 'Accounts/Payment_Entry.aspx', to: '/accounts/payment/new' },
  { legacy: 'Accounts/Payment_Entry_Cancel.aspx', to: '/accounts/payment/list' },
  { legacy: 'Accounts/Payment_Entry_Edit.aspx', to: '/accounts/payment/list' },
  { legacy: 'Accounts/Books.aspx', to: '/accounts/books' },
  { legacy: 'Accounts/Contra_Entry.aspx', to: '/accounts/contra/new' },
  { legacy: 'Accounts/Contra_Entry_Cancel.aspx', to: '/accounts/contra/list' },
  { legacy: 'Accounts/Contra_Entry_Edit.aspx', to: '/accounts/contra/list' },
  { legacy: 'Accounts/LedgerBind_Add.aspx', to: '/masters/accounts' },
  { legacy: 'Accounts/LedgerBind_Alter.aspx', to: '/masters/accounts' },
  { legacy: 'Accounts/LedgerBind_View.aspx', to: '/masters/accounts' },
  { legacy: 'Accounts/Ledgermaster_view.aspx', to: '/masters/accounts' },
  { legacy: 'Rate/Client_Contract.aspx', to: '/rates/contracts' },
  { legacy: 'Rate/General_Rate_Master.aspx', to: '/rates/general' },
  { legacy: 'Rate/ODA_Charge.aspx', to: '/rates/oda' },
  { legacy: 'Rate/PRS_and_DRS_Rate_Master.aspx', to: '/rates/prs-drs' },
  { legacy: 'Rate/Vendor_Road_Rate_Master.aspx', to: '/rates/vendor-road' },
  { legacy: 'Rate/Vendor_Air_Rate_Master.aspx', to: '/rates/vendor-air' },
  { legacy: 'Rate/Vendor_Train_Rate_Master.aspx', to: '/rates/vendor-train' },
  { legacy: 'Rate/Franchisee_Commission_Master.aspx', to: '/rates/franchisee-commission' },
  { legacy: 'Rate/Franchisees_Pickup_Delivery.aspx', to: '/rates/franchisee-pickup-delivery' },

  // ---- Setting folder
  { legacy: 'Setting/Bind_Destinationtobranch.aspx', to: '/settings/branch-destinations' },
  { legacy: 'Setting/Franchisee_Bind_Branch.aspx', to: '/settings/franchisee-branches' },
  { legacy: 'Setting/Bind_Franchisee_to_Client.aspx', to: '/settings/franchisee-clients' },
  { legacy: 'Setting/Franchisee_to_Client_View.aspx', to: '/settings/franchisee-clients?tab=list' },
  { legacy: 'Setting/ChangeDocket_FY.aspx', to: '/settings/docket-fy' },
  { legacy: 'Setting/EffectiveDateChange.aspx', to: '/settings/effective-dates' },
  { legacy: 'Setting/ClientRateMasterEffectiveDateMmodification.aspx', to: '/settings/effective-dates?mode=back' },
  { legacy: 'Setting/ODA_Master_And_Configuration.aspx', to: '/settings/oda-config' },
  { legacy: 'Setting/Shiper_Master.aspx', to: '/settings/shipper-stock' },
  { legacy: 'Setting/GatePassShiper_Master.aspx', to: '/settings/gatepass-stock' },
  { legacy: 'Setting/Shiper_Issue_Details.aspx', to: '/settings/shipper-issue' },
  { legacy: 'Setting/shiper_issue_details_to_Franchisee.aspx', to: '/settings/shipper-issue-franchisee' },
  { legacy: 'Setting/Special_Booking_Approval.aspx', to: '/settings/special-booking-approval' },
  { legacy: 'Setting/Freight_THC_Margin_Approval.aspx', to: '/settings/freight-margin-approval' },
  { legacy: 'Setting/Vendor_and_vehicle.aspx', to: '/settings/vendor-vehicles' },
  { legacy: 'Setting/MIS_Report_Auto.aspx', to: '/settings/auto-mis' },

  // ---- Operation: docket booking (GrnEntry.aspx ?x=0 new, 1 view/modify, 2 cancel)
  { legacy: 'Operation/GrnEntry.aspx', query: { x: '0' }, to: '/operation/docket/new' },
  { legacy: 'Operation/GrnEntry.aspx', query: { x: '1' }, to: '/operation/docket/modify' },
  { legacy: 'Operation/GrnEntry.aspx', query: { x: '2' }, to: '/operation/docket/cancel' },
  { legacy: 'Operation/GrnEntry.aspx', to: '/operation/docket/new' },
  { legacy: 'Tracking.aspx', to: '/tracking' },

  // ---- Operation: pickup (PRS)
  { legacy: 'Operation/pickup_entry.aspx', to: '/operation/pickup/new' },
  { legacy: 'Operation/Pickup_Entry_Cancel.aspx', to: '/operation/pickup/list' },
  { legacy: 'Operation/Pickup_EntryView.aspx', to: '/operation/pickup/list' },
  { legacy: 'Operation/Pickup_Entry_View.aspx', to: '/operation/pickup/list' },

  // ---- Operation: manifest
  { legacy: 'Operation/menifest.aspx', to: '/operation/manifest/new' },
  { legacy: 'Operation/manifest_Cancel.aspx', to: '/operation/manifest/list' },
  { legacy: 'Operation/manifest_View.aspx', to: '/operation/manifest/list' },

  // ---- Invoice: client bill
  { legacy: 'Invoice/Client_Bill_GST.aspx', to: '/invoice/client-bill/new' },
  { legacy: 'Invoice/Client_Bill.aspx', to: '/invoice/client-bill/new' },
  { legacy: 'Invoice/Client_Bill_Cancel.aspx', to: '/invoice/client-bill/list' },
  { legacy: 'Invoice/client_bill_ReportGST.aspx', to: '/invoice/client-bill/list' },
  { legacy: 'Invoice/client_bill_Report.aspx', to: '/invoice/client-bill/list' },
  { legacy: 'Invoice/Client_Bill_PrintGST.aspx', to: '/invoice/client-bill/list' },
  { legacy: 'Invoice/Client_Bill_Print.aspx', to: '/invoice/client-bill/list' },
  { legacy: 'Invoice/Client_Bill_Summation.aspx', to: '/invoice/bill-submission' },
  { legacy: 'Invoice/Client_Bill_Summation_old.aspx', to: '/invoice/bill-submission' },
  { legacy: 'Invoice/Bill_Finalized.aspx', to: '/invoice/bill-finalize' },
  { legacy: 'Invoice/Bill_Finalized_Cancel.aspx', to: '/invoice/bill-finalize' },
  { legacy: 'Invoice/Client_billFinalise_view.aspx', to: '/invoice/bill-finalize' },
  { legacy: 'Invoice/Bill_Receive.aspx', to: '/invoice/bill-receive' },
  { legacy: 'Invoice/client_topay_paid_bill.aspx', to: '/invoice/client-bill/new?type=Paid' },
  { legacy: 'Invoice/PaidAndTopayBill_Finalized.aspx', to: '/invoice/bill-finalize' },
  { legacy: 'Invoice/Miscellaneous_Bill.aspx', to: '/invoice/misc-bill' },
  { legacy: 'Invoice/MiscellaneousBillSubmission.aspx', to: '/invoice/misc-bill' },
  { legacy: 'Invoice/MiscellaneousBillFinalise.aspx', to: '/invoice/misc-bill' },
  { legacy: 'Invoice/MiscellaneousBillCancel.aspx', to: '/invoice/misc-bill' },
  { legacy: 'Invoice/miscellaneousbill_ReportView.aspx', to: '/invoice/misc-bill' },
  { legacy: 'Invoice/MiscellaneousBillPrint.aspx', to: '/invoice/misc-bill' },
  { legacy: 'Invoice/Warehouse_bill.aspx', to: '/invoice/warehouse-bill' },
  { legacy: 'Invoice/WareHouseBillSubmission.aspx', to: '/invoice/warehouse-bill' },
  { legacy: 'Invoice/WarehouseBillFinalise.aspx', to: '/invoice/warehouse-bill' },
  { legacy: 'Invoice/warehouseBillCancel.aspx', to: '/invoice/warehouse-bill' },
  { legacy: 'Invoice/WareHouseBill_ReportView.aspx', to: '/invoice/warehouse-bill' },
  { legacy: 'Invoice/WarehousePrint.aspx', to: '/invoice/warehouse-bill' },
  { legacy: 'Invoice/Octroi_Bills.aspx', to: '/invoice/octroi-bill' },
  { legacy: 'Invoice/Octroi_Bill_Summation.aspx', to: '/invoice/octroi-bill' },
  { legacy: 'Invoice/Octroi_Bill_Cancel.aspx', to: '/invoice/octroi-bill' },
  { legacy: 'Invoice/Octroi_Bill_Report.aspx', to: '/invoice/octroi-bill' },
  { legacy: 'Invoice/Octroi_Bill_Print.aspx', to: '/invoice/octroi-bill' },
  { legacy: 'Invoice/OctroBillFinalise.aspx', to: '/invoice/octroi-bill' },
  { legacy: 'Invoice/VendorInvoice.aspx', to: '/invoice/vendor-invoice' },
  { legacy: 'Invoice/OthVndInvoiceDetails.aspx', to: '/invoice/vendor-invoice' },
  { legacy: 'Invoice/OtherVendorPrint.aspx', to: '/invoice/vendor-invoice' },
  { legacy: 'Invoice/Vendor_Invoice_For_Varification.aspx', to: '/invoice/vendor-verification' },
  { legacy: 'Invoice/VendorPendingInvoiceReport.aspx', to: '/invoice/vendor-verification' },
  { legacy: 'Invoice/Vendor_Invoice_Print.aspx', to: '/invoice/vendor-verification' },
  { legacy: 'Invoice/Franchisee_Commission_Invoice.aspx', to: '/invoice/franchisee-invoice' },
  { legacy: 'Invoice/Franchisee_Invoice_Cancel.aspx', to: '/invoice/franchisee-invoice/cancel' },

  // ---- Operation: loading sheet
  { legacy: 'Operation/Loading_Sheet.aspx', to: '/operation/loading-sheet/new' },
  { legacy: 'Operation/Loading_Sheet_Cancel.aspx', to: '/operation/loading-sheet/list' },
  { legacy: 'Operation/Loading_Sheet_View.aspx', to: '/operation/loading-sheet/list' },
  { legacy: 'Operation/Loading_Sheet_Edit.aspx', to: '/operation/loading-sheet/list' },
  { legacy: 'Operation/Manual_Loading_Sheet_Cancel_Uncancel.aspx', to: '/operation/loading-sheet/docket' },

  // ---- Operation: challan (vehicle dispatch, road)
  { legacy: 'Operation/dispatchentry_fleet.aspx', to: '/operation/challan/new' },
  { legacy: 'Operation/dispatchentry_fleet_Cancel.aspx', to: '/operation/challan/list' },
  { legacy: 'Operation/dispatchentry_fleet_View.aspx', to: '/operation/challan/list' },

  // ---- Operation: arrival (branch wise)
  { legacy: 'Operation/Arrival_Entry.aspx', to: '/operation/arrival/new' },
  { legacy: 'Operation/Arrival_Entry_Cancel.aspx', to: '/operation/arrival/list' },
  { legacy: 'Operation/Arrival_Entry_View.aspx', to: '/operation/arrival/list' },

  // ---- Operation: DRS (delivery run sheet)
  { legacy: 'Operation/Drs_Entry.aspx', to: '/operation/drs/new' },
  { legacy: 'Operation/Drs_Entry_Cancel.aspx', to: '/operation/drs/list' },
  { legacy: 'Operation/Drs_Entry_View.aspx', to: '/operation/drs/list' },

  // ---- Operation: delivery status (door via DRS + godown)
  { legacy: 'Operation/deliverystatusentry.aspx', to: '/operation/delivery/new' },
  { legacy: 'Operation/deliverystatusentry_Cancel.aspx', to: '/operation/delivery/list' },
  { legacy: 'Operation/deliverystatusentry_view.aspx', to: '/operation/delivery/list' },

  // ---- Operation: POD dispatch (IOM with the signed POD images)
  { legacy: 'Operation/Pod_Dispatch.aspx', to: '/operation/pod/new' },
  { legacy: 'Operation/POD_Dispatch_Cancel.aspx', to: '/operation/pod/list' },
  { legacy: 'Operation/POD_Dispatch_View.aspx', to: '/operation/pod/list' },
  { legacy: 'Operation/POD_Dispatch_To_Head_Office.aspx', to: '/operation/pod-courier/new' },
  { legacy: 'Operation/POD_Courier_Cancel.aspx', to: '/operation/pod-courier/list' },
  { legacy: 'Operation/POD_Courier_View.aspx', to: '/operation/pod-courier/list' },
  { legacy: 'Operation/podreceive.aspx', to: '/operation/pod-receive/new' },
  { legacy: 'Operation/POD_Received_Cancel.aspx', to: '/operation/pod-receive/list' },
  { legacy: 'Operation/POD_Received_View.aspx', to: '/operation/pod-receive/list' },

  // ---- Reports
  { legacy: 'Report/Docket_Booking_Register.aspx', to: '/reports/docket-register' },

  // ---- Users / admin
  { legacy: 'User/UserAccessRights.aspx', to: '/admin/access-rights' },
  { legacy: 'User/User_Master.aspx', to: '/admin/users' },
  { legacy: 'User/Change_Password.aspx', to: '/account/change-password' },
  { legacy: 'User/Franchisee_Change_Password.aspx', to: '/account/change-password' },
];

function parse(url) {
  const clean = String(url || '').trim().replace(/^~?\/*/, '').replace(/\\/g, '/');
  const [path, qs = ''] = clean.split('?');
  return { path: path.toLowerCase(), params: new URLSearchParams(qs) };
}

const index = legacyRoutes.map((r) => ({ ...r, key: parse(r.legacy).path }));

/** Resolve a legacy menu URL to a React path, or null when the URL is empty/"#". */
export function resolveLegacyUrl(url) {
  if (!url || url === '#') return null;
  const { path, params } = parse(url);
  const hit = index.find((r) => r.key === path && Object.entries(r.query || {}).every(([k, v]) => params.get(k) === v));
  if (hit) return hit.to;
  return `/legacy?page=${encodeURIComponent(url)}`;
}
