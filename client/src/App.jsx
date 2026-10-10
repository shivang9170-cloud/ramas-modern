import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuth } from './auth/AuthContext.jsx';
import LoginPage from './pages/LoginPage.jsx';
import AppLayout from './layout/AppLayout.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import MasterPage from './pages/masters/MasterPage.jsx';
import AccessRightsPage from './pages/admin/AccessRightsPage.jsx';
import ChangePasswordPage from './pages/account/ChangePasswordPage.jsx';
import NotMigratedPage from './pages/NotMigratedPage.jsx';
import DocketBookingPage from './pages/docket/DocketBookingPage.jsx';
import TrackingPage from './pages/TrackingPage.jsx';
import ReportPage from './pages/reports/ReportPage.jsx';
import PickupEntryPage from './pages/pickup/PickupEntryPage.jsx';
import PickupListPage from './pages/pickup/PickupListPage.jsx';
import ManifestEntryPage from './pages/manifest/ManifestEntryPage.jsx';
import ManifestListPage from './pages/manifest/ManifestListPage.jsx';
import ManifestBagLabelsPage from './pages/manifest/ManifestBagLabelsPage.jsx';
import LoadingSheetPage from './pages/loadingsheet/LoadingSheetPage.jsx';
import ClientBillPage from './pages/invoice/ClientBillPage.jsx';
import ClientBillListPage from './pages/invoice/ClientBillListPage.jsx';
import ClientBillPrintPage from './pages/invoice/ClientBillPrintPage.jsx';
import BillStagesPage from './pages/invoice/BillStagesPage.jsx';
import BillReceivePage from './pages/invoice/BillReceivePage.jsx';
import OtherBillPage, { OtherBillPrintRoute } from './pages/invoice/OtherBillPage.jsx';
import OctroiBillPage, { OctroiBillPrintRoute } from './pages/invoice/OctroiBillPage.jsx';
import VendorInvoicePage, { VendorInvoicePrintRoute } from './pages/invoice/VendorInvoicePage.jsx';
import VendorVerifyPage, { VendorBillPrintRoute } from './pages/invoice/VendorVerifyPage.jsx';
import FranchiseeInvoicePage, { FranchiseeInvoicePrintRoute } from './pages/invoice/FranchiseeInvoicePage.jsx';
import ChallanEntryPage from './pages/challan/ChallanEntryPage.jsx';
import ChallanListPage from './pages/challan/ChallanListPage.jsx';
import ArrivalEntryPage from './pages/arrival/ArrivalEntryPage.jsx';
import ArrivalListPage from './pages/arrival/ArrivalListPage.jsx';
import DrsEntryPage from './pages/drs/DrsEntryPage.jsx';
import DrsListPage from './pages/drs/DrsListPage.jsx';
import DeliveryStatusPage from './pages/delivery/DeliveryStatusPage.jsx';
import DeliveryListPage from './pages/delivery/DeliveryListPage.jsx';
import PodDispatchPage from './pages/pod/PodDispatchPage.jsx';
import PodListPage from './pages/pod/PodListPage.jsx';
import PodCourierPage from './pages/pod/PodCourierPage.jsx';
import PodCourierListPage from './pages/pod/PodCourierListPage.jsx';
import PodReceivePage from './pages/pod/PodReceivePage.jsx';
import PodReceivedListPage from './pages/pod/PodReceivedListPage.jsx';
import BranchMasterPage from './pages/masters/BranchMasterPage.jsx';
import VendorMasterPage from './pages/masters/VendorMasterPage.jsx';
import VehicleMasterPage from './pages/masters/VehicleMasterPage.jsx';
import ClientMasterPage from './pages/masters/ClientMasterPage.jsx';
import EmployeeMasterPage from './pages/masters/EmployeeMasterPage.jsx';
import AccountMasterPage from './pages/masters/AccountMasterPage.jsx';
import ContraEntryPage from './pages/accounts/ContraEntryPage.jsx';
import PaymentEntryPage from './pages/accounts/PaymentEntryPage.jsx';
import BooksPage from './pages/accounts/BooksPage.jsx';
import UserMasterPage from './pages/admin/UserMasterPage.jsx';
import ContractPage from './pages/rates/ContractPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
import ProjectFlowPage from './pages/ProjectFlowPage.jsx';
import OdaChargePage from './pages/rates/OdaChargePage.jsx';
import PrsDrsRatePage from './pages/rates/PrsDrsRatePage.jsx';
import VendorRatesPage from './pages/rates/VendorRatesPage.jsx';
import FranchiseeRatesPage from './pages/rates/FranchiseeRatesPage.jsx';
import BranchDestinationsPage from './pages/settings/BranchDestinationsPage.jsx';
import FranchiseeBranchPage from './pages/settings/FranchiseeBranchPage.jsx';
import FranchiseeClientPage from './pages/settings/FranchiseeClientPage.jsx';
import DocketFyPage from './pages/settings/DocketFyPage.jsx';
import EffectiveDatePage from './pages/settings/EffectiveDatePage.jsx';
import OdaConfigPage from './pages/settings/OdaConfigPage.jsx';
import ShipperStockPage from './pages/settings/ShipperStockPage.jsx';
import ShipperIssuePage from './pages/settings/ShipperIssuePage.jsx';
import { FreightMarginApprovalPage, SpecialBookingApprovalPage } from './pages/settings/ApprovalPages.jsx';
import VendorVehiclePage from './pages/settings/VendorVehiclePage.jsx';
import AutoMisPage from './pages/settings/AutoMisPage.jsx';

function RequireAuth({ children }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <div style={{ padding: 80, textAlign: 'center' }}><Spin size="large" /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  // signed in with a default / weak password: nothing else opens until it is changed
  if (user.pwc) return <Navigate to="/password-change" replace />;
  return children;
}

function RequirePasswordChange() {
  const { user, ready } = useAuth();
  if (!ready) return <div style={{ padding: 80, textAlign: 'center' }}><Spin size="large" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.pwc) return <Navigate to="/" replace />;
  return <ChangePasswordPage forced />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/password-change" element={<RequirePasswordChange />} />
      <Route path="/print/client-bill/:billNo" element={<RequireAuth><ClientBillPrintPage /></RequireAuth>} />
      <Route path="/print/other-bill/:kind/:billNo" element={<RequireAuth><OtherBillPrintRoute /></RequireAuth>} />
      <Route path="/print/octroi-bill/:billNo" element={<RequireAuth><OctroiBillPrintRoute /></RequireAuth>} />
      <Route path="/print/vendor-invoice/:invoiceNo" element={<RequireAuth><VendorInvoicePrintRoute /></RequireAuth>} />
      <Route path="/print/vendor-bill/:billNo" element={<RequireAuth><VendorBillPrintRoute /></RequireAuth>} />
      <Route path="/print/franchisee-invoice/:invoiceNo" element={<RequireAuth><FranchiseeInvoicePrintRoute /></RequireAuth>} />
      <Route path="/print/manifest-bags/:manifestNo" element={<RequireAuth><ManifestBagLabelsPage /></RequireAuth>} />
      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route path="invoice/client-bill/new" element={<ClientBillPage />} />
        <Route path="invoice/client-bill/list" element={<ClientBillListPage />} />
        <Route path="invoice/bill-submission" element={<BillStagesPage key="submit" stage="submit" />} />
        <Route path="invoice/bill-finalize" element={<BillStagesPage key="finalize" stage="finalize" />} />
        <Route path="invoice/bill-receive" element={<BillReceivePage />} />
        <Route path="invoice/misc-bill" element={<OtherBillPage key="misc" kind="misc" />} />
        <Route path="invoice/warehouse-bill" element={<OtherBillPage key="warehouse" kind="warehouse" />} />
        <Route path="invoice/octroi-bill" element={<OctroiBillPage />} />
        <Route path="invoice/vendor-invoice" element={<VendorInvoicePage />} />
        <Route path="invoice/vendor-verification" element={<VendorVerifyPage />} />
        <Route path="invoice/franchisee-invoice" element={<FranchiseeInvoicePage key="new" />} />
        <Route path="invoice/franchisee-invoice/cancel" element={<FranchiseeInvoicePage key="list" defaultTab="list" />} />
        <Route index element={<DashboardPage />} />
        <Route path="masters/branches" element={<BranchMasterPage />} />
        <Route path="masters/vendors" element={<VendorMasterPage />} />
        <Route path="masters/vehicles" element={<VehicleMasterPage />} />
        <Route path="masters/clients" element={<ClientMasterPage />} />
        <Route path="masters/employees" element={<EmployeeMasterPage />} />
        <Route path="masters/accounts" element={<AccountMasterPage />} />
        <Route path="masters/:key" element={<MasterPage />} />
        <Route path="accounts/contra/new" element={<ContraEntryPage key="new" defaultTab="new" />} />
        <Route path="accounts/contra/list" element={<ContraEntryPage key="list" defaultTab="list" />} />
        <Route path="accounts/payment/new" element={<PaymentEntryPage key="new" defaultTab="new" />} />
        <Route path="accounts/payment/list" element={<PaymentEntryPage key="list" defaultTab="list" />} />
        <Route path="accounts/books" element={<BooksPage />} />
        <Route path="operation/docket/new" element={<DocketBookingPage key="new" mode="new" />} />
        <Route path="operation/docket/modify" element={<DocketBookingPage key="modify" mode="modify" />} />
        <Route path="operation/docket/cancel" element={<DocketBookingPage key="cancel" mode="cancel" />} />
        <Route path="operation/pickup/new" element={<PickupEntryPage />} />
        <Route path="operation/pickup/list" element={<PickupListPage />} />
        <Route path="operation/manifest/new" element={<ManifestEntryPage />} />
        <Route path="operation/manifest/list" element={<ManifestListPage />} />
        <Route path="operation/loading-sheet/new" element={<LoadingSheetPage tab="new" />} />
        <Route path="operation/loading-sheet/list" element={<LoadingSheetPage tab="list" />} />
        <Route path="operation/loading-sheet/docket" element={<LoadingSheetPage tab="docket" />} />
        <Route path="operation/challan/new" element={<ChallanEntryPage />} />
        <Route path="operation/challan/list" element={<ChallanListPage />} />
        <Route path="operation/arrival/new" element={<ArrivalEntryPage />} />
        <Route path="operation/arrival/list" element={<ArrivalListPage />} />
        <Route path="operation/drs/new" element={<DrsEntryPage />} />
        <Route path="operation/drs/list" element={<DrsListPage />} />
        <Route path="operation/delivery/new" element={<DeliveryStatusPage />} />
        <Route path="operation/delivery/list" element={<DeliveryListPage />} />
        <Route path="operation/pod/new" element={<PodDispatchPage />} />
        <Route path="operation/pod/list" element={<PodListPage />} />
        <Route path="operation/pod-courier/new" element={<PodCourierPage />} />
        <Route path="operation/pod-courier/list" element={<PodCourierListPage />} />
        <Route path="operation/pod-receive/new" element={<PodReceivePage />} />
        <Route path="operation/pod-receive/list" element={<PodReceivedListPage />} />
        <Route path="tracking" element={<TrackingPage />} />
        <Route path="reports/:key" element={<ReportPage />} />
        <Route path="admin/access-rights" element={<AccessRightsPage />} />
        <Route path="admin/users" element={<UserMasterPage />} />
        <Route path="rates/contracts" element={<ContractPage key="client" />} />
        <Route path="rates/general" element={<ContractPage key="general" book="GENERAL" />} />
        <Route path="rates/oda" element={<OdaChargePage />} />
        <Route path="rates/prs-drs" element={<PrsDrsRatePage />} />
        <Route path="rates/vendor-road" element={<VendorRatesPage kind="road" />} />
        <Route path="rates/vendor-air" element={<VendorRatesPage kind="air" />} />
        <Route path="rates/vendor-train" element={<VendorRatesPage kind="train" />} />
        <Route path="rates/franchisee-commission" element={<FranchiseeRatesPage tab="commission" />} />
        <Route path="rates/franchisee-pickup-delivery" element={<FranchiseeRatesPage tab="pickup" />} />
        <Route path="settings/branch-destinations" element={<BranchDestinationsPage />} />
        <Route path="settings/franchisee-branches" element={<FranchiseeBranchPage />} />
        <Route path="settings/franchisee-clients" element={<FranchiseeClientPage />} />
        <Route path="settings/docket-fy" element={<DocketFyPage />} />
        <Route path="settings/effective-dates" element={<EffectiveDatePage />} />
        <Route path="settings/oda-config" element={<OdaConfigPage />} />
        <Route path="settings/shipper-stock" element={<ShipperStockPage key="shipper" kind="shipper" />} />
        <Route path="settings/gatepass-stock" element={<ShipperStockPage key="gatepass" kind="gatepass" />} />
        <Route path="settings/shipper-issue" element={<ShipperIssuePage key="branch" />} />
        <Route path="settings/shipper-issue-franchisee" element={<ShipperIssuePage key="franchisee" franchisee />} />
        <Route path="settings/special-booking-approval" element={<SpecialBookingApprovalPage />} />
        <Route path="settings/freight-margin-approval" element={<FreightMarginApprovalPage />} />
        <Route path="settings/vendor-vehicles" element={<VendorVehiclePage />} />
        <Route path="settings/auto-mis" element={<AutoMisPage />} />
        <Route path="account/change-password" element={<ChangePasswordPage />} />
        <Route path="project-flow" element={<ProjectFlowPage />} />
        <Route path="legacy" element={<NotMigratedPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
