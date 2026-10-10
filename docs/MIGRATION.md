# Migration guide

## Status

| Area | Legacy | New | Status |
|------|--------|-----|--------|
| Login (employee / franchisee / client / admin) | `login.aspx`, `Login2.aspx`, `Client_login.aspx`, `Franchisee_login.aspx` | `POST /api/auth/login`, `LoginPage` | ✅ tested |
| Session (branch, division, FY) | `Session[...]` | JWT claims; `POST /api/auth/switch-branch` | ✅ tested |
| Sidebar menu + permissions | `IOS.master` `bindNavigationLink` | `GET /api/menu`, `AppLayout` | ✅ tested |
| Main dashboard tiles | `MainDashboard.aspx` | `GET /api/menu/modules`, `DashboardPage` | ✅ |
| Analytics dashboard — 86 numbered analyses in 5 tabs (overview + insights, booking, operations, billing & money, vendors & accounts); every chart element clickable to its records (search, totals, CSV); ECharts, live auto-refresh | `default.aspx` counters (new) | `/api/dashboard/:section`, `/api/dashboard/drill`, `DashboardPage`, `components/charts` | ✅ tested — see "Analytics dashboard" below |
| User access rights | `User/UserAccessRights.aspx`, `MenuAccess/Employee_Permission.aspx` | `/api/menu/permissions/:emp`, `AccessRightsPage` | ✅ API tested |
| Change password | `User/Change_Password.aspx` | `POST /api/auth/change-password` | ✅ |
| General masters: State, Zone, City, Commodity, Item/Package, Department, Division | `General/*.aspx` | `/api/masters/:key`, `MasterPage` | ✅ tested |
| Docket booking — entry / view-modify / cancel | `Operation/GrnEntry.aspx?x=0/1/2` + `OperationScript.js` | `/api/dockets`, `DocketBookingPage` | ✅ tested (dev DB) |
| Docket tracking — full journey from the operation entries + problems found (wrong / out-of-order entries, shortages, stuck, late, POD, billing) | `Tracking.aspx`, `Tracking_Client.aspx` | `/api/dockets/:no/journey` (and the old `/tracking`), `TrackingPage` | ✅ tested — see "Docket tracking" below |
| Pickup (PRS) entry | `Operation/pickup_entry.aspx` | `POST /api/pickups`, `PickupEntryPage` | ✅ tested |
| Pickup view / cancel | `Operation/Pickup_Entry_Cancel.aspx`, `Pickup_EntryView.aspx`, `Pickup_Entry_View.aspx` | `/api/pickups`, `PickupListPage` | ✅ tested |
| Manifest entry (incl. partial packages, co-loader) | `Operation/menifest.aspx` | `POST /api/manifests`, `ManifestEntryPage` | ✅ tested — incl. "from a loading sheet" |
| Manifest view / cancel | `Operation/manifest_Cancel.aspx`, `manifest_View.aspx` | `/api/manifests`, `ManifestListPage` | ✅ tested |
| Loading sheet — entry (docket scan), view / cancel, one docket off / back on a sheet; a manifest made from it | `Operation/Loading_Sheet`, `Loading_Sheet_Cancel`, `Loading_Sheet_View`, `Loading_Sheet_Edit`, `Manual_Loading_Sheet_Cancel_Uncancel` | `/api/loading-sheets`, `LoadingSheetPage` | ✅ tested — see "Loading sheets" below |
| Challan entry — road, "for manifest" (vendor / vehicle / driver / hire + voucher) | `Operation/dispatchentry_fleet.aspx` | `POST /api/challans`, `ChallanEntryPage` | ✅ tested — see "Challan: not ported yet" below |
| Challan view / cancel | `Operation/dispatchentry_fleet_Cancel.aspx`, `dispatchentry_fleet_View.aspx` | `/api/challans`, `ChallanListPage` | ✅ tested |
| Arrival entry — branch wise (received / short packets, weight difference, closing km, excess dockets) | `Operation/Arrival_Entry.aspx` | `POST /api/arrivals`, `ArrivalEntryPage` | ✅ tested — see "Arrival: not ported yet" below |
| Arrival view / cancel | `Operation/Arrival_Entry_Cancel.aspx`, `Arrival_Entry_View.aspx` | `/api/arrivals`, `ArrivalListPage` | ✅ tested |
| DRS entry — delivery run sheet at the delivering branch (split packets across runs) | `Operation/Drs_Entry.aspx` | `POST /api/drs`, `DrsEntryPage` | ✅ tested — see "DRS: not ported yet" below |
| DRS view / cancel | `Operation/Drs_Entry_Cancel.aspx`, `Drs_Entry_View.aspx` | `/api/drs`, `DrsListPage` | ✅ tested |
| Delivery status — door (per DRS) and godown delivery; To Pay auto bill | `Operation/deliverystatusentry.aspx` | `POST /api/delivery`, `DeliveryStatusPage` | ✅ tested — see "Delivery status: not ported yet" below |
| Delivery status view / cancel (per DRS, admin only) | `Operation/deliverystatusentry_Cancel.aspx`, `deliverystatusentry_view.aspx` | `/api/delivery`, `DeliveryListPage` | ✅ tested |
| POD dispatch (IOM) with the signed POD images (JPEG / PDF) | `Operation/Pod_Dispatch.aspx` | `POST /api/pod`, `PodDispatchPage` | ✅ tested — see "POD: not ported yet" below |
| POD dispatch view / cancel (images viewable) | `Operation/POD_Dispatch_Cancel.aspx`, `POD_Dispatch_View.aspx` | `/api/pod`, `PodListPage` | ✅ tested |
| POD courier to head office (self / courier + AWB, one document for several IOMs) | `Operation/POD_Dispatch_To_Head_Office.aspx` | `POST /api/pod-courier`, `PodCourierPage` | ✅ tested |
| POD courier view / cancel | `Operation/POD_Courier_Cancel.aspx`, `POD_Courier_View.aspx` | `/api/pod-courier`, `PodCourierListPage` | ✅ tested |
| POD receive at head office (partial receipts) | `Operation/podreceive.aspx` | `POST /api/pod-receive`, `PodReceivePage` | ✅ tested |
| POD received view / cancel | `Operation/POD_Received_Cancel.aspx`, `POD_Received_View.aspx` | `/api/pod-receive`, `PodReceivedListPage` | ✅ tested |
| Docket Booking Register (report pattern) | Crystal Reports | `/api/reports/docket-register`, `ReportPage` | ✅ tested |
| Branch Master (list / add / edit / delete; binds the branch ledgers) | `Master/Branch_Master.aspx` | `/api/branches`, `BranchMasterPage` | ✅ tested — see "Branch: not ported yet" below |
| Vendor Master (list / add / edit / delete; binds the vendor ledger used by challans) | `Master/Vendor_Entry.aspx` | `/api/vendors`, `VendorMasterPage` | ✅ tested — see "Vendor" below |
| Vehicle Master (list / add / edit / activate-deactivate; routes for attached vehicles; binds the vehicle ledger) | `Master/Vechile_Master.aspx`, `View_Vechile_Master.aspx` | `/api/vehicles`, `VehicleMasterPage` | ✅ tested — see "Vehicle" below |
| Client Master (list / add / edit / delete; binds the BILLED / UNBILLED ledgers used by docket booking) | `Master/Client_Master.aspx` | `/api/clients`, `ClientMasterPage` | ✅ tested — see "Client" below |
| Employee Master (list / add / edit / delete; binds the employee ledger; delivery boys feed pickup and DRS) | `Master/Employee_Master.aspx` | `/api/employees`, `EmployeeMasterPage` | ✅ tested — see "Employee" below |
| User Master — staff logins (create for an employee, home + switchable branches, reset password, activate / deactivate, delete; admin only) | `User/User_Master.aspx` | `/api/users`, `UserMasterPage` | ✅ tested — see "Users" below |
| Client Contract — **stages 1–2: City / Location / State / Zone credit rates** (list per client, new rates in versions, edit amounts / charges, extend end date, deactivate, "ending in 30 days"); **stage 3 part: weight, category and pickup / delivery charge slabs, Paid / To Pay general rates, KM rates, CARGO per-km pricing, per-box flags, export** used by docket booking | `Rate/Client_Contract.aspx` | `/api/contracts`, `ContractPage` | ✅ tested (incl. the docket rate lookup and which contract type wins) — see "Client contract" below |
| ODA Charge — ODA charge by location and weight band, versions by effective date; ODA location on the docket fills the ODA charge | `Rate/ODA_Charge.aspx` | `/api/oda-charges`, `OdaChargePage`, `/api/dockets/lookup/oda` | ✅ tested — see "ODA Charge" below |
| PRS / DRS Rate Master — what a pickup / delivery vendor or own vehicle is paid (per km, per kg, round trip) by FTL type from an effective date; list, filters, export | `Rate/PRS_and_DRS_Rate_Master.aspx` | `/api/prs-drs-rates`, `PrsDrsRatePage` | ✅ tested — see "PRS / DRS rates" below |
| Vendor rate masters — road (FTL / FTL per km / per kg / per km, co-loader per kg), air (per kg + weight slabs, airline charges for Self), train (per kg / full-container trip cost); versions by effective date; the challan's hire charge from the road rate | `Rate/Vendor_Road_Rate_Master`, `Vendor_Air_Rate_Master`, `Vendor_Train_Rate_Master` | `/api/vendor-rates`, `VendorRatesPage`, `/api/challans/vendor-rate` | ✅ tested — see "Vendor rates" below |
| Franchisee rates — commission master (rent / mobile / signage, base-freight %, road rows per booking type: LTL %, FTL 3–6 t / 9–16 t, trailer; train / air %) and each franchisee's pickup / delivery rates by document or weight band | `Rate/Franchisee_Commission_Master`, `Franchisees_Pickup_Delivery` | `/api/franchisee-rates`, `FranchiseeRatesPage` | ✅ tested — see "Franchisee rates" below |
| General Rate Master — the standard tariff (City / Location / State / Zone, no client), list / new / edit / export, weight slabs; a client rate can **copy** it (with its slabs) with a discount or hike % | `Rate/General_Rate_Master.aspx` | `/api/general-rates`, `ContractPage book="GENERAL"`, `/api/contracts/general-rate` | ✅ tested — see "General Rate Master" below |
| Client bill (GST) — a contract client's dockets billed at the branch → one bill (SAC, GST / IGST, due date from the credit period), list / view / cancel, bill print | `Invoice/Client_Bill_GST`, `Client_Bill`, `Client_Bill_Cancel`, `client_bill_ReportGST`, `client_bill_Report`, `Client_Bill_PrintGST`, `Client_Bill_Print` | `/api/client-bills`, `ClientBillPage`, `ClientBillListPage`, `ClientBillPrintPage` | ✅ tested — see "Client bill" below |
| Bill submission and finalize — hand bills to the client (receiver), finalize with the BILLED / UNBILLED voucher, undo either | `Invoice/Client_Bill_Summation`, `Client_Bill_Summation_old`, `Bill_Finalized`, `Bill_Finalized_Cancel`, `Client_billFinalise_view` | `/api/client-bills/submission`, `/api/client-bills/finalize`, `BillStagesPage` | ✅ tested — see "Bill submission and finalize" below |
| Paid / To Pay bills — consignor (Paid) / consignee (To Pay) bills, finalize without submission (pending collection / recovery voucher), receipt | `Invoice/client_topay_paid_bill`, `PaidAndTopayBill_Finalized` | `/api/client-bills` (billType), `/api/client-bills/finalize` (by=paidtopay), `/api/bill-receipts` (kind=paidtopay) | ✅ tested — see "Paid / To Pay bills" below |
| Miscellaneous and warehouse bills — one-line GST bill, submit, finalize (client / output GST / income voucher), cancel, print | `Invoice/Miscellaneous_Bill`, `Warehouse_bill` + Submission, Finalise, Cancel, ReportView, Print pages (12) | `/api/other-bills/:kind`, `OtherBillPage` | ✅ tested — see "Miscellaneous and warehouse bills" below |
| Octroi bills — octroi paid on a client's dockets billed back (service charge + tax), submit, cancel, print | `Invoice/Octroi_Bills`, `Octroi_Bill_Summation`, `Octroi_Bill_Cancel`, `Octroi_Bill_Report`, `Octroi_Bill_Print`, `OctroBillFinalise` | `/api/octroi-bills`, `OctroiBillPage` | ✅ tested — see "Octroi bills" below |
| Franchisee commission invoices — monthly invoice of a franchisee's commission on its branch's dockets (+ rent / mobile / signage, TDS), print, cancel | `Invoice/Franchisee_Commission_Invoice`, `Franchisee_Invoice_Cancel` | `/api/franchisee-invoices`, `FranchiseeInvoicePage` | ✅ tested — see "Franchisee commission invoices" below |
| Vendor invoices — other vendors' bills (lines, GST, TDS, cost centres, PURCHASE/PAYBILL voucher), transport vendors' bills verified against challans, pending report | `Invoice/VendorInvoice`, `OthVndInvoiceDetails`, `OtherVendorPrint`, `Vendor_Invoice_For_Varification`, `VendorPendingInvoiceReport`, `Vendor_Invoice_Print` | `/api/vendor-invoices`, `/api/vendor-invoices/verify`, `VendorInvoicePage`, `VendorVerifyPage` | ✅ tested — see "Vendor invoices" below |
| Bill receipt — money received against finalized bills (part / full, TDS, deduction, round-off, other income; cash or bank), voucher, list / view / cancel | `Invoice/Bill_Receive` | `/api/bill-receipts`, `BillReceivePage` | ✅ tested — see "Bill receipt" below |
| Settings — destinations bound to a branch, franchisee ↔ branch, franchisee ↔ client | `Setting/Bind_Destinationtobranch`, `Franchisee_Bind_Branch`, `Bind_Franchisee_to_Client`, `Franchisee_to_Client_View` | `/api/bindings`, `BranchDestinationsPage`, `FranchiseeBranchPage`, `FranchiseeClientPage` | ✅ tested — see "Settings" below |
| Settings — change docket financial year (stage by stage), effective date change / back-dating of client and PRS / DRS rates | `Setting/ChangeDocket_FY`, `EffectiveDateChange`, `ClientRateMasterEffectiveDateMmodification` | `/api/docket-fy`, `/api/effective-dates`, `DocketFyPage`, `EffectiveDatePage` | ✅ tested |
| Settings — ODA distance / weight bands and ODA rate configuration | `Setting/ODA_Master_And_Configuration` | `/api/oda-config`, `OdaConfigPage` | ✅ tested |
| Settings — shipper (docket-number) stock, gate-pass stock, issue to branch / franchisee, number moves | `Setting/Shiper_Master`, `GatePassShiper_Master`, `Shiper_Issue_Details`, `shiper_issue_details_to_Franchisee` | `/api/shippers`, `ShipperStockPage`, `ShipperIssuePage` | ✅ tested |
| Settings — special booking (discount) approval, freight / THC margin approval | `Setting/Special_Booking_Approval`, `Freight_THC_Margin_Approval` | `/api/approvals`, `ApprovalPages` | ✅ tested |
| Settings — vendor vehicles (road / air / train), MIS auto mail settings | `Setting/Vendor_and_vehicle`, `MIS_Report_Auto` | `/api/vendor-vehicles`, `/api/auto-mis`, `VendorVehiclePage`, `AutoMisPage` | ✅ tested (MIS mail sending not wired — needs SMTP) |

**The docket life cycle is now complete end to end:** booking → pickup (PRS) → manifest → challan →
arrival → DRS → delivery status → POD dispatch → courier to HO → POD receive (each with view / cancel).

**POD: not ported yet** — direct / bulk POD dispatch, POD modify, HO-copy dispatch (`Courier_Type = HOCOPY`),
editing a courier document, POD tracking and the IOM / courier prints. POD receive stays head-office only
(`HEAD_OFFICE_BRANCH`, default `B1001`, as the legacy page hard-coded). **Images:** stored in `POD_UPLOAD_DIR` (default `server/uploads/PODImage`, git-ignored)
with server-generated names and the path `~/PODImage/<file>` in the database — point `POD_UPLOAD_DIR` at the legacy
site's `wwwroot/PODImage` during the changeover so both applications see the same files. They are stored as uploaded
(the legacy page halved JPEG dimensions); served only through `GET /api/pod/images/:id` to the dispatching or
receiving branch (and admin).

**Delivery status: not ported yet** — FTL docket-wise status (`usp_GetFTL_DocketwiseList`), franchisee
delivery commission, direct delivery status (`deliverystatusentrydirect.aspx`), cancelling godown statuses
(the legacy cancel only works per DRS). **Decision to confirm:** the To Pay auto bill now runs only for
DELIVERED dockets (legacy ran it for any status, including undelivered and lost).

**DRS: not ported yet** — franchisee DRS (non-DIV1001), direct DRS at the booking branch
(`Drs_Entry_direct.aspx`), local DRS, DRS edit, the DRS print and the PRS/DRS vehicle challan
(`Prs_Drs_Challan.aspx`, the "FOR DRS / FOR PICKUP" dispatch). Only door-delivery dockets appear
(godown deliveries go straight to delivery status).

**Arrival excess dockets (done):** a docket that came on the truck though its manifest is on another challan is
scanned under "Excess dockets" (GET_DOCKET_DETAILS_FOR_EXCESS_DOCKET_ARRIVAL — rebuilt: a manifest to this branch, dispatched,
not cancelled, the docket not yet received) and received in full with the arrival (Arrival_Packg / grn_docket_charge
IsExcessArrival = 1, under its own manifest no.). Its weight can be corrected; the weight-difference check stays on this
challan's manifests. **Changes:** the other manifest is marked arrived once none of its dockets is still on the way
(otherwise its challan stayed pending with nothing left to receive) and opens again when the arrival is cancelled; a docket
of this challan, an unknown one or one already received is refused (the page merged the grid without checks).

**Arrival: not ported yet** — city-wise (FTL, DIV1003) arrival, the short-arrival follow-up (`Short_Arrival_Entry.aspx`), master-bag / packet manifest arrivals,
arrival edit and the arrival print. The ClassLibrary source for arrival is **older than the deployed
`bin/ClassLibrary.dll`** (the page calls methods the source doesn't have); procedure names were read
from the DLL — see `SCHEMA-VERIFICATION.md`.

**Challan: not ported yet** — AIR / TRAIN / TEMPO dispatch (own legacy screens; TEMPO never
loaded vendors in the legacy page), the "FOR PICKUP" / "FOR DRS" dispatch types (with Stage 4, DRS),
"without manifest" challans, consolidated e-way bill generation (external MastersIndia API),
challan edit (`dispatchentry_fleet_Edit.aspx`) and the challan print (Crystal `Challan_Print`).
The hidden "Rate On" vendor-rate lookup is not used: the live legacy screen hides that row and
freight is the sum of the charges typed in (`shared/challanCalc.js`). The allocated-driver
lookup reads `VGetAllocatedDrivers` from the fleet DB and is skipped when `FLEET_DB_NAME` is not set.

**Branch: not ported yet** — the related binding screens `Setting/Bind_Destinationtobranch.aspx` and
`Setting/Franchisee_Bind_Branch.aspx` (separate pages). Branch codes are `B` + next number, generated
under a lock (the legacy `get_id` read the max outside any transaction). Delete is refused while dockets,
employees, manifests, challans, pickups, routes or controlled branches still refer to the branch
(deactivate it instead); the legacy page deleted unconditionally.

**Vendor:** market vendors (`temp_vendors_master`), other vendors, vendor vehicles and vendor rates are separate
pages, not ported yet. The vendor name cannot be edited (it is part of the ledger name, as in the legacy page).
**Decision to confirm:** changing a vendor's branch creates a ledger under the new branch name and keeps the old
one (legacy behaviour — the challan vendor list then shows both). Vendor codes are never reused after a delete.

**Vehicle: not ported yet** — the purchase voucher for own (Self) vehicles bought on loan (loan receive + purchase
entries, posted by `usp_Insert_Vechile` through `@ud_Transaction_Details`; the new app passes an empty table), the EMI
loan sheet, insurance and accident entries, the Excel export, the vehicle-maker master (`General/VehicleName_Master.aspx`)
and `Setting/Vendor_and_vehicle.aspx`. As in the legacy list page there is no delete — deactivate instead; an inactive
vehicle is no longer offered on the challan screen (new). Capacity comes from the vehicle type (`freight_master`).

**Client: not ported yet** — extra branches of a client (`Client_Master_AddOn.aspx`), client documents
(`Client_Document.aspx`), client login users (`User/client_user_master.aspx`), contracts / rates (`Rate/Client_Contract.aspx`)
and the Excel export. The client name and billing branch cannot be changed after creation (they are part of the ledger
names; the legacy page also locked them once the ledgers existed). New clients belong to the logged-in division, as in
the legacy page. Client codes (C1001, …) are never reused after a delete.

**Employee: not ported yet** — photo / document upload and `Employee_Files_Details.aspx` (the legacy upload was unsafe:
browser file names, concatenated SQL — see SECURITY #14; existing paths are kept unchanged on edit), salary / PF / ESI settings,
resignation and leave (HRM), the Excel export. **Logins are separate:** a new employee cannot sign in until a `users` row
exists (the legacy user-creation page is not ported yet; confirm whether `usp_insert_Employee_Master` also created one).
A renamed employee keeps the ledger already created for that division (entries stay on it); the legacy page created a
second ledger under the new name. Pickup and DRS now list active employees only, and DRS finds staff with several divisions.

**Users:** franchisee and client login pages (`Franchisee_User_Master.aspx`, `client_user_master.aspx`), franchisee access
rights, mobile / dashboard access are separate pages, not ported yet. A login inserted by the new app has no `DivCode`
(as the legacy page), so it may sign in to every division. Logins are created with an inline INSERT — the legacy
`users_bal.insert_users_master` procedure name was not found in the DLL; confirm the columns (SCHEMA-VERIFICATION.md).
Inactive logins (`user_status = 'Inactive'`) are now refused at sign-in when the login procedure returns `user_status`.

**Client contract (stages 1–2 of 3):** City, Location, State and Zone rates for credit clients, with every charge of the legacy
row, each type in its own table (`client_contract_city`, `_location`, `_State`, `_zone`). A new rate for a route is a new version
(new row); docket booking takes the most specific type that matches — location (only when locations are sent; the docket screen
does not send them yet), then city, state, zone — and within it the version in force on the booking date. **Decision to
confirm:** that precedence is the dev stand-in's; check the real `sp_Select_Rate`.

**Stage 3, weight slabs (done):** a WEIGHT rate can carry up to 10 weight bands (from / to kg, rate, discount %, approved
discount %) in `ClientRate_With_Slab`, linked to the rate by its EntRef, entered with the rate or later in Edit. The docket
screen sends the charge weight to the rate lookup (again when the weight changes or volumetric weight is applied); the band
holding the weight replaces the flat rate and its approved discount (else its discount) fills the special discount, as the
legacy `BindRateOnWeight` / `BindSpecialDiscountOnWeight` did. No band → the flat contract rate. Deactivating a rate
switches its slab off too. The lookups call the real procedure names (`usp_Get_OnAccountSlabRateWeight_Curier`,
`…SlabDiscountWeight_Curier`, `…SlabApprovedDiscountWeight_Curier`); their bodies are dev stand-ins (SCHEMA-VERIFICATION.md).

**Stage 3, category slabs (done):** rate on CATEGORY is offered in every division (as `Bind_Rate_On` did). A CATEGORY rate must
carry its category slabs (`ClientRate_Category_Slab`, up to 10): product (`item_master`) + weight from / to + a rate per package
size (big / medium / small). Bands of one product may not overlap; different products may share weights. On the docket, with
rate on CATEGORY, the package type, the new **Package size** field and the charge weight pick the band, and that rate is the
freight of the docket (the calculator already charged CATEGORY as a flat rate); no band or no rate for that size → the
contract's flat rate. The contract's discount is kept (the legacy page did not read slab discounts for CATEGORY). Fixed legacy
bug: band 1's small-package rate was never saved (the page set `RateSmall2` twice).

**Stage 3, pickup / delivery charge slabs (done):** a City To City WEIGHT or BOX rate can carry up to 10 pickup and 10
delivery bands (from / to kg — packets on BOX — → charge) in `Min_chargeRate_slab`. Pickup slabs only for delivery modes
DM-101 / DM-103 and delivery slabs for DM-101 / DM-104, as the page enabled them. **They belong to the route** (client + origin
city + destination city + rate on), not to one version — as on the page, which saved them without the rate's EntRef; saving a
set switches the older set off (`isactive = 0`), and a new version saved without charge slabs keeps the route's current ones.
On the docket the charge weight (packets on BOX) picks the band, which fills the collection / delivery charge. **Behaviour
change:** when no band matched the page wrote 0 into those boxes, wiping the contract's collection / delivery charge; now the
contract's charge stays.

**Stage 3, Paid / To Pay general rates (done):** the page's Rate type (Credit / Paid / To Pay). Paid and To Pay rates are
saved in the same four tables with `RateType` / `BookingType` = Paid or To Pay and no client or billing branch (''), as
the page did; everything else (types, versions, charges, weight / category slabs) works as for Credit. The list has a Rate
type filter (Paid / To Pay need no client). On the docket a **General Client** now gets a rate too ("Get general rate", and
on picking the destination or the booking type): the general rate of its booking type (Paid / To Pay; none for FOC). A
DIV1001 document rate for Paid / To Pay must have weight slabs (the page's "Please Enter the Slab Rate Details").
Pickup / delivery charge slabs stay Credit-only (the page asked for the client first).

**Stage 3, KM rates (done):** rate on KM in divisions other than DIV1001, for Location / State / Zone rates (the page removed
KM on City To City), mode Road and non-document only. A KM rate is a per-km rate plus the route's distance (km, required);
for Location rates "Fetch" reads `Distance_Location_Master`. On the docket the lookup returns the distance, which fills the
Distance box, and the freight is rate × distance (the calculator already did that). **Fixed legacy bug:** the page saved the
per-km rate as 0 on every new rate (`perkmperkg_rate = 0` / `PerKMRate = 0` hard-coded) — it is now saved.

**Stage 3, the rest (done):**
* **CARGO (DIV1002) weight rates** on City / Location: the rate is worked out, as `txtPkV_TextChanged` did — base freight =
  distance (km) × rate per km per kg, admin charge = base × admin % / 100, rate = base + admin (the page disabled the rate
  box, so distance and rate per km per kg are required; a typed rate is ignored). "Fetch" reads the distance masters. On City
  To City `basefrt`, `admincharge`, `adminchrgper` are saved (the page's Location INSERT has no such columns). Editing recomputes.
  State / Zone CARGO weight rates are typed in (the page never computed them — its State branch did nothing).
* **Per-box collection / delivery flags** (`col_charge_IsPerBox`, `del_charge_IsPerBox`) are saved and editable on the rate.
  The legacy docket's per-box calculation was commented out, so they do not change docket charges (as before).
* **Export to Excel**: the list exports every column of the shown rates (CSV, opens in Excel).

Client Contract is now fully ported. The dev database's rate lookups (`Get_BillingAt`, `sp_Select_Rate`) now read the four contract tables; ACME's sample
rates were moved to `client_contract_city` with the same values.

**General Rate Master:** the standard tariff in its own tables (`GenaraleRate_Master_City` — sic — `General_Rate_location`,
`General_Rate_State`, `General_Rate_zone`), handled by the same code as the client contract (a "book"): the same types,
rate-on rules (not CATEGORY), charges, KM and CARGO per-km pricing, versions and export — without client, billing branch or
rate type (the page's Rate type lists only Credit). In a new client rate, **"Copy from general rate"** fills the amounts and
charges from the general rate in force for the row's route (the page's rbtnCERate "General Rate Master" option,
CompToGRM_*), and a **discount % or hike %** then changes the copied rate (txtDiscount / txtHike; one or the other).
General rates keep **weight slabs** too (`General_Rate_With_Slab`, by EntRef — never the client slab tables, whose EntRefs
may overlap), switched off with the rate. "Copy from general rate" brings the slabs along, and the discount / hike % changes
every slab rate as well (the page's btnIsSlab_Click with txtDiscount / txtHike).
**"Copy current rate"** (the page's "Existing Rate", rbtnCERate 2, CompToCRM_*) copies the client's own rate in force for the
route at that billing branch and rate type — e.g. to renew it with a hike. The legacy chooser (Card Rate / Existing Rate /
New Rate) was hidden on the page (`Visible="false"`); both copies are offered in the new app.
**Decisions:** the discount / hike % is only applied to the copied rate (the page also saved it in `Discount` / `Hike`,
and `Discount` doubles as the docket discount — saving it would discount twice); general rates are not read by docket
booking (nothing in the source shows `sp_Select_Rate` reading them — confirm).

**Docket entry — fields filled from the data** (OperationScript.js chains, OperationService / OperationDAL):
* **Docket no.** → the shipper issue it belongs to (Get_Branch_shiper_issue / Get_client_shiper_issue): a number issued
  for a client makes the docket that client's (contractual, on account of filled in); a number issued to another branch,
  or not issued at all, is flagged. (The page locked the origin to the issuing branch; the new app warns instead, since
  the origin is the login branch.)
* **Destination city** → destination branch(es), the city's locations with PIN codes, the serving branch's location and
  PIN pre-selected (Get_BranchLocation / BindPin), GST mode, expected date; **PIN typed** → its location (GetLocation, "This
  postal code does not belong to the destination city"); an **ODA location** (ODA rate in force) fills the ODA charge.
* **Origin location** → the booking branch's city locations, its own location pre-selected (Get_LocationByBranch); origin
  and destination locations are passed to the billing-at and rate lookups (Location To Location contracts).
* **On account of** → only active clients of the division (Check_ValidOnAccountOf); the client's own name / address / city /
  state / PIN / phone / GSTIN fill the consignor (or consignee, by client_Master.Credit_Type — AutoConsigner); the rate-on
  and delivery mode of its active contracts to the destination are chosen (GetOnAccountRateOn / DeliveryMode); then
  billing-at and the contract rate as before.
* **Consignor / consignee city** → its state (GetStatebyCity).
* **Not ported yet:** delivery mode by weight (GetDeliveryModeByWegiht — its table is not in the source), the DIV1002
  parcel ODA (Get_ParcelOdaRate, from the ODA configuration bands), vehicle number → vendor / capacity for FTL (the docket
  form has no vehicle field yet), FOC company name.

**Other operation screens — data links** (server postbacks of pickup_entry, menifest, dispatchentry_fleet, Arrival_Entry,
Drs_Entry, deliverystatusentry, Pod_Dispatch, POD_Dispatch_To_Head_Office, podreceive were mapped control by control):
* already linked when first ported: pickup boy → mobile; manifest destination type → branch / city list, co-loaders;
  challan route → destination, km, stops, route times; vendor type → vendors (with TDS) → trucks → make / model / engine /
  chassis / capacity, "truck is running" warning, allocated driver; driver name → mobile; arrival challan → manifests →
  dockets with inward weight; DRS delivery staff → mobile; delivery status → undelivered reasons; POD docket → eligibility.
* **added now:** a pickup or a DRS can be given to a **franchisee** (the pages' chkFranchisee / ddlFranchisee) — the
  franchisees with an active branch binding (Setting → Franchisee Bind Branch), the one of this branch first; the DRS
  stores Franchisee_Code / isFranchisee and the franchisee's name as "delivered by"; the **challan's truck list** now also
  has the vendor's road vehicles added on Setting → Vendor and Vehicle (vendor_vehicle_master — the table the legacy
  challan read), with their details and capacity.
* **Not ported yet:** FTL docket-wise delivery status. (Done since: the challan hire charge from the vendor road rate —
  "Vendor rates"; the manifest from a loading sheet — "Loading sheets"; excess dockets on arrival — "Arrival excess dockets".)

**Client bill (GST)** (Invoice folder, first part): pick the client (the branch's clients; head office: all) — its billing
address, the due date (bill date + credit period) and the tax type (GST when the client's state is the branch's, else
IGST) fill in; pick the service type (SAC code from Sac_Master) and search the client's pending dockets: contract
dockets on account of the client, billed at this branch, not billed yet, amounts > 0 with a rate / freight type, of the
tax type, booked in the range (optional: booking mode, delivered / undelivered, a docket list). Tick and generate: bill no.
BL + short code + FY + 6 digits, client_bill + client_bill_charge_details, dockets marked `Invoice_status =
'invoicegenerated'` with the bill no. The print opens in its own tab (tax invoice with amount in words; Print / Save as
PDF). View / Cancel lists the login year's bills with their status (generated, submitted, finalized, paid, cancelled).
**Changes:** amounts are re-read from the dockets on the server (the page saved the grid's posted amounts); the
"Amount Mismatch, Plz Modify docket" and "GST Amount not available" checks run for every docket on save (the page only
checked when a box was ticked); the bill no. is taken inside the save's transaction (the page worked it out on load /
search); a docket on another active bill is refused (the page returned half-way with the transaction open); bill date
up to 10 days back (the page's hidden min date) and inside the login year; cancel needs a reason, is refused once the
bill is submitted / finalized / paid (those checks were commented out on the cancel page) and frees the dockets for a new
bill; parameterised SQL. **Not ported yet:** bill receipt, bill edit (Client_Bill_GSTEdit), city-wise search, Paid / To Pay bills, non-freight / miscellaneous / warehouse /
octroi bills, e-invoice, vendor and franchisee invoices.

**Bill submission and finalize:** Bill Submission lists the generated bills of clients submitted at this branch
(client_Master.SubmissionLocation, else the billing branch); tick, give the date and the receiver (name, phone, remarks)
→ submitted (`ClientBill_Summation_status = 'Active'`); "Submitted" tab: cancel the submission while not finalized. Bill
Finalize lists the submitted bills of this billing branch (or, "collection branch wise", of clients collected here); tick
and finalize → `ClientBill_Finalize_status = 'Finalized'` and the voucher Dr the client's BILLED ledger / Cr its UNBILLED
ledger for the bill amount (voucher no. = bill no., mode "Bill Finalized"); "Finalized" tab (Client_billFinalise_view /
Bill_Finalized_Cancel): cancel finalize while nothing is received — the voucher lines are cancelled. **Changes:** bills are
re-read on the server (the page posted client name, billing branch and amount from its grid and finalized only the first
row); both ledgers must exist before anything is saved, voucher and status in one transaction; the submission branch is
checked for every bill (the page checked the first row); dates may not be in the future or before the bill / submission
date. **Not ported:** the submission letter print (Client_Bill_Submission_PrintGST), bill submission numbers
(INSERT_INTO_CLIENT_BILL_SUBMISSION), miscellaneous-bill finalize (GetFinalised_bill_MIS).

**Bill receipt** (Bill_Receive, bills "To Be Billed"): pick the client — its finalized, unpaid bills collected at this branch
(client_Master.CollectionLocation, else the billing branch) are listed with what is still outstanding. Per bill: received,
TDS, deduction, round-off ("Full" fills the rest); other income for the receipt; cash (CASH <branch>) or bank (bank ledger,
NEFT / RTGS / cheque …, number and date, client's bank). Saving: BR no. (BR + short code + FY + 6 digits), Bill_Receive +
Bill_Receive_Details and the voucher (mode 'BILL RECEIVE'): Dr cash / bank (received + other income), Dr TDS Receivable,
Dr Freight Income Deduction, Dr / Cr ROUND OFF; Cr the client's BILLED ledger (per bill: received + TDS + deduction +
round-off), Cr Other Income. A bill settled in full is Paid, else "Part paid"; finalize cannot be undone once anything is
received. Receipts tab: list, view (bills + voucher), cancel with a reason (voucher cancelled, bills outstanding again).
**Changes:** bills and outstanding re-read on the server and a bill cannot be settled for more than it owes (the page took
amounts and the client ledger from its grid); the voucher balances (the page credited round-off on both sides and credited
delivery / hamali charges nothing debited); BR no. inside the save; every ledger checked first (the page tested the Hamali
ledger with the Delivery ledger's result); cancel added (the page only had edit). **Not ported:** Paid / To Pay bill
receipts (rdoBillType To Pay / Paid, docket-wise), "Other Bills" / "Old Bills", other-reference (on-account) receipts,
receipt edit, Money_Receive (DRS money receipts).

**Paid / To Pay bills** (client_topay_paid_bill, PaidAndTopayBill_Finalized; receipts in Bill_Receive "Paid / To Pay"):
the Client Bill page's **Bill type** — Paid: the party is the consignor of Paid dockets booked at this branch; To Pay: the
consignee of To Pay dockets delivered from this branch (consigner_master; a party that is also a client keeps its client id).
Bill no. BP / BT + short code + FY + 6 digits (the page's BillTypeShortCode P / T); `client_bill.Bill_Type` = Paid / To Pay.
These bills are not submitted: Bill Finalize → "Paid / To Pay bills" finalizes them with Dr the receivable — the client's
BILLED ledger when the party is a client ("client wise"), else PAID / TOPAY BOOKING PENDING COLLECTION — and Cr
PAID / TOPAY RECOVERY :<branch name> :<branch code>. Bill Receive → "Paid / To Pay bills" receives them: Cr the same
receivable, deduction to "Booking Income Deduction". **Changes:** the receipt credits the ledger the finalize debited (the
page credited the RECOVERY ledger again, so pending collection never cleared); delivery / hamali charges on these receipts
are not posted (the page credited them without a matching debit); party, dockets and amounts are re-read on the server.
**Not ported:** the docket-wise search (txt_search_docket), "register cancel bill" (chk_reg_cancel_bill), the 9-docket limit
of DIV1003, DIV1002 client type (inbound / outbound).

**Miscellaneous and warehouse bills** (Miscellaneous_Bill / Warehouse_bill and their Submission, Finalise, Cancel, ReportView,
Print pages — the two are the same form on two tables): a one-line bill to a client of the branch for a month (service GTA /
Courier, service for, SAC, GST slab, quantity × rate; CGST + SGST intrastate, IGST interstate — set from the client's state).
Bill no. MIS / WHO + short code + FY + 6 digits. Bills tab: submit (date, receiver), finalize — voucher Dr the client's
BILLED ledger (total), Cr OUTPUT CGST / SGST / IGST, Cr BOOKING INCOME MISCELLANEOUS / WAREHOUSE (taxable) — undo finalize,
cancel (until finalized), print. **Changes:** amounts computed on the server; the bill no. inside the save (the page's
increment dropped the FY after the first bill); finalize posts one balanced voucher in one transaction with every ledger
checked first (the page posted five separate entries, looked the ledgers up by name without the year and redirected to the
octroi page); amounts for finalize re-read (the page took them from its grid); a month after the current month is refused;
undo finalize added. **Not ported:** receipts for these bills (Bill_Receive "Other Bills"), the vendor / cost-centre fields
the page declared but never saved, octroi bills.

**Octroi bills** (Octroi_Bills, Octroi_Bill_Summation, Octroi_Bill_Cancel, Octroi_Bill_Report, Octroi_Bill_Print; OctroBillFinalise
is an empty page): octroi paid on a client's dockets billed back. Pick the client (any active client of the division), search its
dockets booked at this branch that are not on an octroi bill (dates / docket list), enter per docket the octroi paid, other
charges, service charge % and tax %; one octroi receipt no. per bill (unique). Bill no. OB + short code + FY + 6 digits; dockets
get `Octroi_Status = 'invoicegenerated'` and the bill no. Bills tab: submit (receiver), cancel (frees the dockets; refused once an
octroi money receipt exists), print. **Changes:** amounts computed on the server (service charge = octroi × %, tax on service
charge + other charges; the page saved its text boxes and the header total as 0); the old service tax / SBC / KKC columns are one
tax % (octroi ended with GST in 2017); bill no. inside the save (the page's "OB-yy-n" took the maximum of all years); octroi no.
and dockets re-checked inside the save. **Not ported:** octroi money receipts (Octroi MR, Money_Receive), finalize (none in the
legacy app).

**Docket tracking** (`/tracking?docket=…`, `GET /api/dockets/:no/journey`). The legacy page listed only the rows of
`docket_tracking`, which every operation had to write itself — pickups, loading sheets, bills and receipts never did, so a docket
stopped at "Booked". The journey is now built from the operation entries (`server/src/modules/docket/tracking.service.js`): booking,
pickup, loading sheet, manifest, challan (vehicle / vendor / driver), arrival (short packages), DRS (delivery person / vehicle),
delivery status (receiver / reason), POD sent and received, bill, submission, finalize and money received; cancelled entries are
shown struck through, other `docket_tracking` rows are kept. The page shows a summary (route, dates, packages, consignor / consignee,
where it is now, freight and bill for staff), progress steps and three views: **Entries grid** (one row per entry with every value
entered on it — entry no., date / time, branch, to branch, packages, short, weight, amount, vehicle, person / driver, vendor, receiver,
status, remarks, entered by; the cell with a wrong value is red), **Field comparison** (one row per field, one column per entry — what
value went where; numbers that differ from the booking are orange) and the **Journey** timeline. **Problems** are worked out for every docket and
attached to the entry they belong to, with who entered it and what to do: booking without packages / weight / freight / consignee /
expected date; movement after the docket was cancelled; an entry dated (or timed) before the step it follows; more packages manifested
than booked; first manifest not from the booking branch; packages short or weight difference at arrival; delivered from a branch that
is not the destination; undelivered / RTO / lost (with the reason) and no re-attempt; delivered without a receiver; delivered late;
overdue; stuck at a step (manifested > 1 day, arrived > 2 days …); POD not sent after 7 days or not received at HO after 10; To Be Billed
not billed 30 days after delivery; bill unpaid after 60 days. Clients see only their own dockets and no amounts / billing problems.

**Analytics dashboard** (`/`, new — the legacy home page only had module tiles and a few counters). Filters: period presets (this
month, 30 / 90 days, this FY, 12 months) or any range up to three years, all branches or only the current branch. Overview: 14 KPIs
compared with the previous period of the same length (with sparklines), daily freight, period-vs-previous bars, where the dockets are
now, and plain-language insights (growth, client concentration, fastest growing / falling client, lost regular clients, on-time %,
slowest destination, collection %, hire as % of freight, busiest day). Booking: monthly / MoM growth / cumulative / daily weight,
weekday, hour, weekday × hour heatmap, six mixes (booking type, mode, load, document, customer type, GST paid by), weight and freight
bands, top clients, Pareto, destinations, lanes table and yield scatter, branch totals, branch × month heatmap, ODA share, yield by
mode, cancellations by branch. Operations: pipeline funnel, stages, delivery outcomes, transit-days histogram, transit and on-time by
destination / mode / month, pending ageing, undelivered reasons, manifests per day, hire by vendor, freight vs hire with margin, advance
vs balance, vehicle utilisation, pickups, POD status and turnaround, arrival weight differences, delivery staff productivity. Billing:
billed vs collected, collection efficiency, bill status, receivables ageing, top outstanding, payment modes, TDS, unbilled delivered
dockets and their age, billing-cycle days (DSO), other bills, revenue mix, Paid / To Pay / TBB freight, bill sizes. Vendors & accounts:
vendor expenses by ledger and month, franchisee commission, vouchers by type, Dr / Cr by month, transport vendor bills, cash vs bank,
most active ledgers. **Click-through:** every bar, slice, point, heatmap cell, funnel step, KPI and table row opens a drawer with the
records behind it (`/api/dashboard/drill`: dockets, bills, receipts, challans, manifests, pickups, other bills, vendor / franchisee
invoices, vouchers — the same expressions as the charts, so the counts match), with search, sorting, totals, CSV download and links to
the docket tracking and bill / invoice prints. Charts use Apache ECharts (`client/src/components/charts/Charts.jsx`): animated, hover tooltips, legend click to hide / show a series, zoom slider (and Shift + wheel) on long series, toolbox to switch bar / line / stacked, see the data or save the chart as an image, light / dark theme. **Live mode:** a switch re-reads the open tab every 30 s / 1 min / 5 min (relative periods move with the clock); charts animate to the new numbers, KPIs count up and glow when they change; "Refresh" re-reads at once and the time of the last update is shown. Top lists have a Top 5 / 10 / 20 switch. **Demo data:**
`server/db/dev/demo/demo-data.sql` loads about a year of made-up business tagged `DMO…` into every operational table so the charts have
something to show; `demo-remove.sql` deletes all of it (dev database only).

**Vendor invoices** (VendorInvoice, OthVndInvoiceDetails, OtherVendorPrint — `/invoice/vendor-invoice`; Vendor_Invoice_For_Varification,
VendorPendingInvoiceReport, Vendor_Invoice_Print — `/invoice/vendor-verification`). *Other vendor invoice:* a bill from an other
vendor (Other_Vendor_Master: stationery, repairs, services). Pick the vendor's ledger (shows its TDS % and whether a cost-centre split
is required), the part type (Purchase = goods with HSN, Pay Bill = services with SAC), GST or IGST, the expense ledger, the TDS
ledger (default TDS PAYABLE) and add product lines (quantity × rate, GST slab per line, description); optionally split the taxable
amount over cost centres (branch / docket / customer / vendor / employee). Saving takes the invoice no. (OTH + short code + FY + 6
digits) and posts one voucher, Mode `PURCHASE/PAYBILL`: Cr vendor (total − TDS), Dr INPUT CGST / SGST / IGST, Dr expense ledger
(taxable), Cr TDS ledger. Invoices tab: list, print (lines, cost centres, voucher), cancel. **Changes:** amounts, tax and TDS (vendor
master %) worked out on the server (the page saved its labels, stored the CGST % as the SGST % and the IGST % as the IGST amount when
re-adding lines); invoice no. inside the save (the page dropped the FY after the first invoice); all ledgers checked first, only the tax
ledgers in use required, voucher checked to balance; TDS ledger list for the login year (the page was fixed to 2018 - 2019);
cost-centre total checked against the invoice's taxable amount (the page compared it with the line being typed); the same vendor bill
no. cannot be entered twice; cancel added. *Vendor bill verification:* a transport vendor's bill checked against its CHT challans —
pick vendor, mode, challan dates; tick challans and enter the current payment against each balance; save with bill date, vendor's
bill no., bill amount, deduction, narration (bill no. VB + short code + FY + 6 digits, receipt code VIV + 4 digits). A challan whose
balance is fully covered is marked `IsVerified`. Pending report: verified bills per challan with the balance left; print; cancel
(opens the challans again). No voucher (none in the legacy page). **Changes:** the balance shown is the challan balance less earlier
verifications and the current payment cannot exceed it (the page let any amount through); only the branch's own challans are
listed. **Not ported:** the PRS / DRS challan option (those entries carry no vendor freight here), vendor payment against these bills.

**Franchisee commission invoices** (Franchisee_Commission_Invoice — `/invoice/franchisee-invoice`; Franchisee_Invoice_Cancel —
`/invoice/franchisee-invoice/cancel`, the same page on its list tab). Pick the franchisee (Franchise_Master bound to a branch in
Bind_Franch_Branch) and the month; the dockets booked at that branch in the month (not cancelled, not on a franchisee invoice) are
listed with the commission, the docket's handling and collection charges; tick, optionally add the month's rent + mobile + signage
(once per franchisee and month), enter TDS % and save. Invoice no. FINV + short code + FY + 6 digits; dockets get
`Franchisee_Invoice_Status = 'Generated'` and the invoice no. Invoices tab: list, print, cancel (frees the dockets). Commission per
docket from the franchisee commission master in force for the docket's mode on its booking date, on the base freight (FTL rate, else
freight, else rate × weight / boxes): road part load — the booking type's LTL row (% up to 3 tons, the 3–6 tons % above); road full
load — the booking type's FTL row by weight (3–6 t, 9–16 t, trailer): per consignment + share %; no row — the master's base
freight %; train % + per rail; air %. **Changes:** the page read an older per-franchisee table (Franchise_Commission_Master:
rate, fixed / %, handling rate) that no page maintained and whose "Fixed" commission was always 0 — the commission now comes from
the master the Rate pages maintain, and handling is the docket's handling charge; amounts are worked out on the server and the
dockets re-checked inside the save (the page saved its grid labels and saved the header even with no docket ticked); the month's
end date used the start month for both ends and the current year's day count; the cancel list shows the branch's invoices (the
page showed only the user's own) and its docket reset joined every invoice; monthly charges and TDS added (the legacy print view
had them). No voucher (none in the legacy page). **Confirm:** how FTL "per consignment + share %" combine and how the train
per-rail commission applies.

**Loading sheets:** the dockets lying at the branch (packages pending, not delivered) are put on a loading sheet — search
by booked dates and load type (All / PTL / FTL), tick, or scan docket numbers (a scanned docket outside the dates is added
to the list); number LS + branch short code + FY + 6 digits. View / Cancel lists the login year's sheets with dockets,
packages, weight and the manifest made from it; a sheet is cancelled only while no manifest is made from it ("Loading Sheet
Not be Cancel. Manifest Generated!"). Docket cancel / undo (the Manual_Loading_Sheet_Cancel_Uncancel page) takes one docket
off an open sheet or puts it back. **Manifest from a loading sheet:** Manifest Entry → "From loading sheet" lists only that
sheet's dockets (whatever their booking date); saving marks the sheet manifested and its dockets carry the manifest no.;
cancelling the manifest opens the sheet again. **Changes:** the number is taken inside the save's transaction (the page
worked it out on page load, so two users got the same number); the dockets are re-checked on the server — lying here, not
cancelled, booked on or before the loading date, not on another open sheet (the page dropped "Skipped Dockets" silently); a
loading date after today is refused; the manifest refuses dockets that are not on the sheet; dockets left unticked on a
loading-sheet manifest stay free (the page silently marked them cancelled on the sheet); parameterised SQL. **Not ported:**
unloading sheet (`Un_Loading_Sheet.aspx`), the loading / unloading sheet prints and the loading reports, and the docket-FY
change's loading-sheet stage.

**ODA Charge:** per location (picked branch → city → location, as on the page) the distance and the ODA charge for seven
weight bands (0–100, 101–200, 201–300, 301–400, 401–500, 501–1000, over 1000 kg) from an effective date after today. The
docket now has an **ODA location** field (locations of the destination city): picking it, or changing the charge weight,
fills the ODA charge from the rate in force (`usp_Get_OdaRate`). **Changes:** a new rate is a new version and the older ones
stay (the page switched them off at once, leaving the location without an ODA charge until the new, future, date); a past
or today's effective date and a second rate for the same location and date are refused (the page only showed a message);
a rate can be switched off / on. **Not ported:** the DIV1002 parcel ODA lookup (`Get_ODACharge` by origin location and
destination branch), the ODA distance / weight configuration masters (Setting/ODA_Master_And_Configuration).

**PRS / DRS rates:** for a vendor (type Vendor or Self, from the vendor master) the pay for a pickup (PRS) / delivery (DRS)
trip by FTL type (freight master) from an effective date: **Per Km** (rate per km), **Per Kg** (rate per kg) or **Round
Trip** (an amount for a fixed number of km plus a rate per extra km). Picking vendor and rate on shows the previous
effective date, as on the page. **Changes:** the boxes the page disabled for a rate-on are saved as 0 (a Round Trip left
Per Kg empty, so the page's `float.Parse` failed and nothing was saved, with no message); the effective date must be in the
login financial year (as on the page) and not in the past; the same vendor + rate on + FTL type + date is refused (the
page saved duplicates); the vendor must be of the picked type and in the user's division. The rate in force (latest
effective date on or before today per vendor, rate on and FTL type) is marked in the list. **Not ported yet:** the
PRS / DRS challan that reads these rates (Operation pages), the effective-date change on the Setting page.

**Vendor rates** (road / air / train, one page with three tabs): what we pay a vendor between two cities from an
effective date inside start / end dates of the login year. Road: FTL lump sum or FTL per km, per kg (PKG) or per km (PKM);
a co-loader per kg. Air: rate per kg with optional contiguous weight slabs for a vendor's flight and shift (flights from
Setting → Vendor and Vehicle); for Self the airline charges (up-to weight / charge, AWB/DO, FSC, unit, X-ray, TSP out / in
with minimums, service tax). Train: per kg or full-container trip cost plus the DD amount for one of the vendor's trains.
**Challan:** "Use vendor rate" fills the hire charge from the road rate in force from the branch city to the route's
destination branch city (or the destination city) — FTL amount, FTL / PKM rate × route km, or PKG rate × load weight.
**Changes:** a new rate is a new version (the road page refused any second active rate for the vendor and route, so a
rate changed only by deactivating the old one; air / train had no duplicate check) — the same vendor, route (mode /
flight + shift / train) and effective date is refused; effective date today or later; slabs must be contiguous; one
transaction per save; parameterised SQL. **Not ported:** the road page's route / vehicle-capacity fields (commented out on
the page), air-rate edit (the page's edit changed only vendor / shift / cities / up-to weight — a new version is used).

**Franchisee rates** (one page, two tabs). Commission master: a version per mode (Road / Train / Air) and effective date,
code FCM + 4 digits, with rent, mobile bill and signage per month and the commission on base freight; road rows per
booking type — LTL (% up to 3 tons, % for 3–6 tons), FTL 3–6 tons and 9–16 tons (vehicle type by capacity from the freight
master, commission per consignment, share %), FTL trailer (per vehicle, share %); train (% and per rail); air (%).
Pickup / delivery: per franchisee the pickup charge and the delivery commission per consignment, per document or per
weight band (up to 3 kg … above 100 kg), from an effective date. **Changes:** header and rows saved in one transaction
with the code numbered inside it (the page saved the header, then row by row); same mode + effective date refused (as on
the page); effective date today or later inside the login year. The pickup / delivery page was a copy of the loan page
(it said "Not successfully saved" on success, went to LoanDetails.aspx and swapped the document / weight-band columns in
its grid) — rewritten on the same table (FranchiseeCommissionMaster). **Not ported:** the franchisee commission invoice
that uses these rates (VFranchiseeCommissionInvoice — Invoice module).

**Settings** (the whole Setting folder, 16 pages, menu SETTING):
* **Bind destination to branch** — cities of a state a branch delivers, per division (Courier / Parcel / FTL flag).
  **Changes:** only the login division's flag can change (the page re-saved whatever the browser posted for the disabled
  columns); the branch's own city always stays bound; the save is one transaction.
* **Franchisee ↔ branch / ↔ client** — a branch can be bound to one franchisee at a time (refused on save; the page only
  warned on pick); a client to one franchisee at a time (the page inserted duplicates); bindings are switched on / off.
* **Change docket FY** — previous-year dockets still pending in a stage (booked, manifested, challan, arrived, DRS, DRS
  challan, unbilled) move to the login year. **Changes:** one transaction; parameters instead of concatenated docket
  numbers; the "DRS challan" step updated every row of Dispatch_Master (UPDATE … FROM without a join) — now only the
  DRS's challan; a challan's account entries move only when every ledger exists in the new year (the page cancelled the
  old entry even when the new one could not be written). **Not ported:** the loading-sheet stage.
* **Effective date change** (both pages in one) — pick client rates (Credit / Paid / To Pay) or PRS / DRS rates, give
  the new date. **Changes:** the date must lie between the contract's start and end (vendor: inside the FY) and may not
  clash with another version of the same rate; the second page's full contract edit is on the Client Contract page.
  **Not ported:** vendor road rates (waits for the Vendor Road Rate Master).
* **ODA master and configuration** — distance and weight bands, the rate per distance × weight from an effective date.
  **Changes:** bands may not overlap; one rate per distance + weight + effective date (the page allowed one per pair
  whatever the date). The DIV1002 docket lookup that reads it (`Get_ODACharge`) is not ported yet.
* **Shipper stock / issue** — head office receives docket-number series (shipper and gate-pass books), issues parts of a
  series to branches or franchisee branches (with a charge per shipper), and can move one unused number to another
  branch. **Changes:** overlaps are refused (numbers were compared as text in places); an issue must lie inside one
  received series of the same GRN type (the page warned "used in IBA LR" and saved anyway); the "lots of 50" rule is not
  ported (it only fired when the start equalled the latest stock's first number); a stock series can be deleted only
  while nothing is issued from it and edited only in its date / received-from; an issue can be deleted only while no
  number is used on a docket.
* **Special booking approval** — dockets booked with a discount are approved level by level: up to 10 % the branch
  manager is final; 11–20 % + area manager; 21–70 % + division head; above 70 % one more final approval. **Changes:**
  the next status is worked out on the server from the saved discount (the page used grid cells posted by the browser);
  a docket with discount 0 and special discount ≤ 10 % got no status and stayed pending — now final at the first
  approval. **Not ported:** blocking a docket that is not approved yet from manifest (the source does not show it).
* **Freight / THC margin approval** — challans of the login year whose truck-hire freight leaves less than the minimum
  margin % (set on the page, default 10 %) on the dockets' freight; approve, or reject = cancel the challan. **Changes:**
  one decision per challan (the legacy four levels BDM → AM → Head → GM have no rules in the source); a reject that
  cannot cancel the challan (arrived) is refused instead of leaving a live challan marked rejected.
* **Vendor and vehicle** — road trucks, flights and trains per vendor / own fleet. **Changes:** one transaction; the
  "added" list is the browser's own (the page kept it in a static field shared by every user of the server); truck /
  engine / chassis numbers checked against both vehicle tables.
* **MIS auto mail** — switch, mail times, back days, client e-mails with columns, header / footer, and a preview of a
  client's mail. **Not ported:** the sending itself — the page ran a timer inside the web server with a Yahoo SMTP account
  written in the code (password blanked in the last version, so nothing was sent). Sending needs an SMTP account in the
  server settings and a scheduled job.

79 of 614 pages are covered (see `page-inventory.csv`) — the Rate and Setting folders are complete. By module the
remaining work is roughly: Operation 156, Accounts 111, Report 76, HRM 56, Invoice 47, Master 20, Print 26, General 22,
Marketing 12, others ~20.

### Suggested order for the rest

1. **Remaining General masters** (22 pages) — mostly config in `server/src/modules/masters/definitions.js`.
2. **Master/** (Branch, Client, Employee, Vendor, Vehicle, Franchisee…) — larger forms; hand-built pages using the docket page as the pattern.
3. **Operation/** in process order: Pickup → Manifest / Challan → Arrival → DRS → Delivery → POD. Most "_View" and "_Cancel" pages are small and follow the docket modify/cancel pattern.
4. **Invoice/** and **Rate/** (client contract is the biggest single page, ~385 KB code-behind).
5. **Accounts/** and **HRM/**.
6. **Report/** + **Print/** — one report definition each (see "Reports" below). Print layouts (docket sticker, manifest, bill) need print-optimised React pages or server-side PDF.

## How the pieces fit

```
Browser (React)  ──JWT──▶  Express API  ──parameterised──▶  SQL Server (same DB, same SPs)
     │                          │
     └── shared/docketCalc.js ──┘   (identical calculation on both sides)
```

* **Menu stays in the database.** `MasterMenu / SubMenu / Sub_SubMenu` rows keep their `.aspx`
  URLs. `client/src/routes/legacyRoutes.js` maps each URL to a React route; unmapped URLs show
  a "not migrated yet" page. Converting a page = add its React route + one line in that map.
  No menu data changes, and the old app keeps working for unconverted pages.
* **Session → JWT.** Everything the pages read from `Session[...]` (user, role, division,
  financial year, home/current branch, city) is in the token (`req.user` on the server,
  `useAuth().user` in React). Changing branch re-issues the token.
* **Same stored procedures.** Services call the procedures the DAL called, with the same
  parameter names, in the same order, inside a transaction where the DAL used one.
* **Fleet DB mirroring.** Masters that the DAL wrote to `con.fleetconnection` too are mirrored
  when `FLEET_DB_NAME` is set (`mirrorFleet: true` in the definition). Failures are logged, as before.

## Converting a page — checklist

1. Read the `.aspx.cs` (and any `PageScript/*.js` it uses). List: the data it loads, the
   stored procedures / SQL it runs, validations, and messages shown with `alert(...)`.
2. **API** — create/extend a module in `server/src/modules/<area>/`:
   * `*.schema.js` — zod schema for the request (types, required fields, cross-field rules);
   * `*.service.js` — call the same procedures via `exec()`/`query()` (never concatenate
     values into SQL); wrap multi-step writes in `withTransaction()`; map result codes to
     `HttpError` with the legacy message text;
   * `*.routes.js` — REST routes with `requireAuth` / `requireRole`;
   * register the router in `server/src/app.js`.
3. **UI** — add a page under `client/src/pages/`, a route in `App.jsx`, and the legacy URL in
   `routes/legacyRoutes.js`.
4. **Tests** — add integration tests in `server/test/` (and stand-in procedures in
   `db/dev/*.sql` if you test against the dev DB).
5. Update `docs/page-inventory.csv`.

### Simple masters

Add an entry to `server/src/modules/masters/definitions.js` (fields, list SQL, the insert /
update / delete procedures, uniqueness and in-use rules). The generic `MasterPage` renders it;
then add the legacy URL → `/masters/<key>` line in `legacyRoutes.js`.

### Reports (Crystal Reports replacement)

Add an entry to `server/src/modules/reports/reports.service.js` with filters, columns
(`type: money|number|date`, `total: true`) and a `run()` that returns rows via a parameterised
query or the report's existing stored procedure. `ReportPage` provides the filter bar, sorting,
totals row, CSV and PDF export. For printed documents (dockets, manifests, bills) build a
dedicated print page instead.

## Conventions

* Dates on the wire are ISO `YYYY-MM-DD`; the UI displays `DD/MM/YYYY`.
* Legacy "NAME:CODE" values (branch, client) are kept where the procedures expect them;
  use `nameOf` / `codeOf` from `server/src/utils/legacy.js`.
* Errors: `{ error, details? }` with HTTP 400 (validation), 401, 403, 404, 409 (conflict /
  duplicate / in use), 422 (business rule from a procedure result code).
* Money is rounded to 2 decimals with `round2` from `shared/docketCalc.js`.
