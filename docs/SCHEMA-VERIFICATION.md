# To verify against the production database script

The pilot was built from the C# code only; the local dev DB (`server/db/dev/`) contains
**stand-in** procedures that mimic what the code expects. When the SSMS "Generate Scripts"
output (tables + stored procedures) is available, check these items — each is a place where
the legacy code was ambiguous.

## Parameter binding (most important)

The legacy `grn_class` SqlHelper (`ExecuteNonQuery(tran, spName, "OutPrams", params)`)
**discovers procedure parameters from the DB and assigns values by position**, ignoring the
names in C#. The new API binds **by name**. For each procedure below, confirm that the C#
parameter names match the procedure's declared names, and that output params are:

| Procedure | Outputs assumed | Notes |
|-----------|-----------------|-------|
| `Save_GrnEntry` | `@sln int` (result code), `@computeriseno varchar` (generated docket no) | result codes 0 / -1 / -2 / -3 / -4 / -11 mapped to legacy messages |
| `Update_GrnEntry_New` | `@sln int` | -3 / -4 |
| `Save_DocketCharges`, `Update_DocketCharges` | `@sln int` | -1 / -2 / -3 = ledger not found |
| `Cancel_GrnEntry` | legacy marked `@docketNo` as *output* and passed `@user ` (trailing space) | confirm actual signature |
| Master insert/update/delete (`usp_Insert_State_Master`, `Update_zone_master`, …) | `@retval int` | legacy passed it as input by mistake |

## Table-valued parameters

| Procedure | Parameter | Type name assumed | Columns sent |
|-----------|-----------|-------------------|--------------|
| `usp_insert_Manifest` | `@dtManifest_grn` | `dbo.udt_Manifest_grn` (set `TVP_MANIFEST_GRN` if different) | `docket_no, freight, package, weight` |
| `sp_insert_Dispatch_Master` | `@dtMainfest_no` | `dbo.udt_Mainfest_no` (`TVP_CHALLAN_MANIFEST`) | `mainfest_no` |
| `usp_insert_Pod_Dispatch` | `@dtPod_Dispatch_image` | `dbo.udt_Pod_Dispatch_image` (`TVP_POD_IMAGE`) | `ImagePath` |
| `usp_insert_DRS` | `@dtDrs_entry_details_grn` | `dbo.udt_Drs_entry_details_grn` (`TVP_DRS_GRN`) | see "DRS" below |
| `sp_insert_Arrival_Entry` | `@dtArrival_Entry` | `dbo.udt_Arrival_Entry` (`TVP_ARRIVAL_ENTRY`) | see "Arrival" below |
| `sp_insert_Dispatch_Master` | `@ud_Transaction_Details` | `dbo.ud_Transaction_Details` (`TVP_TRANSACTION`) | `Ledger_code, Amount_Dr, Amount_Cr, Balance, TransId, Entry, Mode` |

The C# code passed an untyped `DataTable`, so the real user-defined type name and column
types must be read from the schema script.

## Pickup / manifest

* `usp_insert_PickUpEntry` → `@retval` = generated pickup no.; `usp_insert_Manifest` → `@retval` (manifest no.) + `@retMsg` (`'success'` or an error).
* `usp_PickupEntry_Cancel`, `usp_Manifest_Cancel` → `@success` output (`'success'`).
* `usp_search_PickupEntry`, `usp_Select_Manifest_Entry` result columns (pickup_no/pickup_date/challan_no…, mainfest_no/mainfest_date/to_branch/challan_no…) and whether they return docket/package counts.
* `sp_GetDocketForManifest` result columns (`pending_package`, `pending_weight`, `pending_freight`, `destinationbranch`, …) and `grn_docket_charge.branch` (the branch where a docket currently lies).
* `Employee_Master.emptype = 'DC-116'` = pickup staff; `usp_Fill_BranchWise_Location[ByZone]` columns `Location_Code, Location_Name`.

## Challan (vehicle dispatch)

* `sp_insert_Dispatch_Master` → `@retval varchar(200)` = `'success'` or an error; ~80 inputs named as in
  `dispatch_master_dal.insert_Dispatch_Details`. Legacy passed `DateTime.MaxValue` for `@dispatch_date`
  (and for `@delaydate` when empty); the API passes NULL — confirm the procedure accepts it.
  `@total_price` holds the total **packages**; `@address` holds the driver's **mobile no.**
* `GET_AUTO_GENERATED_CODE_FOR_ENTRY(@prefix 'CTH', @ShortYear '2526', @branch_code, @Financial_Year, @retval)` —
  now called inside the save transaction; confirm it locks its counter (or the insert has a unique key).
* `usp_select_challan_entry_cancel` columns (`challan_no, challan_date, challan_time, mode_code, from_branch,
  tobcode, manifest_no, user_id`; the list also reads `truck_no, vendor_name, total_weight, total_price,
  total_freight, arrival_status` when present). `usp_Dispatch_Master_Cancel` → `@success`.
* Column names used directly: `mainfest_entry.freight_type / div_code / Dispatch_Status / challan_no / IsCancelled`,
  `Manifest_grn.Dispatch_Status / challan_no / div_code`, `dispatch_master.*` (as in the DAL),
  `Vechile_Master`, `vendors_master(TDS, vendor_type, vendor_Mode, DivCode, active_flag)`,
  `temp_vendors_master(vendor_mode, FTLDIVISION, TDS)`, `route / routedetail / Route_SetTime`,
  `Driver_master`, `Arrival_entry(challan_no, IsCancelled)`, `tblAccountLedger / tblAccountGroup / tblAccountTrasaction`.
* Ledgers the challan needs per division + financial year: the vendor's ledger (named as the vendor),
  `TRUCK HIRE CHARGE FOR SUNDRY|FTL`, `TDS PAYABLE`, and `CASH <branch name>` for own-fleet advances.

## Arrival

The arrival DAL source is older than `wwwroot/bin/ClassLibrary.dll` (June 2026). Names below were
read from the DLL's strings; parameters beyond the ones listed could not be recovered from it.

* `sp_insert_Arrival_Entry` — called once with a table-valued `@dtArrival_Entry` (type `dbo.udt_Arrival_Entry`,
  `TVP_ARRIVAL_ENTRY`; the API sends `docket_no, manifest_no, package, weight, freight` = received and
  `booked_package, booked_weight, booked_freight` = as manifested, `Remarks, IsExcessArrival`) plus the header
  parameters of `Arrival_dal.Insert_into_arrival` (`@challan_no … @ShortCode`, note legacy `"@inwardwt "` with a
  trailing space) and `@retval varchar(500)`. The API accepts `'success'` (then reads the new `ArrivalNo`) **or**
  the arrival number itself. **Confirm the real type and that the procedure does what the page did per docket:**
  insert `Arrival_Packg`, insert a `grn_docket_charge` row for the receiving branch (`pending_*` = received),
  `Manifest_grn.Arrival_status`, `grn_master.current_branch / Arrived_status`, `mainfest_entry.Arrived_status`,
  `Dispatch_Master.arrival_status`. If it does not, those statements must be added to it (inside its transaction).
* `@Manifest_no` carries the comma-separated manifests received (legacy passed `"0"`).
* `search_ArrivalEntry(@booking_date1, @booking_date2, @currbranch, @user_id, @IsCancelled, @challan_no, @Financial_Year, @division)`
  columns `ArrivalNo, challan_no, receive_date, user_id` (plus optional counts); `usp_Arrival_Cancel(@challan_no, @user_id,
  @Financial_Year, @branch_Code, @success)`.
* The newer DLL also has `sp_getChallanForArrival (@dest_type…)`, `sp_getManifestForArrival (@tobcode…)`,
  `sp_getDocketForArrival (@mainfest_no…)`; the API uses parameterised queries instead (`arrival.service.js`) —
  switch to those procedures once their signatures are known.
* `grn_docket_charge` holds one row per branch a docket has been at; the API reads the booking row with
  `isnull(branch, origin_branch) = origin_branch` (reports, pickup) and the current branch's row for manifests.
  Confirm the booking row's `branch` value in real data.

## DRS

* `usp_insert_DRS` — parameters as in `dal_drs_entry.Insert_into_drs_entry` (confirmed against the DLL);
  `@dtDrs_entry_details_grn` type assumed `dbo.udt_Drs_entry_details_grn` (`TVP_DRS_GRN`), columns from the page:
  `docket_no, freight, weight, packg, Location, pending_Package, pending_freight, pending_weight, challan_no`.
  `@Drs_no` is an **input** (the API generates `DS + ShortCode + FinYr + 6 digits` under a lock); `@retval varchar(20)` = `'success'`.
  The DLL's inline SQL shows what it must do per docket: insert `drs_entry_details_grn`, set
  `grn_docket_charge.drs_statusC/drs_noC` for the branch row, `grn_master.drs_status/drs_no`, `arrival_packg.drs_no/drs_status_entry`.
  Confirm it also reduces the branch row's pending packets for split DRS.
* `SEARCH_DOCKET_NO_FOR_DRS_ENTRY(@branch_code, @from_date, @to_date, @Financial_Year, @div_code)` — columns read:
  `docket_no, challan_no, Arrival_date, package, weight, freight, LocCode` (+ `Location_Name, consignee_name, Consigner_Name, booking_date, destination` when present).
* `usp_search_DrsEntry(… @DRSType 'MAIN' …)` returns one row per docket (`Drs_no, Drs_date, Drs_time, empcode, docket_no, packg, weight`);
  `usp_DRS_Cancel(@Drs_no, @user_id, @Financial_Year, @Branch_Code, @success)`. The DLL also has `uspDRSCancelatation(@DRSNo, @canceledBy)`.
* Note on reading `bin/ClassLibrary.dll`: its strings are UTF-16 at odd **and** even byte offsets — decode both
  (the first pass at arrival read only one half; the second half confirmed the per-branch `grn_docket_charge` rows).

## Delivery status

* `Insert_Delivery_status_entry_Details(@drs_no, @docket_no, @pkt_status, @rcv_date, @rcv_time, @rcvr_name, @rcvr_phone,
  @remarks, @UserId, @Division, @Financial_Year, @from_branch)` and `Insert_delivery_status_entry_grn(@drs_no, @docket_no,
  @total_freight, @total_weight, @toatal_packg, @from_branch, @Division, @Financial_Year)` — no outputs; now called inside
  one transaction together with the page's inline updates (`grn_docket_charge.drs_status_entry`, `arrival_packg.Drs_delivery_status`,
  `grn_master.drs_status`, `drs_entry_details_grn/drs_entry_details.Drs_delivery_status_Entry`, `grn_docket_charge.drs_statusC = NULL`
  for UNDELIVERED) — restricted to the current branch's rows.
* **Confirm how an UNDELIVERED docket becomes available for a new DRS** in the real data: the legacy page only reset
  `drs_statusC`; the dev stand-in puts the DRS packets back on the branch row's `pending_*` inside `Insert_Delivery_status_entry_Details`.
* `GET_GODOWN_DELIVERY_DOCKETS_IN_DRS_STATUS_ENTRY(@Division, @current_branch, @Financial_Year)` — columns read
  `docket_no, packg, weight, freight, Arrival_date, booking_date, consigner, consignee` (names beyond `docket_no` are guesses).
* `CREATE_AUTO_CLIENT_BILL_AND_FINALIZE(@Financial_Year, @branch_code, @ShortYear, @docket_no, @user_id)`;
  `usp_search_DeliveryEntry(@booking_date1, @booking_date2, @currbranch, @IsCancelled, @Drs_no, @user_id, @Financial_Year, @Division)`
  (one row per docket: `drs_no, docket_no, pkt_status, rcv_date, rcv_time, rcvr_name, user_id`);
  `usp_Delivery_Status_Cancel(@Drs_no, @user_id, @Financial_Year, @branch_Code, @success)`; `Drs_status_reason(status_reason)`;
  POD check reads `pod_dispatch(docket_no, IsCancelled)`.

## POD dispatch

* `usp_insert_Pod_Dispatch(@IOM_number, @branch_code (sent to), @docket_no, @Iom_date, @reamrks, @ImagePath, @From_Branch,
  @user_id, @division, @Fin_year, @dtPod_Dispatch_image, @retval varchar(20))` — `@retval = '0'` treated as failure (legacy `str != "0"`).
  `@dtPod_Dispatch_image` type assumed `dbo.udt_Pod_Dispatch_image` (`TVP_POD_IMAGE`), one column `ImagePath`; confirm the
  image table the procedure writes to (dev: `pod_dispatch_image(IOM_number, docket_no, ImagePath)`) — the view reads it.
* IOM no.: legacy `Generate_Autocode("pod_dispatch", "P", "IOM_Number", "100000")` → `P` + (max + 1), now under a lock in the save transaction.
* `CHECK_DOCKET_NO_ELIGIBLE_FOR_POD_DISPATCH(@docket_no, @branch_code, @div_code)` → column `pod_generated_status` ('1' = already made);
  empty result = wrong branch / division. The DLL also passes `@PODType` in a newer overload (direct POD).
* `usp_search_POD_Dispatch_Entry(@booking_date1, @booking_date2, @currbranch, @IsCancelled, @IOM_number, @user_id, @Financial_Year, @division)`
  one row per docket (`IOM_number, Iom_date, docket_no, branch_code …`). Cancel uses the soft `usp_POD_Dispatch_Cancel(@IOM_number,
  @user_id, @Financial_Year, @success)` instead of the page's `sp_Delete_Pod_Cancel` — confirm it clears `grn_docket_charge.pod_dispatch / IOM_num`.
* Courier check reads `POD_Dispatch_D(IOM_No, Doc_No, IsCancelled)`.

## POD courier to head office / POD receive

* `usp_insert_Pod_Dispatch_H(@Doc_Cat, @Doc_No, @Doc_Dt, @Ent_Dt, @Branch_Code, @MODE, @PName, @CCode, @USER_ID, @Courier_Type,
  @financial_year, @division, @retval varchar(20))` — the API passes `@Doc_No = ''` and uses `@retval` as the document no.
  (the page did the same with the value it got back). **Confirm the procedure generates the number** when `@Doc_No` is empty.
* Inline statements kept from the DAL: `update pod_dispatch set Dispatch='y'`, `insert into POD_Dispatch_D(Doc_Cat, Doc_No, Doc_Dt,
  IOM_No, MODE, PName, CCode, AWBill_No, Financial_Year, division)`, `update grn_master set PODDispatch_status, IOM_number`,
  `update grn_docket_charge set PODRCV_status`, `update POD_Dispatch_D set Ho_Receive = 1` (now only when all the IOM's dockets are in),
  plus a new `update POD_Dispatch_H set Receive_Status = 1` when all IOMs are in (the legacy page did this in a commented-out routine).
* `GET_POD_DISPATCH_LIST_BY_COURIER_FOR_VIEW_CANCEL(@Financial_Year, @Branch_code, @division)`, `CHECK_WHEN_POD_ALREADY_RECEIVED(@doc_no)`,
  `CANCEL_POD_DISPATCH_BY_COUREIR(@Doc_No, @Cancel_By)` (success = rows affected), `search_Doc_no_Datewise(@booking_date1, @booking_date2, @Divcode)`,
  `search_pod_on_the_basis_of_pod_number_After_Courier(@Doc_No, @DivCode)` (columns `docket_no, IOM_number, Iom_date, PODDispatch_status, pcs,
  charge_weight, freight`), `GET_DOC_NO_BY_DOCKET_NO_FOR_POD_RECEIVE(@docket_no)` (`Doc_No`), `Insert_Pod_Received(...)`,
  `usp_search_POD_Receive_Entry(...)`, `usp_POD_Receive_Cancel(@Doc_No, @user_id, @Financial_Year, @DivCode, @success)` — used instead of the
  page's hard-delete `sp_Delete_Pod_Receive_Cencel`. Result-set column names of the list procedures are guesses; confirm them.

## Branch master

* `sp_insert_Branch_master_details(@branchid, @branch_code, @branch_name, @contactperson, @address, @state_code, @city_code, @zone_code,
  @email, @phone, @fax, @remarks, @Ishub, @status, @Company, @ControllingBranch, @IsWarehouse, @IsFranchisee, @User_ID, @LastUpdate,
  @Branch_Gstin_no, @location, @ShortCode, @SapCode, @ManualCode, @primary_address, @place, @maxlimit, @Division, @isDocketAutoInc,
  @retval int output)` — success = `@retval = 1`. **`@IsWarehouse` carries the "master franchisee" tick** (the page's naming); confirm.
* `sp_Update_Branch_Master_Details(...)` — same values with `@Edit_By, @Edit_Date, @Branch_Gstin_No, @Short_Code` instead of the insert-only
  ones; no result is checked (the page didn't either). `sp_Delete_Branch_Master_Details(@branch_code, @retval output)` — success = `@retval > 0`.
* `sp_select_Branch_Master_Details_WithDivision(@division)` — columns `branch_code, branch_name, short_code, contact_person, address, place,
  state_code, state_name, city_code, city_name, zone_code, location, Location_Name, email, phone, fax, remarks, Branch_Gstin_no, company, CName,
  ControllingBranch, ControllingBrnachName, SapCode, Manual_code, maxlimit, Division, status, IsHub, IsMasterFranchisee, IsFranchisee,
  isDocketAutoInc`. Names follow the page's grid bindings; confirm against the real procedure.
* `usp_AutoBindLedger(@LedgerName, @GroupName, @VendorOrClientCode, @DrCr, @Ledger_Type, @CreatedDate, @Branch_Code, @Emp_Code,
  @Financial_Year, @division, @status varchar(500) output)` — success = `@status = 'success'`. Four ledgers per ticked division, names and
  groups as `GeneralMethods.AutoBindLedger` built them (`CASH <NAME>` / Cash In Hand, `TOPAY RECOVERY :<NAME> :<CODE>`,
  `PAID RECOVERY :<NAME> :<CODE>`, `<NAME> :<CODE>` / Branch / Divisions). Created date = 1 April of the financial year.
* Branch code = `B` + (highest numeric `B…` code + 1), minimum `B1001`, read under `updlock, holdlock` (the page's `get_id`).
* Inline lookups: `New_Location_master(Location_Code, Location_Name, City_Code, Pin_Code, IsActinve_Flag)` (the column really is
  spelled `IsActinve_Flag` in the page's SQL), `branch_master.location`, `state_master.Gstin_No`, `CompanyMster(CCode, CName)`.
* Delete in-use checks read `grn_master(origin_branch, destination_branch)`, `employee_master.branch`, `branch_master.ControllingBranch`,
  `mainfest_entry(from_branch, to_branch)`, `dispatch_master(from_branch, tobcode)`, `Pick_up_entry.from_branch`,
  `route(from_route_code, To_Route_Code)` — a table missing from the database is skipped.

## Vendor master

There is **no `vendor_master_dal.cs` in the ClassLibrary source**; names come from the deployed DLL, parameter names are guesses
from the page's `vendor_master_pal` properties and the DLL's own SELECTs. Confirm all of these:

* `insert_Vendor_Master(@vendor_code, @name, @vendor_type, @vendor_Mode, @Branch, @address, @state, @vendor_city, @pin_code,
  @ContactPrsnName, @pan_no, @email, @service_tax_no, @vendor_phone_no, @approvalDate, @Fax, @ApprovBy, @ConfLetterNo, @remarks, @TDS,
  @sap_code, @manual_code, @DivCode, @CourDiv, @PrclDiv, @FTLDiv, @Gstin_No, @AutoGstStatus, @IsFastTag, @IFCCode, @AccountNo,
  @active_flag, @IsCoLoader, @created_by, @retval varchar output)` — success = `@retval` holds the vendor code (the page did the same).
* `sp_Update_Vendor_Master_Details(...)` — the edit popup's fields only; PIN / PAN / e-mail / fax / letter / remarks are then
  written with an inline `update vendors_master` in the same transaction. `sp_Delete_Vendor_Master(@vendor_code)`.
* `usp_select_vendors_masterALL(@DivCode)` — grid columns `vendor_code, name, vendor_type, mode_name, vendor_phone_no, branch_name,
  ContactPrsnName, approvedDate, ApprovBy, Status, TDS, Gstin_No, IsFastTag, IFCCode, AccountNo, DivCode, CourDiv, PrclDiv, FTLDiv,
  sap_code, manual_no, address, state_name, city_name` (plus `Branch` used for filtering).
* `usp_CheckValidateGstinNo(@Gstin_No, @retval output)` — `@retval` = the GSTIN when it already exists (any party).
* `sp_select_Mode_Master` → `slno, mode_code, mode_name`. `vendor_Mode` stores codes comma-separated in this order; the challan
  vendor lookup matches `vendor_Mode like 'RD%'`.
* `vendor_type` is stored upper-case (`VENDOR`, `SELF`, `COLOADER`) as the page did; the challan lookup relies on a
  case-insensitive collation to match `Vendor` / `Self`.
* Vendor ledger: `usp_AutoBindLedger` with `NAME :CODE :BRANCH NAME :BRANCH CODE`, group `Sundry Creditors`, `Cr`, type `Vendor`,
  `@VendorOrClientCode` = the code (the page split it out of the name, with a trailing space).

## Vehicle master

No DAL source either (`ClassLibrary.Master_Modules.Vechile_Master` is only in the DLL). Confirm:

* `usp_Insert_Vechile(@VEHICLE_NO, @Vechile_Type_Code, @CHASSIS_NO, @ENGINE_NO, @MAKE, @MODEL, @Vechile_Capacity, @ContainerSize,
  @Vechile_Status, @Created_By, @Created_Branch, @Home_Branch, @VehicelType, @VenderType, @OwnerName, @VendorCodeName,
  @veh_route … @veh_route_9, @tank_capacity, @VehicleName_id_fk, @fuel_type, @division, @Financial_Year,
  @ud_Transaction_Details (table type of config.tvp.transaction), @DealerName, @Address, @Date_Of_Purchase, @InvoiceNo,
  @InvoiceValue, @DealMaturityAmount, @NameofFinancer, @LoanAccNoChassis, @LoanChassisAmount, @LoanAccNoBody, @LoanBodyAmount,
  @LoanStartDate, @LoanEndDate, @CoverNoteNo, @PolicyNo, @ReceiptDate, @InsStartDate, @InsEndDate, @NameofInsuranceNo,
  @HypothecatedWith, @Narration, @AMC, @ReturnValue varchar output)` — success = `@ReturnValue = 'success'`. The names come
  from the DLL's strings; `@VehicelType`, `@VenderType`, `@division`, `@Financial_Year`, `@Address` and `@Date_Of_Purchase`
  are inferred from the page's properties. The new app passes an **empty** transaction table (no purchase voucher).
* `usp_Update_Vechile(...)` — the same vehicle fields with `@Create_Branch` (sic) instead of created / home branch; no result
  checked (the page ignored it too). Dealer / invoice / AMC fields are then written with an inline `update Vechile_Master`.
* Columns read: `Vechile_Master(VEHICLE_NO, VendorCodeName, VenderType, OwnerName, VehicelType, Vechile_Type_Code,
  Vechile_Capacity, ContainerSize, CHASSIS_NO, ENGINE_NO, MAKE, MODEL, VehicleName_id_fk, fuel_type, tank_capacity, AMC,
  Created_Branch, currentloc, veh_route … veh_route_9, DealerName, Address, Date_Of_Purchase, InvoiceNo, InvoiceValue,
  DealMaturityAmount, Vechile_Status ('Active' / 'InActive'), division)`, `freight_master(container_code, freight_name,
  container_Capacity, ContainerSize, Container_Type, Bodys, VehicleMode, NoOfWheel, active_flag)`,
  `Vehicle_master(slno, vehicle_name, active_flag)` (makers), `route(route_code, route_name, isStatus)`.
* The list uses an inline SELECT (the page's `View_VechileInfo_New` procedure name is not in the DLL strings).
* Vehicle ledger: `usp_AutoBindLedger` with the vehicle number as the name, group `Direct Expense`, `DR`, and — as the page
  passed it — Ledger_Type **`Bank`** (looks like a legacy copy-paste; confirm whether any report depends on it).

## Client master

No `Client_Master_Dal` source; names from the DLL, parameters from `Client_Master_Pal` and the DLL strings. Confirm:

* `insert_Client_Master_Details(@client_code, @company_name, @contact_person, @address, @city, @place, @pin_code, @email, @phone,
  @fax, @pan_no, @service_tax_no, @intro_date, @is_Active, @credit_period, @is_tax_notapplicable, @remarks, @Client_Name,
  @IsThirdPartyBilling, @Mobile, @Tin, @Branch_Code, @billed_ledger_name, @unbilled_ledger_name, @created_by, @IsWalkingClient,
  @Billing_Cycle, @Gstin_No, @AutoGstStatus, @BillingLocation, @SubmissionLocation, @CollectionLocation, @CustType, @RegUnreg, @RegNo,
  @PlaceofSupply, @PO_No, @PO_Date, @CIN_No, @Division, @divcourier, @divparcel, @divftl, @billing_address, @billing_client_name,
  @billing_client_phone, @billing_client_gstin, @Credit_Type, @IsPs, @Trans_no, @ShowKMOnPrint, @nature_of_business_id, @IsDiscount,
  @IsGstReg, @print_as, @Contract_By, @under_client, @sap_code, @manual_code)` — the page treated "rows affected > 0" as success;
  the new app instead re-reads the row by code (works whether or not the procedure sets NOCOUNT).
* `sp_Update_Client_Master(@client_Id, @clinet_code (sic), …, @Tin_Number, @billed_code, @unbilled_code, …)` — PO date and customer
  type are then written with an inline `update client_Master`. `delete_Client_Master_With_Details(@client_Id)`.
* `GET_NATURE_OF_BUSINESS_MASTER` → `ID, nob_name`. Contract-by list: `Employee_Master(empcode, empname, IsActive)`.
* Columns read: `client_Master(client_Id, client_code, client_name (= Client_Name), company_name, …)` — the list is an inline SELECT
  (the page's `sp_select_Client_Master_Details` / `SelectUniqeClients` parameters were not traced); `PlaceofSupply` stores the item
  text (`INTRASTATE` / `INTERSTATE`), `IsPs` `Yes` / `No`, `Credit_Type` `Consigner` / `Consignee`, `CustType` 0 GTA / 1 Courier.
* Ledgers: `usp_AutoBindLedger` with `NAME :CODE:BRANCH NAME:BRANCH CODE :BILLED` and `… :UNBILLED`, group `Sundry Debtors`, `DR`,
  type `CLIENT`, `@VendorOrClientCode` = the code. `Save_DocketCharges` (-1 "ledger not found") presumably looks these up — confirm.
* Delete in-use checks: `grn_master.on_account_of` (`NAME:CODE`), `client_rate.client_code`, `ClientLogin_Users.user_id`,
  `client_Master.Under_client`, ledger transactions.

## Employee master

No `Employee_Master_Dal` source; names from the DLL, parameters from `Employee_Master_Pal` and the DLL strings. Confirm:

* `usp_insert_Employee_Master(@empcode, @empname, @emptype, @branch, @depart, @compname, @PresentCity, @PermanentCity, @vc_Type,
  @vc_Guardian_Type, @vc_Guardian_Name, @IsAuthorized, @telephoneno, @presentaddress, @permanentaddress, @dateofjoining, @pincode,
  @mobileno, @EmailId, @PermanentPinCode, @vc_Religion, @vc_Maritial_Status, @vc_Category, @vc_Nationality, @vc_Blood_Group,
  @vc_Ret_Name1…4, @vc_Ret_Address1…4, @vc_Relation_Name1…4, @vc_Mobile1…4, @vc_Gender, @dt_DOB_Date, @dt_WithEff_Date,
  @vc_Highest_Qualification, @dt_Leaving_Date, @fl_Total_Exp, @vc_PAN_No, @vc_Passport_No, @vc_Joining_Type, @vc_Location_Code,
  @vc_Report_To, @vc_Previous_CompanyName, @vc_CompanyAddress, @vc_CompanyPhone, @vc_Emp_Photo, @vc_Emp_Document, @IsActive,
  @User_Id, @isPF, @isESI, @isPTax, @isLWF, @isCost_visible, @Division, @sap_code, @manual_no, @emid output)` — the page used
  the returned string (`@emid`, name from the DLL) as the saved code. **Does it also create the `users` login row?**
* `usp_Update_Employee_Master(...)` — same values with `@Edit_By` (the DLL also has an older `sp_Update_Employee_Master`).
  Delete is the page's inline `delete from Employee_Master where empid=@empid`.
* Lookups: `sp_select_emp_type` / `emp_type_master(emp_type_code, emp_type_name, desig_status)`, `sp_Fill_Employee`,
  `getBindLocationFromBranch(@branch_code)` → `Location_Code, Location_Name` (parameter name guessed),
  `HeadOfficeDepartmentMaster(DepartmentCode, DepartmentName)`, `CompanyMster(CCode, CName)`.
* Ledger: `usp_AutoBindLedger` with `NAME:CODE:BRANCH NAME:BRANCH CODE` (no spaces), group `Salary Expenses`, `DR`, type `EMPLOYEE`,
  `@VendorOrClientCode` = the code. The real `tblAccountLedger` also has an `Emp_Code` column — check which one the legacy
  procedure filled for employees.
* Stored values: `vc_Type` OnRole / OffRole, `vc_Joining_Type` 0 / 1, `vc_Maritial_Status` 1 married / 0, `IsActive` bit,
  `EmailId` upper-case (as the page stored it; shown lower-case).

## User master (staff logins)

* Insert (inline, legacy procedure name not found): `users(user_id, user_password, user_type, user_emp_type, user_branch,
  user_status, user_created_date)` — the page's `users_pal` also had `branch_name`; `user_type` / `user_emp_type` were saved
  empty by the page, the new app writes `employee` / `Employee` (only `Franchisee` / `Master Franchisee` change the login role).
* Update / delete are the page's own statements: `update users set user_status=…, user_password=… where user_id=…`
  (the new app only replaces the password when a new one is typed) and `delete from users where user_id=@user_id`.
* `user_branch` = comma-separated `branch_master.branchid` values, first = home branch (as `sp_select_login_160219` reads it).
* **Confirm** whether the real `sp_select_login_160219` returns `user_status` (the new app refuses `Inactive` only when it does)
  and whether it filters on `users.DivCode`.

## Client contract (City To City)

* The page inserted with inline SQL (`insert into client_contract_city(billingat, origin_city, destination_city, mode_id, rate_on, rate,
  state, fov, oda, dly, frt, start_date, … risk_charge, handling_charge, Service_charge, ocs, client_code, ftl_type, FtlRate,
  halthing_charge, minchargebox, VolumetricWeight, Expected_Days, minFreight, … totaldistance, perkmperkg_rate, Min_Collection_Charge,
  Min_Delivery_Charge, Hike, Discount, LoadType, FuleCharge, ocr, col_charge_IsPerBox, del_charge_IsPerBox, notification_days,
  hamali_charge)`). The DLL only holds these pieces; the middle part (`end_date, effective_from, status, client_id, delivery_mode,
  contract_type, minchargewt, sour_charge, collection_charge, logistic_charge, dod, … EntRef, RateType, BookingType, DocsType,
  Division, discount_type, LoadingCharge…InvoiceValueMax, FovFlatRate, TopayCharge, User_Id`) is reconstructed from
  `client_contract_branch_pal` — **confirm every column name** against the real table.
* `EntRef` = `RMEC-` + (max + 1, from 100001); the page's update is `Update_client_contract_city` (procedure, parameters not traced —
  the new app updates with inline SQL: amounts, charges, end date, status, notification days).
* `client_id` holds the client code (the page split it from "NAME:CODE"). `contract_type` = `City To City`; `status` Active / Deactive;
  `DocsType` 1 = document, 2 = non-document; `discount_type` P (percent) as the DIV1001 default.
* **Location / State / Zone** (stage 2): `client_contract_location(origin_location, destination_location)` with `EntRef` `RMEL-`,
  `client_contract_State(origin_State, destination_State)` — **no EntRef prefix for states is in the DLL; the new app uses `RMES-`**,
  confirm — and `client_contract_zone(origin_zone, destination_zone)` with `RMEZ-`. The page's zone INSERT also names `Load` and
  `topaycharge` (lower-case) columns; the dev tables copy `client_contract_city`'s columns — confirm the real zone table. Codes stored:
  `New_Location_master.Location_Code`, `state_master.state_code`, `zone_master.zone_code`. Updates use inline SQL (the page called
  `Update_client_contract_Location` / `_State` / `_Zone`, parameters not traced).
* **Rate lookup:** the real `Get_BillingAt` / `sp_Select_Rate` are used unchanged; confirm that they read `client_contract_city` by
  origin *city* (the booking branch's city) and destination *city name*, and how they pick among versions (the dev stand-in: latest
  `effective_from` ≤ booking date inside start / end, status Active). The result column `DisPrc` is mapped from `Discount` in dev.
  With all four types the dev stand-in prefers location (when `@OLocation` / `@DLocation` are sent), then city, state (the booking
  branch's state → the destination city's state), zone — **confirm the real order and whether `@OLocation` / `@DLocation` are
  location codes**.
* **Weight slabs** (stage 3): `ClientRate_With_Slab` columns are from the page's inline INSERT in the DLL (`billingat, origin_city,
  destination_city, mode_id, rate_on, client_id, contract_type, WeightFrom1..10, WeightTo1..10, Rate1..10, DisPrc1..10,
  ApproveDiscPrc1..10, RateType, EntRef, delivery_mode`) plus `Status` (from the page's `update clientrate_with_slab set Status`).
  The page wrote the **latest contract EntRef** into the slab row (its `select max(…EntRef…)` without +1); the new app writes the
  EntRef of the row it just saved, in the same transaction. `origin_city` / `destination_city` hold the row's codes for every
  contract type (as the page did). Column types (decimal) are guessed. Editing a slab replaces that EntRef's slab row (the page
  had no slab edit) — **confirm nothing else reads old slab rows**.
* The docket lookups are the real procedures `usp_Get_OnAccountSlabRateWeight_Curier`, `usp_Get_OnAccountSlabDiscountWeight_Curier`
  and `usp_Get_OnAccountSlabApprovedDiscountWeight_Curier` with OperationDAL's parameters (`@origin, @destination, @mode_id,
  @ClientCode, @Weight, @CustomerType, @BookingDate, @BookingType, @OLocation, @DLocation, @DivCode, @DocType, @Rateon`), value in
  column `rate`. `@origin` is sent as the booking branch's **city code** and `@destination` as the destination **city name** (the
  page sent `ddlBindCity` / `txtdestination`) — **confirm**. Their bodies are not in the source: the dev stand-ins
  (`20-contract-slab.sql`) take the contract row `sp_Select_Rate` would take and the first band with `from ≤ weight ≤ to`.
* **Category slabs** (stage 3): `ClientRate_Category_Slab` has the weight-slab columns plus `Item_code1..10, RateMed1..10,
  RateSmall1..10` (the page's inline INSERT). Read as `RateN` = BIG, `RateMedN` = MEDIUM, `RateSmallN` = SMALL (the page's
  `txtCatRateN` / `txtCatMedRateN` / `txtCatSmallRateN` beside `ddlCatProdN`, products from `item_master`) — **confirm**. The page
  chained the bands (`WeightFrom(n+1)` = `WeightTo(n)`, so a boundary weight is in two bands); the new app refuses overlapping
  bands of one product. `Status` is assumed like `ClientRate_With_Slab` (the page had no status update for this table) and
  `DisPrcN` / `ApproveDiscPrcN` are written as 0.
* The docket lookup `usp_Get_OnAccountSlabRateWeight_Category` takes the slab-rate parameters plus `@PkgSize` (BIG / MEDIUM /
  SMALL, the docket's `ddlPkgSize`) and `@Item_code` (the docket's type of packages, `ddlTypeofPkgs`); value in column `rate`.
  Body not in the source; the dev stand-in (`21-contract-category.sql`) takes the contract row with rate on CATEGORY that
  `sp_Select_Rate` would take, then the band of that product holding the weight, and the rate of the package size.
* **Paid / To Pay general rates** (stage 3): rows of the four contract tables with `RateType` = `BookingType` = 'Paid' /
  'To Pay' and `client_id` = `client_code` = `billingat` = '' (the page's btnRateAdd). A General Client docket calls the same
  `sp_Select_Rate` (GetRate → GetOnAccountRate) with `@customer_type` 'General Client', `@Booking_Type` = the general booking
  type and no client. **How the real `sp_Select_Rate` (and the slab lookups) choose the general rows is not in the source**; the
  dev stand-ins (`23-contract-general.sql`) take rows with no client and `RateType` = booking type for a General Client, and the
  client's own rows (any RateType) for a contractual client — **confirm**. The docket's `DocumentType` is not used by the
  stand-in when choosing a row.
* **KM rates** (stage 3): the per-km rate is written to `rate` (the docket computes rate × distance) and to the per-km column
  — `perkmperkg_rate` on the city / location / zone tables, **`PerKMRate` on `client_contract_State`** (the page's State INSERT /
  UPDATE; the dev table's column was renamed to match) — and the distance to `totaldistance` (varchar in dev). Distances:
  `Distance_Master(from_city_code, to_city_code, distance, distance_status)` and
  `Distance_Location_Master(from_Location_code, to_Location_code, distance, distance_status)` — the page's queries; other columns
  of the dev tables are guesses. **Docket:** the page filled the docket's distance from the rate result's **`DisPrc`**
  (`BindRateOnftl`: `txtDistance = RateDetails[0].DiscRate`, which OperationDAL reads from `DisPrc`) — so the real
  `sp_Select_Rate` may return the distance in `DisPrc` for KM rates. The new app reads `totaldistance` when the procedure returns
  it (the dev stand-in does) and falls back to `DisPrc` — **confirm with the real procedure**.
* **CARGO per-km weight rates** (stage 3): `basefrt`, `admincharge`, `adminchrgper` written on `client_contract_city` only (the
  page's City INSERT: `round(@admincharge,2), round(@adminchrgper,2), round(@basefrt,2)`), the rate per km per kg in
  `perkmperkg_rate` (`cast(@perkmperkg_rate as decimal(18,5))`), the distance in `totaldistance`. The per-box flags go to
  `col_charge_IsPerBox` / `del_charge_IsPerBox` (bit in dev). `sp_Select_Rate` returns `IsCollection` / `IsDelivery` — the
  dev stand-in returns 0; whether the real one maps the per-box flags there is not known (the docket did not use them).
* **Pickup / delivery charge slabs** (stage 3): `Min_chargeRate_slab(client_code, origin_city, destination_city, rate_on, FromUnit,
  ToUnit, ChargeAmt, Rate_type, EntRef, isactive)` — names from the page's DataTable and the DLL's
  `update Min_chargeRate_slab set isactive=0 where client_code … rate_on`; column types guessed. Saved with
  `sp_insMin_chargeRate_slab @client_code, @origin_city, @destination_city, @rate_on, @FromUnit, @ToUnit, @ChargeAmt, @Rate_type
  (PICKUP / DEL), @EntRef`. The page put the text boxes' "NAME:CODE" values in the DataTable (`insPicDelCharge` presumably split
  them — **confirm codes are stored**) and never filled EntRef; the new app stores the codes and the rate's EntRef. The page ran
  the `isactive = 0` update without `Rate_type` (saving delivery slabs may have switched pickup slabs off); the new app switches
  off only the kind being saved — **confirm**. `get_Min_chargeRate_slab_PICKUP` / `_delivery` (page view) are not used: the new
  app reads the active rows with inline SQL.
* The docket reads them with `sp_GetMinChargeRate @client_code, @origin_city, @destination_city, @rate_on, @Rate_Type,
  @delivery_mode, @Unit` (OperationDAL.Get_MinChargeRate), result columns `client_code`, `MinChargeAmt`. `@origin_city` = booking
  branch city code, `@destination_city` = destination **city name** (the page's `txtdestination`), `@Unit` = charge weight on WEIGHT,
  packets on BOX — **confirm**. Body not in the source; the dev stand-in (`22-contract-charge-slab.sql`) returns the active band
  holding the unit and ignores `@delivery_mode`.

## General Rate Master

* Tables `GenaraleRate_Master_City` (spelled so in the DLL), `General_Rate_location`, `General_Rate_State`, `General_Rate_zone`
  (general_rate_master_dal inline INSERTs). Only fragments of the column lists are in the DLL (origin / destination, mode_id,
  rate_on, rate, state, fov, oda, dly, frt, start / end dates, … risk_charge, handling_charge, Service_charge, ocs, ftl_type,
  FtlRate, halthing_charge, minchargebox, VolumetricWeight, minFreight, topaycharge, totaldistance, perkmperkg_rate /
  PerKMRate, Min_Delivery_Charge, Min_Collection_Charge). The new app writes the same column set as the client contract tables
  (client_id / client_code / billingat = '', RateType / BookingType = 'Credit', DocsType, Division, EntRef, …) — the dev tables
  are copies of the client contract tables; **confirm every column against the real tables** (in particular whether they have
  RateType, DocsType, Division, EntRef, notification_days, the per-box and admin columns).
* EntRef: RMEC- / RMEL- / RMES- / RMEZ- + max + 1 per general table (the DLL's `select … max(… replace(EntRef, 'RMEC-', '') …) FROM
  GenaraleRate_Master_City`; its zone query reads `RMEC-` from General_Rate_zone in one place and `RMEZ-` in another — the new
  app uses RMEZ-). The series overlap the client contract ones, so the slab tables (keyed by EntRef) are never touched for
  general rates.
* The page checked for an existing rate (`compcity` etc.) and then called `updcity` / `UpdRecordStatusGR` (body not traced) before
  inserting; the new app keeps versions like the client contract (a new effective date = a new row, the same key and date is
  refused) — **confirm what UpdRecordStatusGR did** (it may have switched older versions off).
* `General_Rate_With_Slab`: the DLL INSERT names origin_city, destination_city, mode_id, rate_on, contract_type and the 10
  bands (WeightFromN / WeightToN / RateN / DisPrcN / ApproveDiscPrcN); the Client Contract page read it `WHERE origin_city …
  mode_id … rate_on … RateType … contract_type … EntRef`, so RateType and EntRef exist. The new app also writes billingat,
  client_id, delivery_mode and Status (as for ClientRate_With_Slab; dev table copied from it) — **confirm those columns**.
* "Copy from general rate": the page's CompToGRM_City / _Location / _State / _Zone (bodies not traced; parameters: from, to,
  rate type, status, mode, rate on, contract type, division, delivery mode, document type). The new app reads the active
  general rate in force today for the route, mode, rate on, delivery mode, FTL type, document type and division.

## ODA Charge

* `ODA_Charge(ODA_Code, Branch_Code, City_Code, Location_Code, Zone_Code, Distance, Till_1H_Kg, Till_2H_Kg, Till_3H_Kg,
  Till_4H_Kg, Till_5H_Kg, Till_1T_Kg, Above_1T_Kg, Effective_Date, …, Status)` — the columns in the DLL's INSERT, and `od.status=1`
  in its select. The dev table adds an identity `ID`, `Login_User` and `Created_Date`; **confirm the key and the user column**.
  Band meaning (0–100, 101–200 … over 1000 kg) is from the page's text boxes (txt_0_T0_100_Kg …); the charge is taken as a flat
  amount per docket (the docket put it straight into the ODA box) — **confirm it is not per kg**.
* ODA code: the page used `Generate_Autocode("ODA_Charge", "ODC", "ODA_Code", "1", "ID")` (format not traced); the new app writes
  ODC + a 4-digit number (ODC0001 …).
* Cities of a branch: `city_master.BindTo = branch` (the page's Select_City); the new app also allows the branch's own city (BindTo
  is empty in the dev data) — **confirm**.
* Docket: `usp_Get_OdaRate @LocationCode, @Weight` → `odaRate` (OperationDAL.Get_OdaRate); body not in the source. The dev stand-in
  takes the active rate with the latest effective date on or before today and the band holding the weight. The DIV1002 lookup
  `Get_ODACharge @LocationFrom, @DestinationBranch, @Weight` is not used yet.

## PRS / DRS Rate Master

* `PRS_DRS_RATE_MASTER(Slno, Vendor_Type, Vendor_Code, Rate_On, Fix_Km, Fix_Km_Rate, Extra_Km_Rate, Effective_Date)` — the DLL's
  grid select. `Per_Kg`, `FTL_Type` and `Created_By` come from the page's PAL fields; **confirm the column names** and whether
  there is a created-date column.
* `Sp_Insert_Prs_and_Drs_Rate(@Vend_Type, @Vend_Code, @Rat_On, @Fix_Km, @Fix_Km_rate, @Extra_Km_Rate, @Per_Kg, …)` — the first
  seven parameters are in the DLL; the dev stand-in adds `@Effective_Date, @Created_By, @FTL_Type` — **confirm the rest of the
  parameter list** and what it returns (the page only checked for a value > 0).
* Stored values: `Vendor_Type` is the dropdown text (`Vendor` / `Self`), `Rate_On` the text (`Per Km`, `Per Kg`, `Round Trip`),
  `FTL_Type` the freight name (text, not the code). For Per Km the rate per km is kept in `Fix_Km_Rate` (the page's
  txtfxkmrate) — **confirm the PRS / DRS challan reads it that way**.
* Vendors: `vendors_master.vendor_type = 'Vendor' / 'Self'` and `active_flag = 1` (Bind_Vendor_master by type; the division
  filter on `DivCode` is new).
* Previous effective date: `Check_Effective_Date(vendor, rateOn)`; the new app shows the latest date for the vendor + rate on.

## Client bill

From `server/db/dev/33-client-bill.sql`; **confirm against the live database.**
* `client_bill` — columns from sp_insert_Client_Bill_Bulk / sp_insert_Client_Bill_GST parameters (`bill_no, bill_date, client_Id,
  docket_no (comma list), Invoice_no, totalfreight, Total_docket_charge, Total_other_charge, Furelcharge_Amount / _Per, totalstax,
  TotCGST, TotSGST, totalamount, booking_mode, address, origin_branch, Financial_Year, user_id, ShortCode, FinYr, manual_bill_no,
  remarks, division, docs_enclosed, client_type, RateOn, BillType, FromDate, ToDate`), the page's update (`SacCode, DueDate`) and the
  status columns read elsewhere (`client_bill_status = 'bill_cancel', ClientBill_Summation_status = 'Active', Summation_date,
  RcvName, RcvPhNo, ClientBill_Finalize_status = 'Finalized', ClientBill_Finalize_date, Payment_Status, mr_status, mr_no, Bill_Type,
  CollectionLocation`). New in dev: `client_code, TotIGST, TotAfterTax, StaxRemark, ServiceType, CancelBy, CancelDate`.
* `client_bill_charge_details` — from the DLL's insert (`docket_no, booking_date, package, weight, rate, freight_charges,
  other_charges, docket_charge, Furelcharge_Amount / _Per, stax, Invoice_no, bill_no, RateOn, CGST_Amt, SGST_Amt`) and the bulk table
  (`CGST_Tax, SGST_Tax, IGST_Tax, Taxtype`); dev adds `IGST_Amt, after_tax, grand_total, client_bill_status`.
* `client_bill_cancel` — a short version of INSERT_INTO_CLIENT_BILL_CANCEL (its detail table is not kept).
* `Sac_Master(ServiceType, SubServiceType, Sac_Code)` — dev SAC codes are placeholders; **load the live table**.
* The bill no. format of GET_AUTO_GENERATED_CODE_FOR_CLIENT_BILL is not in the source ("Bill Series is Over" suggests a
  configured series) — the new app uses `BL` + branch short code + FY + 6 digits. **Confirm the live format.**
* SEARCH_DOCKET_DETAILS_FOR_CLIENT_BILL is rebuilt from grn_master / grn_docket_charge (the booking row: `rate_on <> ''`),
  docket_other_charges (fuel), docket_charge_entry (`IsTax = 1` after-tax charges), docket_invoice and the delivery status.
  The docket's tax type is `grn_master.StaxBy` in dev (`STaxRemark` on the live table?).
* Finalize (insert_Bill_Finalized / usp_Bill_Finalize): the voucher lines go to `tblAccountTrasaction` (VoucherNo = bill no.,
  Mode 'Bill Finalized', Entry 'Ledger') — **confirm** the live procedure's mode / narration and whether it also writes
  `bill_finalization` (the DLL has `insert into bill_finalization values(…)`) and Billwise_Details. Ledgers are found by
  `client_Master.billed_ledger_name / unbilled_ledger_name`, else by the AutoBindLedger name pattern. Undo cancels the lines
  (`IsCancelled = 1`); usp_BillFinalize_Cancel's body is not in the source.
* GetTaxType(client) is rebuilt as "client's state = branch's state → GST, else IGST" — the procedure body is not in the source.

## Octroi bills

From `server/db/dev/36-octroi-bill.sql`; **confirm against the live database.**
* `octroi_bill` and `octroi_bill_charge_details` — columns from octroiBill_pal (`docket_no, bill_date, booking_mode, bill_no, address,
  client_Id, client_Name, totalamount, remarks, origin_branch` / `billing_at, booking_date, Invoice_no, package, weight, OctroiAmount,
  OtherCharges, OctroiCharges_Per, OctroiCharges_Amount, Service_Tax, ServiceTax_Amount, SBC, SBC_Amt, KKC, KKC_Amt, totalamountDetail,
  octroi_no`) and the DLL's updates (`OctroiBill_Summation_status, Summation_date, client_bill_status`, octroi MR `mr_status, mr_no`).
  SBC / KKC are not kept in dev (one tax %); the cancel column name is a dev choice (`OctroiBill_Cancel_status`).
* `grn_master.Octroi_Status`, `Octroi_Bill_No` — from the DLL's `update grn_master set Octroi_Status='invoicegenerated',Octroi_Bill_No=…`.
* How the live page worked out the service tax (on the octroi charge, or on charge + other charges) is not in the source — **confirm**.

## Vendor invoices

From `server/db/dev/37-vendor-invoice.sql`; **confirm against the live database.**
* `Other_Vendor_Master` — columns from the DLL's vendor queries (`vendor_code, name, vendor_type, vendor_Mode, Branch, address,
  vendor_city, state, pin_code, vendor_phone_no, email, pan_no, Gstin_No, TDS, IsCostProfit, IsOctroi, active_flag, FTLDiv`); the live
  table has more (contact person, IFCCode, AccountNo, IsFastTag, CourDiv / PrclDiv …). The Other vendor master page is not ported.
* `ProductMaster` — from usp_InsertProductMaster (`ProductCode, ProductName, IsSacHsn, sacHSN, UOM`, `Status`, `SrNo`).
* `OtherVendorInvoice` — the DLL reads `select * from OtherVendorInvoice where InvoiceNo=` and `… where ShortCode= order by InvoiceNo
  desc`; Sp_InsertOtherVendorInvoice takes the lines as a table type, so the live table may hold one row **per line** (the
  VOtherVendorInvoice view has line and header columns together). Dev keeps a header table plus `OtherVendorInvoice_Details` (line
  table name is ours) — **confirm the live layout**. Header columns VendorLedger / ExpenseLedger / TDSLedger (ledger codes),
  `IsCancelled, CancelBy, CancelDate, CancelRemarks` are dev additions.
* `OtherVendorInvoiceCostProfit` (`InvoiceNo, CostProfit, Code, Name, Amount`) — from OthVndInvoiceDetails.
* GST slabs: the DLL reads `TaxSlab` (`SlNo, Slab, CGST, SGST, IGST`) for both the miscellaneous bill and this page; dev uses
  `Misc_Tax_Slab` for both — **rename to TaxSlab when moving to the live database**.
* `Vendor_Invoice_Verify` / `Vendor_Invoice_Verify_Details` — from sp_insert_vendor_invoice_verification's parameters and
  VendorPendingInvoiceReport's columns (`Vendor_Bill_No, Vendor_Bill_Date, challan_no, vehicle_freight, advance, CurrentPayment,
  Balance_Amount, CurrentPaymentDate`); the detail table name, `Vendor_Ref_No` and the cancel columns are dev choices.
  GET_AUTO_GENERATED_CODE_FOR_VENDOR_BILL's format is not in the source (dev: VB + short code + FY + 6 digits).
* `Dispatch_Master.IsVerified` — from the DLL's `… from Dispatch_Master where vendor_code=… and IsVerified= 0`.

## Franchisee commission invoices

From `server/db/dev/38-franchisee-invoice.sql`; **confirm against the live database.**
* `Franchisee_Invoice` — the DLL's insert (`Fran_Code, F_Invoice_No, Branch_Code, Invoice_Date, From_Date, To_Date, Month, Created_By`)
  and cancel (`IsCancel, Cancel_by, Cancel_Date`). `Fran_Branch`, the totals, `Rent / Mobile_Bills / Signage`, `TDS_Percent / TDS_Amount /
  Net_Amount`, `Remarks`, `Financial_Year, Division, ShortCode, FinYr` and `Cancel_Remarks` are dev additions (the print view
  VFranchiseeCommissionInvoice has Rent_Per_Month, Mobile_Per_Month, Signage_Per_Month and TDSPr — their source table is not known).
* `Franchisee_Invoice_Detail` — the DLL's insert column list (note the legacy spelling `Commaission_Type`); `Booking_Type` and
  `Booking_Mode` are dev additions. `Month` holds `YYYY-MM` in dev (the page saved the month name).
* `grn_master.Franchisee_Invoice_Status` — from the DLL; `Franchisee_Invoice_No` is a dev addition.
* The legacy page's rates came from `Franchise_Commission_Master` (`Francode, Franchise_Rate, Commission_Type, Handling_Charge`),
  which is not in dev and no page writes; dev uses `Franchisee_Commission_Master` (+ `_Detail`) from the Rate pages instead.

## Miscellaneous and warehouse bills

From `server/db/dev/35-other-bills.sql`; **confirm against the live database.**
* `miscellaneous_bill` / `warehouse_bill` — columns from Miscellaneous_Bill_pal / Warehouse_bill_pal (`bill_no, BillDate, MonthName,
  YearName, client_Id, client_Code, cust_name, remarks, TaxableAmt, TaxType, CGST, CGSTAmt, SGST, SGSTAmt, IGST, IGSTAmt, TotalAmount,
  UserId, CreateDate, CreatBranch, Financial_Year, SAC, DueDate, ServiceFor, TaxModeFor, ShortCode, FinYr`); the status columns
  (submission / finalize / cancel) are dev names — the DLL's Check_Cancel_Status returns three of them; **confirm**. Dev adds
  `ServiceType, Quantity, Rate, Division`.
* `Misc_Tax_Slab` stands in for objd.SelectTax() (Slab, SlNo, CGST, SGST, IGST) — **load the live slab table**.
* Ledgers: `OUTPUT CGST`, `OUTPUT SGST`, `OUTPUT IGST`, `BOOKING INCOME MISCELLANEOUS`, `BOOKING INCOME WAREHOUSE` (seeded in dev).
* `tblAccountTrasaction.Mode` is varchar(20) in dev but the legacy modes are longer ("Miscellaneous Bill Finalized") — widened to
  varchar(50) in 35-other-bills.sql.

## Paid / To Pay bills

* `client_bill.Bill_Type` 'Paid' / 'To Pay' with `client_code` = the consignor / consignee code and `client_Id` = the client's id
  only when the party is a client (sp_insert_Client_Bill_PaidToPay_Bulk — the page set client_Id 0 otherwise; dev uses NULL).
* SEARCH_DOCKET_DETAILS_FOR_CLIENT_BILL_PAIDTOPAY is rebuilt: Paid → `booking_type = 'Paid'`, `consigner_code`, booked at this
  branch; To Pay → `booking_type = 'To Pay'`, `consignee_code`, destination branch = this branch. **Confirm** the live filters
  (the procedure also took the current branch as a parameter).
* Ledgers: `PAID / TOPAY RECOVERY :<branch name> :<branch code>` (bound with the branch), `PAID / TOPAY BOOKING PENDING COLLECTION`,
  `Booking Income Deduction` — seeded in dev. **Confirm** what the live receipt credited (the page used the RECOVERY ledger).
* Bill no. prefix BP / BT — the live GET_AUTO_GENERATED_CODE_FOR_CLIENT_BILL_TOPAY_PAID format is not in the source.

## Bill receipt

From `server/db/dev/34-bill-receive.sql`; **confirm against the live database.**
* `Bill_Receive` — from Account_Bill_Receive_pal (`BR_No, Client_Code, Receive_Amount, Receive_Date, User_id, Branch, Receive_mode,
  CashLedger, BankLedger, ChequeNo, ChequeDate, ClientBank, Remarks, Financial_Year, OtherIncome, Paymentmode, BRMANUALNo, RoundedAmt`);
  dev adds `client_Id, TDS, Deduction, Narration, Division, ShortCode, FinYr, IsCancelled, Cancelled_By / _Date, Cancel_Remarks`.
* The live page wrote the bill rows through `dt_Bill_Receive_details` into **Billwise_Details** (Ledger_code, Bill_no, Dr, Cr,
  Bill_Amount, Adjustment_Type 'AgainstRef', Trans_Type 'Client_Bill', Deduction, TDS, OtherIncome, RoundedAmt …) — the outstanding
  views (VClientBill_Outstanding, usp_ClientBill_UnPaidAll) read it. Dev keeps them in `Bill_Receive_Details` (Settled = received +
  TDS + deduction + round-off). **Map to Billwise_Details on the live database.**
* BR no.: the page used Generate_Autocode("Bill_Receive", "BR", "BR_No", "1000", …) — "BR" + a running number from 1000; the new
  app uses BR + short code + FY + 6 digits. **Confirm.**
* Ledgers by name in the login year: `CASH <branch name>`, bank ledgers (select_Bank_Master_Details — dev: Ledger_Type 'Bank' or a
  group named …BANK…), `TDS Receivable`, `Freight Income Deduction`, `Other Income`, `ROUND OFF`, the client's BILLED ledger.

## Arrival excess dockets

* `GET_DOCKET_DETAILS_FOR_EXCESS_DOCKET_ARRIVAL(docket, branch)` exists only as a name in `bin/ClassLibrary.dll`; the grid
  bound `docket_no, from_branch, to_branch, freight, weight, package, mainfest_no, arrival_status`. Rebuilt from
  Manifest_grn + mainfest_entry: manifest to this branch, `Dispatch_Status = 'IsActive'` with a challan, not cancelled,
  `Manifest_grn.Arrival_status is null`. **Confirm** whether the live procedure also allowed undispatched manifests.
* `Arrival_Packg.IsExcessArrival` and `grn_docket_charge.IsExcessArrival` (insert_docket_Charge_Details @IsExcessArrival) are
  set to 1 for these rows (the dev `udt_Arrival_Entry` already has the column).

## Loading sheets

From `server/db/dev/32-loading-sheet.sql`; **confirm against the live database.**
* `Loading_Sheet(Ls_no, loading_date, entered_by, Loading_Branch, Financial_Year, ShortCode, FinYr, LoadType, Division,
  IsCancel, Cancelled_By, Cancelled_Date, manifest_status, ManifestNo)` — from Loading_dal's insert / select and the cancel
  page ("Manifest Generated" check); `Created_Date` is new. `manifest_status` = 'generated' once a manifest is made from it.
* `Loading_Sheet_Details(slno, Ls_no, loading_date, Entered_by, docket_no, Booking_date, from_branch, to_branch,
  Consigner_name, weight, pices, IsCancel, Division, Manifest_No)` — from insert_Loading_Sheet_Details and the manual
  cancel page's UPDATE_LOADING_SHEET_MANUAL_CANCEL_UNCANCEL (which set `IsCancel` per slno).
* SearchDocketForLS / SearchDocketForLSLoadType and select_data_on_the_basis_of_Loasing_No bodies are not in the source —
  rebuilt from grn_master / grn_docket_charge (pending packages at the branch) and the sheet's rows. **Confirm** whether the
  live search also excluded dockets already manifested in part, and how `manifest_status` was written by usp_insert_Manifest.

## Franchisee rates

From `server/db/dev/31-franchisee-rates.sql`; **confirm against the live database.**
* `Franchisee_Commission_Master(Comm_Code, Agent_Type, Rent, Mobile_Bills, Signage_Payment, Commission_Mode, Booking_Type, Mode,
  Comm_On_Base_Freight, Air_Commission, Train_Commission, Train_V_Commission, StartDate, EndDate, EffectiveDate, UserId)` — the
  DLL's insert; the key column `CommId` (identity) is the dev choice (Generate_Autocode used "CommId"). A second insert in the
  DLL has Haulage_FTL_36_Tons / Haulage_FTL_916_Tons / Haulage_Trailor_Type columns — not used by the page.
* `Franchisee_Commission_Master_Detail(CommId = Comm_Code, Booking_Type, Commission_1..4)` — Commission_1 is the category
  ("LTL 03 Tons", "FTL 36 Tons", "FTL 916 Tons", "FTL Trailor"); for LTL Commission_2 = % up to 3 t and Commission_4 = % 3–6 t,
  for FTL Commission_2 = vehicle type (trailer: booking type), Commission_3 = per consignment / vehicle, Commission_4 = share %.
* FTL 3–6 t / 9–16 t vehicle lists (FTL_36_List / FTL_916_List): taken as freight_master types with capacity 3000–6000 kg and
  9000–16000 kg — **confirm the procedures' filters**.
* `FranchiseeCommissionMaster(FranchiseeCode, Pickup, PerCon, PreDocument, NonDockname, Effective_Date, User_Id,
  Financial_Year)` — from the DLL's select; "Per Document" in PreDocument for documents, the weight band in NonDockname for
  non-documents (the page's grid had them the other way round) — **confirm with live data**.

## Vendor rates

From `server/db/dev/30-vendor-rates.sql`; **confirm against the live database.**
* `vendor_road_rate_master(slno, vendor_type, vendor_name = vendor code, vehicle_type, rate_mode FTL|PKG|PKM, capacity, origin,
  destination (city codes), ftl_amount, ftl_pkg, ftl_pkm, Route_Code, Route_Name, Effective_Date, StartDate, EndDate,
  FTL_Rate_Type "FTL"|"FTL PKM", Is_Self, IsActive)` — from the grid, the PAL and the page's inline SQL. For "FTL PKM" the per-km
  rate is taken from ftl_amount (the page's label switches to "FTL PKM" on the same box) — **confirm**.
* `Vendor_Air_RateMaster` — columns from the grid (`Air_Rate_Code, Vendor_type, vendor_code, Flight_shift, Origin_city,
  Destination_city, upto_weight, upto_wt_charge, Rate_pkg, AWBDO, FSC_Pkg, Unit_Pkg, MinUnit_Charge, Xray_Pkg, MinXray_Charge,
  TSPOut_Pkg, MinTsp_Charge, TSPIN_Charge, MinTSPIn_Charge, STax, Effective_Date`) and PAL (`Airline_Code, Airline_Name,
  Start_Date, End_Date, Is_Slab_Rate`); `IsActive` is new. Slabs in `Vendor_Air_Slab_Rate(Air_Rate_Code, From_Weight, To_Weight,
  Rate)` — **confirm the slab table name** (insert_vendror_Air_Slab_rate_master). The page's airline list (GetAirlineName) is
  replaced by the vendor's flights in vendor_vehicle_master (mode AR). Air code AIR + 4 digits (get_id format not traced).
* `Vendor_Train_Rate(slno, vendor_type, vendor_name, traintype, train_no, origin, destination, dd_amount, rate, ratetype 1|2,
  TripCost, Effective_Date, User_Id, LastUpdate)` — from the grid / PAL; `IsActive` is new.
* The challan rate (select_Vendor_road_rate_master_rate) is rebuilt: road rate in force for branch city → destination city.

## Settings

All from `server/db/dev/29-settings.sql`; **confirm each against the live database.**

* `Branch_bind_For_city(state_code, city_code, BindTo, IsCourier, IsParcel, IsFTL, active_flag, FranchiseeType)` — from the
  page's PAL (`bind_destinationtobranchpal`) and its inline `select … FranchiseeType from Branch_bind_For_city where BindTo=…`.
  `Insert_Branch_bind_For_city` / `Delete_Branch_bind_For_city` bodies are not in the source; the new app writes the table
  directly. `city_master.BindTo` (read by the ODA page) is not updated — the page's update of it is commented out.
* `Bind_Franch_Branch`: the dev table had (id, Franchise_Code, Branch_Code); the page also saved `Status`, `Created_by`,
  an effective date (always ""). Added `Franchise_Type` (1 franchisee / 2 master franchisee). Franchisee branches are
  `branch_master.IsFranchisee` / `IsMasterFranchisee` = 'true' (stored as text in dev) of the franchisee's
  `Franchise_Master.busslocation` / `MasterFranchise.newlocation`.
* `Bind_Franchisee_To_Client(UniqueNo, FranchiseeID → Franchise_Master.id, ClientID, IsActive, …)` — names from the page's
  grid (`UniqueNo`, `ClientID`, `IsActive`); the procedures `GET_ALL_FRANCHISEE_LIST` (Id, Franchisee_name) etc. are not in
  the source. **ClientID is the client code here** (the page parsed it as an int).
* ChangeDocket_FY: `grn_master.Old_Financial_Year`, `Invoice_status`, `grn_docket_charge.Financial_Year` added in dev;
  `usp_Update_DocketFinancial_Year(@docket, @Financial_Year)` body unknown — the stand-in moves the docket's account entries.
* ODA: `ODA_Distance_Master(from_distance, to_distance, distance_name, IsActive)`, `ODA_Weight_Master(from_weight, to_weight,
  weight_name, IsActive)`, `ODA_Configuration_Master(ODA_Distance_ID, ODA_Weight_ID, ODA_Rate, Effective_Date, IsActive)` —
  from the PAL and the grid; the DLL only has procedure names.
* Shippers: `shipper_master` / `GatePasshipper_master(shipper_type, receving_date, starting_series, End_series,
  Total_quantity, received_from, type, GRN_Type, Division, BookLet_Series…)`, `shiper_issue_to_branch(shipper_type,
  branch_code, starting_series, endseries, total_quantity, issue_date, GRN_Type, DivCode, Client_Code, UserId,
  PerShiperCharge, TotalShiperCharge)`, `Shipper_issue_frombranch_tobranch(…, shipper_no, isCancel, Cancel_by, Cancel_date)`
  — from the DLL's inline SQL. The new app adds `shiper_issue_to_branch.IsFranchisee` to tell the two issue pages apart
  (**confirm how the live data marks franchisee issues**). Series are "<letter>-<number>"; numbers compared as bigint.
* Special booking: `grn_master_splapl` — columns from the DLL (`Approve_status`, `second_approval`, `sec_app_date`,
  `third_approval`, `thrdapprovaldate`, `final_approval`, `finalapprovaldate`, `insertSplaprvd` parameters). Which dockets
  need approval (`getGridDtl`) is not in the source: the new app takes dockets with `grn_docket_charge.Discount > 0` —
  **confirm**, and whether "Discount" and "SpecialDiscount" are two different columns on the live docket.
* Freight margin: `Freight_THC_Margin_Approval_Details` — the page's list shows BDM / AM / Head / GM approval columns; the
  rules of `GET_FREIGHT_THC_MARGIN_APPROVAL` are not in the source. The new table keeps one decision per challan and the
  minimum margin % in `Freight_Margin_Setting` (new). **Confirm the live threshold and levels.**
* `vendor_vehicle_master`: columns from the page's inline select (engine_no, truck_no, chasis_no, model, make, validity,
  capacity, of_state, train_type, Vehicle_Capacity, Container_Size, Direction) plus `Status` (update_Status). `Train_Master
  (TrainCode, TrainName, Directions)`, `VehicleName_Master(no, vehicle_name)` from the page.
* MIS: `AutoMis_setting(isActive, MailTime1, MailTime2, ActiveDeactive_date, FromBackDays)`, `Client_email(id, client_code,
  email, selectd_column, isCancel)`, `Auto_MIS_Column_Master(index_id, column_Name, isActive)` — from the page's inline SQL;
  `Auto_MIS_Column_Master.field` is new (maps a column to the MIS row). The MIS rows (`sp_getDataForAuto_MIS`) are rebuilt
  from grn_master and the delivery status — **confirm the columns the live mail had**.

## Result-set columns

| Procedure / query | Columns relied on |
|-------------------|-------------------|
| `sp_select_login_160219`, `SP_FRANCHISE_LOGIN160219`, `sp_Master_Franchisee_login` | `user_id, user_password, user_emp_type, home_branch, branch, user_branch, empname` |
| `sp_select_Client_login` | `user_id, user_password, client_name, user_branch, home_branch, branch_code` |
| `sp_select_Branch_Master_Details` | `branch_code, branch_name, City_Code` |
| `Get_DocketDetails` | full list in `docket.service.js#getDocket`. **Legacy maps `consignee_*` columns into the consignor and vice-versa** — reproduced as-is; confirm with real data. GSTINs as `Gstin_No` / `ConsigneeGstin_No`. |
| `sp_Select_Rate` | `slno, billingat, branch_Name, rate_on, rate, minchargewt, minFreight, sour_charge (fuel %), FtlRate, DisPrc, ApproveDiscPrc, Expected_Days, …` |
| `ups_Get_TaxType` | `TaxType` — values assumed `IGST` / `GST` (anything else → NA) |
| `Get_GstTaxDetails` | `cgst, sgst` (IGST assumed = cgst + sgst) |
| `Get_IsThirdPartyBilling` | `Status = '1'` means not allowed |
| `SP_GET_max_docket`, `sp_getExpectedDate_grn` | first column of first row; parameter `@branchCode` for max docket is a guess (legacy call not traced) |
| `Get_CityMasterByCityName`, `usp_Get_CityExist`, `Get_Consigner` | `city_name/city_code`; `branch_code/branch_name`; `company_name, consigner_code, address, city, state, pin_code, phone, GSTIN_No` |

## Tables used directly (inline SQL)

`DivisionMaster`, `Financial_Year`, `users`, `Franchisee_Users`, `ClientLogin_Users`,
`employee_master`, `branch_master`, `Bind_Franch_Branch`, `MasterMenu`, `SubMenu`,
`Sub_SubMenu`, `Employee_Permission`, `Franchisee_Permission`, `Client_Permission`,
`state_master`, `zone_master`, `city_master`, `DistrictMaster`, `New_Location_master`,
`client_Master`, `MasterFranchise`, `Franchise_Master`, `Commodity_master`, `item_master`,
`HeadOfficeDepartmentMaster`, `CompanyMster`, `grn_master`, `grn_docket_charge`.

* `grn_docket_charge` column names (`pcs, charge_weight, freight, other_charge, service_tax,
  charges`) are inferred from `Save_DocketCharges` parameter names — used by the Docket
  Booking Register report.
* `Division_Master` list joins `CompanyMster.SlNo = DivisionMaster.CompanyCode` — confirm.
* `client_Master(client_code, client_name)` is used for the "on account of" search — the legacy
  page used an autocomplete web method not traced in detail.

## Behaviour decisions to confirm with the business

See `DOCKET-CALCULATION.md`: single application of special discount, fuel surcharge included
in the total for all customer types, minimum chargeable weight applied to charge weight.
