// Docket (GRN) booking — replaces Operation/GrnEntry.aspx (+ ~11k lines of OperationScript.js).
//   mode="new"     GrnEntry.aspx?x=0  book a docket
//   mode="modify"  GrnEntry.aspx?x=1  view / modify
//   mode="cancel"  GrnEntry.aspx?x=2  cancel
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  Alert, App, Button, Card, Col, DatePicker, Divider, Empty, Form, Input, InputNumber, Radio, Result, Row,
  Select, Space, Table, Tag, Tooltip, Typography,
} from 'antd';
import {
  CalculatorOutlined, CarOutlined, DeleteOutlined, FileDoneOutlined, PlusOutlined, ReloadOutlined, RightOutlined, SaveOutlined,
  SearchOutlined, SendOutlined, StopOutlined,
} from '@ant-design/icons';
import { Drawer as AntDrawer } from 'antd/es/index.js';
import ManifestEntryPage from '../manifest/ManifestEntryPage.jsx';
import ChallanEntryPage from '../challan/ChallanEntryPage.jsx';
import DrsEntryPage from '../drs/DrsEntryPage.jsx';
import { api, errorMessage, get } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import SearchSelect from '../../components/SearchSelect.jsx';
import MasterSelect from '../../components/masters/MasterSelect.jsx';
import { useBusiness } from '../../business/useBusiness.js';
import InternationalCard from './InternationalCard.jsx';
import TotalsCard from './TotalsCard.jsx';
import { useUiTheme } from '../../theme/ThemeContext.jsx';
import { fromDocket, initialValues, toPayload } from './docketForm.js';
import { calculateDocket, dimensionRow, OTHER_CHARGE_FIELDS } from '../../../../shared/docketCalc.js';

const DATE_FMT = 'DD/MM/YYYY';
const TITLES = { new: 'Docket Entry', modify: 'Docket View / Modify', cancel: 'Docket Cancel' };

const upper = (v) => (typeof v === 'string' ? v.toUpperCase() : v);

/** onChanged(name) after a saved party is picked or the city is confirmed — the page links the destination to it. */
function PartyFields({ name, title, form, onChanged }) {
  return (
    <Card size="small" title={title} style={{ height: '100%' }}>
      <Form.Item label="Name" name={[name, 'name']} normalize={upper} rules={[{ required: true, whitespace: true, message: `${title} name is required` }]}>
        <SearchSelect
          placeholder="Type to search saved parties"
          fetcher={(q) => get('/dockets/lookup/consigners', { q }).then((rows) => rows.map((r) => ({ ...r, value: r.name, label: `${r.name} (${r.code}) — ${r.city}` })))}
          onPick={(o) => {
            form.setFieldValue(name, {
              code: o.code, name: o.name, address: o.address, city: o.city, state: o.state, pinCode: o.pinCode, phone: o.phone, gstin: o.gstin,
            });
            onChanged?.(name);
          }}
          // a party not saved yet: "+ Add … as new Consignor / Consignee" with what is already typed on the docket
          quickAdd={{
            master: 'consignor',
            initial: () => {
              const p = form.getFieldValue(name) ?? {};
              return { address: p.address, city: p.city, state: p.state, pin_code: p.pinCode, phone: p.phone, GSTIN_No: p.gstin };
            },
            toOption: (r) => {
              const t = (v) => String(v ?? '').trim();
              return {
                value: t(r.company_name), code: t(r.consigner_code), name: t(r.company_name), address: t(r.address), city: t(r.city),
                state: t(r.state), pinCode: t(r.pin_code), phone: t(r.phone), gstin: t(r.GSTIN_No),
              };
            },
          }}
        />
      </Form.Item>
      <Form.Item name={[name, 'code']} hidden><Input /></Form.Item>
      <Form.Item label="Address" name={[name, 'address']} normalize={upper}><Input.TextArea rows={2} maxLength={500} /></Form.Item>
      <Row gutter={8}>
        <Col xs={12} md={8}>
          {/* GetStatbyCityConsigner / …Consignee: the state follows the city */}
          <Form.Item label="City" name={[name, 'city']} normalize={upper}>
            <Input maxLength={60} onBlur={async (e) => {
              const city = e.target.value.trim();
              if (!city) return;
              try {
                const r = await get('/dockets/lookup/city-state', { city });
                if (r.state) form.setFieldValue([name, 'state'], r.state);
              } catch { /* free-text city: keep what was typed */ }
              onChanged?.(name);
            }} />
          </Form.Item>
        </Col>
        <Col xs={12} md={8}><Form.Item label="State" name={[name, 'state']} normalize={upper}><Input maxLength={60} /></Form.Item></Col>
        <Col xs={12} md={8}><Form.Item label="PIN" name={[name, 'pinCode']} rules={[{ pattern: /^\d{6}$/, message: '6 digits' }]}><Input maxLength={6} /></Form.Item></Col>
        <Col xs={12} md={8}><Form.Item label="Phone" name={[name, 'phone']}><Input maxLength={30} /></Form.Item></Col>
        <Col span={24}>
          <Form.Item label="GSTIN" name={[name, 'gstin']} normalize={(v) => v?.toUpperCase()}
            rules={[{ pattern: /^$|^[0-9]{2}[A-Z0-9]{13}$/, message: '15-character GSTIN' }]}>
            {/* the GSTIN's first two digits are the state code: fill the state from it */}
            <Input maxLength={15} onBlur={async (e) => {
              const g = e.target.value.trim();
              if (!/^\d{2}[A-Z0-9]{13}$/i.test(g)) return;
              try {
                const r = await get('/dockets/lookup/gst-state', { gstin: g });
                if (r.state) form.setFieldValue([name, 'state'], r.state);
              } catch { /* lookup only */ }
            }} />
          </Form.Item>
        </Col>
      </Row>
    </Card>
  );
}

function RowsTable({ name, columns, addLabel, disabled, newRow = {} }) {
  return (
    <Form.List name={name}>
      {(fields, { add, remove }) => (
        <>
          {fields.length ? (
            <Table
              size="small"
              pagination={false}
              rowKey="key"
              dataSource={fields}
              scroll={{ x: 'max-content' }}
              columns={[
                ...columns.map((c) => ({
                  title: c.title,
                  key: c.name,
                  width: c.width,
                  render: (_, field) => (c.render ? c.render(field) : (
                    <Form.Item name={[field.name, c.name]} style={{ margin: 0 }} rules={c.rules}>{c.input}</Form.Item>
                  )),
                })),
                {
                  key: '_del', width: 48,
                  render: (_, field) => <Button size="small" danger type="text" icon={<DeleteOutlined />} onClick={() => remove(field.name)} disabled={disabled} aria-label="Remove row" />,
                },
              ]}
            />
          ) : null}
          <Button type="dashed" icon={<PlusOutlined />} onClick={() => add(newRow)} style={{ marginTop: 8 }} disabled={disabled}>{addLabel}</Button>
        </>
      )}
    </Form.List>
  );
}

export default function DocketBookingPage({ mode = 'new' }) {
  const { user } = useAuth();
  // desktop-style themes: the form takes the full width and the charges summary + Save sit in a bar at the bottom
  const { theme } = useUiTheme();
  const wide = Boolean(theme.layout.statusBar);
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [form] = Form.useForm();
  const [loaded, setLoaded] = useState(null); // docket loaded for modify/cancel
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [destBranches, setDestBranches] = useState([]);
  const [destLocations, setDestLocations] = useState([]);
  const [originLocations, setOriginLocations] = useState([]);
  const [issueInfo, setIssueInfo] = useState(null);
  const [billingAts, setBillingAts] = useState([]);
  const [rateInfo, setRateInfo] = useState(null);
  const [cancelRemark, setCancelRemark] = useState('');
  const [destCityCode, setDestCityCode] = useState('');   // for the expected date when the booking date changes
  const chargeManual = useRef(false);                     // the user typed the charge weight himself
  const rateTimer = useRef(null);
  // side panel with the next steps (manifest → challan → DRS) for the docket just booked / loaded
  const [panel, setPanel] = useState(null);               // 'manifest' | 'challan' | 'drs'
  const [lastSaved, setLastSaved] = useState(null);       // { docketNo, destinationBranch, destinationName, bookingDate }
  const [lastManifestNo, setLastManifestNo] = useState('');

  const canBook = ['admin', 'employee', 'franchisee'].includes(user.role);
  const readOnly = mode === 'cancel' || (mode === 'modify' && (!loaded || loaded.header.billNo || loaded.header.grnCancelled));

  const { data: opts } = useQuery({ queryKey: ['docket-options'], queryFn: () => get('/dockets/options'), enabled: canBook, staleTime: 10 * 60_000 });

  const values = Form.useWatch([], form);
  // courier / TMS / international (Division Master → business profile): Export / Import only where allowed
  const { data: biz } = useBusiness();
  const shipmentType = values?.international?.shipmentType ?? 'DOMESTIC';
  const totals = useMemo(() => {
    if (!values) return null;
    return calculateDocket({ ...values, divCode: user.divCode });
  }, [values, user.divCode]);

  // ---------------------------------------------------------------- load (modify / cancel)
  const loadDocket = useCallback(async (no) => {
    if (!no) return;
    setLoading(true);
    try {
      const doc = await get(`/dockets/${encodeURIComponent(no)}`);
      setLoaded(doc);
      form.resetFields();
      form.setFieldsValue(fromDocket(doc));
      chargeManual.current = true;   // the saved charge weight stays unless actual / volumetric goes above it
      // Show branch names (the docket only stores codes).
      const branchName = (code) => opts?.branches?.find((b) => b.value === code)?.label ?? code;
      setDestBranches([{ code: doc.header.destinationBranch, name: branchName(doc.header.destinationBranch) }]);
      if (doc.header.billingAt) setBillingAts([{ code: doc.header.billingAt, name: branchName(doc.header.billingAt) }]);
      if (doc.header.destination) {
        get('/dockets/lookup/destination-branches', { city: doc.header.destination })
          .then((rows) => rows.length && setDestBranches(rows))
          .catch(() => {});
        get('/dockets/lookup/oda-locations', { city: doc.header.destination }).then(setDestLocations).catch(() => {});
      }
    } catch (e) {
      setLoaded(null);
      message.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [form, message, opts]);

  useEffect(() => {
    setLoaded(null);
    setIssueInfo(null);
    form.resetFields();
    chargeManual.current = false;
    if (mode === 'new') {
      form.setFieldsValue(initialValues(user));
      prepareNew();   // next docket no. + consignor city
    }
    const no = params.get('docket');
    if (mode !== 'new' && no) loadDocket(no);
    // Get_LocationByBranch: the origin locations of the booking branch's city, its own location preselected
    get('/dockets/lookup/origin-locations').then((r) => {
      setOriginLocations(r.locations);
      if (mode === 'new' && r.default && !form.getFieldValue('originLocation')) form.setFieldValue('originLocation', r.default);
    }).catch(() => setOriginLocations([]));
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- automation
  // freight type: the one used last time on this computer (or the only one there is)
  useEffect(() => {
    if (mode !== 'new' || !opts?.freightTypes?.length || form.getFieldValue('freightType')) return;
    let last = null;
    try { last = localStorage.getItem('ramas.docket.freightType'); } catch { /* no storage */ }
    const pick = opts.freightTypes.find((f) => f.value === last)?.value ?? (opts.freightTypes.length === 1 ? opts.freightTypes[0].value : undefined);
    if (pick) form.setFieldValue('freightType', pick);
  }, [opts, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  /** A new docket: the next number of the branch's shipper series (and its client), the consignor's city = our city. */
  async function prepareNew() {
    try {
      const { docketNo } = await get('/dockets/lookup/next-number');
      if (docketNo && !form.getFieldValue('docketNo')) { form.setFieldValue('docketNo', docketNo); onDocketNoEntered(docketNo); }
    } catch { /* no series: typed by hand */ }
    if (user.cityCode && !form.getFieldValue(['consigner', 'city'])) {
      try {
        const r = await get('/dockets/lookup/city-state', { city: user.cityCode });
        if (r.city && !form.getFieldValue(['consigner', 'city'])) form.setFieldsValue({ consigner: { ...form.getFieldValue('consigner'), city: r.city, state: r.state } });
      } catch { /* lookup only */ }
    }
  }

  /** charge weight = the greater of actual and volumetric (dimensions); a weight typed by hand is kept if it is higher. */
  function autoChargeWeight(all, dimsChanged) {
    const dims = (all.dimensions || []).filter(Boolean).map((d) => dimensionRow({ ...d, unit: all.dimensionUnit, bookingMode: all.bookingMode }));
    const vol = dims.reduce((a, d) => a + d.chargeWeight, 0);
    if (dimsChanged) {
      form.setFieldValue('dimensions', (all.dimensions || []).map((d, i) => (d ? { ...d, totalCft: dims[i]?.cft, chargeWeight: dims[i]?.chargeWeight } : d)));
      const pk = (all.dimensions || []).reduce((a, d) => a + (Number(d?.packets) || 0), 0);
      if (pk > 0) form.setFieldValue('packets', pk);   // packets = the dimension rows' packets
    }
    const base = Math.max(Number(all.actualWeight) || 0, vol);
    const next = chargeManual.current ? Math.max(base, Number(all.chargeWeight) || 0) : base;
    if (Math.round(next * 100) / 100 !== Number(all.chargeWeight || 0)) form.setFieldValue('chargeWeight', Math.round(next * 100) / 100);
  }

  /** contract / general rate (and the ODA charge) again shortly after anything it depends on changes */
  function scheduleRate(weightChanged) {
    clearTimeout(rateTimer.current);
    rateTimer.current = setTimeout(() => {
      const v = form.getFieldsValue(true);
      const general = v.customerType === 'General Client';
      if (v.destination && (general ? ['Paid', 'To Pay'].includes(v.bookingType) : v.onAccountOf)) fetchRate({ silent: true, quiet: true });
      if (weightChanged && v.odaLocation) fetchOda({ quiet: true });
    }, 700);
  }

  /** booking date changed: tax and expected delivery follow it */
  async function onBookingDateChanged(all) {
    if (!all.destination || !all.bookingDate) return;
    const date = dayjs(all.bookingDate).format('YYYY-MM-DD');
    try {
      const tax = await get('/dockets/lookup/tax', { destination: all.destination, bookingMode: all.bookingMode || 'RD', bookingDate: date });
      form.setFieldsValue({ taxMode: tax.taxMode, igstRate: tax.igstRate, cgstRate: tax.cgstRate, sgstRate: tax.sgstRate });
      if (user.cityCode && destCityCode) {
        const { expectedDate } = await get('/dockets/lookup/expected-date', { fromCity: user.cityCode, toCity: destCityCode, bookingDate: date });
        if (expectedDate) form.setFieldValue('expectedDate', dayjs(expectedDate));
      }
    } catch { /* lookups only */ }
  }

  function onValuesChange(changed, all) {
    if (readOnly) return;
    if ('chargeWeight' in changed) chargeManual.current = true;
    const dimsChanged = 'dimensions' in changed || 'dimensionUnit' in changed;
    if ('actualWeight' in changed || dimsChanged || 'bookingMode' in changed) autoChargeWeight(form.getFieldsValue(true), dimsChanged);
    if ('bookingDate' in changed) onBookingDateChanged(all);
    if ('freightType' in changed && changed.freightType) { try { localStorage.setItem('ramas.docket.freightType', changed.freightType); } catch { /* no storage */ } }
    const rateKeys = ['bookingMode', 'bookingType', 'rateOn', 'docType', 'loadType', 'deliveryMode', 'bookingDate', 'packets', 'actualWeight', 'chargeWeight', 'dimensions'];
    if (rateKeys.some((k) => k in changed)) scheduleRate(['actualWeight', 'chargeWeight', 'dimensions'].some((k) => k in changed));
  }

  /** consignee picked / city typed and no destination yet: the consignee's city becomes the destination */
  async function onPartyChanged(name) {
    if (name !== 'consignee' || readOnly || form.getFieldValue('destination')) return;
    const city = String(form.getFieldValue(['consignee', 'city']) || '').trim();
    if (!city) return;
    try {
      const rows = await get('/dockets/lookup/cities', { q: city });
      const hit = rows.find((r) => r.name.toUpperCase() === city.toUpperCase()) ?? (rows.length === 1 ? rows[0] : null);
      if (hit && !form.getFieldValue('destination')) { onDestinationPicked(hit); message.info(`Destination set to ${hit.name} (consignee city)`); }
    } catch { /* lookup only */ }
  }

  /** Enter moves to the next box, Shift+Enter to the previous one (desktop style); a list that is open keeps its Enter. */
  function enterToNext(e) {
    if (e.key !== 'Enter' || e.ctrlKey || e.altKey || e.metaKey) return;
    const t = e.target;
    if (!(t instanceof HTMLElement) || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON') return;
    if (t.getAttribute('aria-expanded') === 'true') return;   // choosing from an open drop-down / suggestion list
    const boxes = [...e.currentTarget.querySelectorAll('input, textarea')].filter((el) => !el.disabled && el.type !== 'hidden'
      && el.type !== 'radio' && el.type !== 'checkbox' && el.offsetParent !== null && (!el.readOnly || el.closest('.ant-select')));
    const i = boxes.indexOf(t);
    if (i < 0) return;
    e.preventDefault();
    const next = boxes[i + (e.shiftKey ? -1 : 1)];
    if (next) { next.focus(); if (typeof next.select === 'function' && !next.closest('.ant-select')) next.select(); }
  }

  /** after a save: keep what repeats (client, consignor, mode, …) and clear the rest — or start blank */
  const KEEP = ['bookingDate', 'customerType', 'onAccountOf', 'billingAt', 'bookingType', 'bookingMode', 'loadType', 'docType', 'deliveryMode',
    'consigner', 'originLocation', 'freightType', 'rateOn', 'gstPaidBy', 'itemContent', 'dimensionUnit'];
  function startNext(keep) {
    const v = form.getFieldsValue(true);
    form.resetFields();
    form.setFieldsValue({ ...initialValues(user), ...(keep ? Object.fromEntries(KEEP.filter((k) => v[k] !== undefined).map((k) => [k, v[k]])) : {}) });
    chargeManual.current = false;
    setRateInfo(null); setIssueInfo(null); setDestCityCode('');
    setDestBranches([]); setDestLocations([]);
    if (!keep) setBillingAts([]);
    prepareNew();
  }

  // ---------------------------------------------------------------- lookup chain
  // ODA (Get_OdaRate): the ODA location of the destination city and the charge weight give the ODA charge
  async function fetchOda({ quiet = false } = {}) {
    const v = form.getFieldsValue(true);
    if (!v.odaLocation) return;
    try {
      const { charge } = await get('/dockets/lookup/oda', { location: v.odaLocation, weight: Number(v.chargeWeight) || Number(v.actualWeight) || 0 });
      if (charge === null) { if (!quiet) message.info('No ODA rate for this location — enter the ODA charge if any'); return; }
      form.setFieldValue(['charges', 'oda'], charge);
      if (!quiet) message.success(`ODA charge ₹${charge} applied`);
    } catch (e) { if (!quiet) message.error(errorMessage(e)); }
  }

  // BindPin: a destination location fills the PIN; an ODA location (rate in force) also fills the ODA charge
  function applyDestLocation(loc) {
    const wasOda = Boolean(form.getFieldValue('odaLocation'));
    form.setFieldsValue({ destinationLocation: loc?.code, pinCode: loc?.pinCode || form.getFieldValue('pinCode'), odaLocation: loc?.oda ? loc.code : undefined });
    if (loc?.oda && !readOnly) fetchOda();
    else if (wasOda) form.setFieldValue(['charges', 'oda'], 0);
  }

  // GetLocation: a PIN typed in picks the destination location that has it
  async function onPinEntered(pin) {
    const city = form.getFieldValue('destination');
    if (!/^\d{6}$/.test(pin || '') || !city) return;
    try {
      applyDestLocation(await get('/dockets/lookup/location-by-pin', { pin, city }));
    } catch (e) { message.warning(errorMessage(e)); }
  }

  // Get_Branch_shiper_issue / Get_client_shiper_issue: the number's shipper issue sets the client and warns on another branch
  async function onDocketNoEntered(no) {
    setIssueInfo(null);
    if (mode !== 'new' || !no?.trim()) return;
    try {
      const r = await get('/dockets/lookup/docket-issue', { docketNo: no.trim() });
      setIssueInfo(r);
      if (r.issued && r.onAccountOf) {
        form.setFieldsValue({ customerType: 'Contractual Client', onAccountOf: r.onAccountOf });
        onClientPicked({ value: r.onAccountOf });
      }
    } catch { /* lookup only */ }
  }

  async function onDestinationPicked(opt) {
    form.setFieldsValue({ destination: opt.name, destinationBranch: undefined, destinationLocation: undefined, odaLocation: undefined });
    setDestCityCode(opt.code ?? '');
    // the consignee is normally in the destination city: fill it when still empty
    if (!form.getFieldValue(['consignee', 'city'])) {
      form.setFieldsValue({ consignee: { ...form.getFieldValue('consignee'), city: opt.name } });
      get('/dockets/lookup/city-state', { city: opt.name })
        .then((r) => { if (r.state && !form.getFieldValue(['consignee', 'state'])) form.setFieldValue(['consignee', 'state'], r.state); })
        .catch(() => {});
    }
    try {
      const [branches, tax, locations] = await Promise.all([
        get('/dockets/lookup/destination-branches', { city: opt.name }),
        get('/dockets/lookup/tax', { destination: opt.name, bookingMode: form.getFieldValue('bookingMode') || 'RD', bookingDate: dayjs(form.getFieldValue('bookingDate')).format('YYYY-MM-DD') }),
        get('/dockets/lookup/oda-locations', { city: opt.name }).catch(() => []),
      ]);
      setDestBranches(branches);
      setDestLocations(locations);
      if (branches.length === 1) {
        form.setFieldValue('destinationBranch', branches[0].code);
        applyDestLocation(locations.find((l) => l.branch === branches[0].code));   // Get_BranchLocation
      }
      if (!branches.length) message.warning('No active branch serves this city');
      form.setFieldsValue({ taxMode: tax.taxMode, igstRate: tax.igstRate, cgstRate: tax.cgstRate, sgstRate: tax.sgstRate });
      if (user.cityCode) {
        const { expectedDate } = await get('/dockets/lookup/expected-date', { fromCity: user.cityCode, toCity: opt.code, bookingDate: dayjs(form.getFieldValue('bookingDate')).format('YYYY-MM-DD') });
        if (expectedDate) form.setFieldValue('expectedDate', dayjs(expectedDate));
      }
    } catch (e) { message.error(errorMessage(e)); }
    fetchRate({ silent: true });
  }

  async function onClientPicked(opt) {
    form.setFieldValue('onAccountOf', opt.value);
    const dest = form.getFieldValue('destination');
    // ValidOnAccountOf + AutoConsigner + GetOnAccountRateOn / DeliveryMode: the client's own details and contract choices
    try {
      const d = await get('/dockets/lookup/client-defaults', { onAccountOf: opt.value, destination: dest || '' });
      if (!form.getFieldValue([d.partyRole, 'name'])) form.setFieldValue(d.partyRole, d.party);
      if (d.rateOns.length && !d.rateOns.includes(form.getFieldValue('rateOn'))) form.setFieldValue('rateOn', d.rateOns[0]);
      if (d.deliveryModes.length === 1) form.setFieldValue('deliveryMode', d.deliveryModes[0]);
      if (dest && !d.rateOns.length) message.warning(`${d.client.name} has no active contract to ${dest}`);
    } catch (e) {
      message.error(errorMessage(e));
      form.setFieldValue('onAccountOf', undefined);
      return;
    }
    if (!dest) return;
    try {
      const rows = await get('/dockets/lookup/billing-at', {
        onAccountOf: opt.value, destination: dest, bookingMode: form.getFieldValue('bookingMode') || 'RD',
        originLocation: form.getFieldValue('originLocation') ?? '', destinationLocation: form.getFieldValue('destinationLocation') ?? '',
      });
      setBillingAts(rows);
      if (rows.length === 1) form.setFieldValue('billingAt', rows[0].code);
    } catch (e) { message.error(errorMessage(e)); }
    fetchRate({ silent: true });
  }

  // silent: no "pick the destination first" / "no rate" notes; quiet: no "rate applied" note either (automatic refresh)
  async function fetchRate({ silent = false, quiet = false } = {}) {
    const v = form.getFieldsValue(true);
    // a contractual client: its own contract; a General Client: the Paid / To Pay general rate of the booking type
    const general = v.customerType === 'General Client';
    if (!v.destination || (general ? !['Paid', 'To Pay'].includes(v.bookingType) : !v.onAccountOf)) {
      if (!silent) message.info(general ? 'Select the destination and a Paid / To Pay booking type first' : 'Select a contractual client and destination first');
      return;
    }
    try {
      const r = await get('/dockets/lookup/rate', {
        onAccountOf: general ? '' : v.onAccountOf, destination: v.destination, bookingMode: v.bookingMode, rateOn: v.rateOn,
        customerType: v.customerType, bookingType: v.bookingType, bookingDate: dayjs(v.bookingDate).format('YYYY-MM-DD'),
        docType: v.docType, loadType: v.loadType, deliveryMode: v.deliveryMode,
        originLocation: v.originLocation ?? '', destinationLocation: v.destinationLocation ?? '',   // Location To Location contracts
        weight: Number(v.chargeWeight) || Number(v.actualWeight) || 0,   // picks the contract's weight slab, if any
        packets: Number(v.packets) || 0,                                 // BOX: picks the pickup / delivery charge slab
        ...(v.rateOn === 'CATEGORY' ? { itemCode: v.itemContent ?? '', pkgSize: v.pkgSize ?? '' } : {}),
      });
      setRateInfo(r);
      if (!r) { if (!silent) message.warning('No contract rate found for this route — enter the rate manually'); return; }
      form.setFieldsValue({
        rate: r.rate, rateId: r.rateId, minWeight: r.minWeight, minFreight: r.minFreight, fuelPercent: r.fuelPercent,
        discountPercent: r.discountPercent, ftlAmount: r.ftlAmount || v.ftlAmount,
        ...(r.distance ? { distance: r.distance } : {}),          // KM: freight = rate x distance
        billingAt: v.billingAt || r.billingAt,
        charges: { ...v.charges, ...Object.fromEntries(Object.entries(r.charges).filter(([, x]) => x > 0)) },
      });
      if (!billingAts.length && r.billingAt) setBillingAts([{ code: r.billingAt, name: r.billingAtName }]);
      if (!quiet) message.success(!r.slabRate
        ? `Contract rate ₹${r.rate} / ${r.rateOn.toLowerCase()} applied`
        : r.slab.pkgSize
          ? `Category rate ₹${r.rate} applied (${r.slab.pkgSize.toLowerCase()} package, ${r.slab.weight} kg)`
          : `Slab rate ₹${r.rate} / kg applied for ${r.slab.weight} kg`);
    } catch (e) { if (!quiet) message.error(errorMessage(e)); }
  }

  async function fillNextNumber() {
    try {
      const { docketNo } = await get('/dockets/lookup/next-number');
      if (docketNo) form.setFieldValue('docketNo', docketNo);
    } catch (e) { message.error(errorMessage(e)); }
  }

  function applyVolumetric() {
    const v = form.getFieldsValue(true);
    const dims = (v.dimensions || []).map((d) => dimensionRow({ ...d, unit: v.dimensionUnit, bookingMode: v.bookingMode }));
    const vol = dims.reduce((a, d) => a + d.chargeWeight, 0);
    const next = Math.max(Number(v.actualWeight) || 0, vol);
    form.setFieldValue('chargeWeight', Math.round(next * 100) / 100);
    form.setFieldValue('dimensions', (v.dimensions || []).map((d, i) => ({ ...d, totalCft: dims[i].cft, chargeWeight: dims[i].chargeWeight })));
    message.info(`Charge weight set to ${next.toFixed(2)} kg (greater of actual and volumetric)`);
    if (rateInfo) fetchRate({ silent: true });
  }

  // ---------------------------------------------------------------- submit
  async function submit() {
    let v;
    try { v = await form.validateFields(); } catch { message.error('Please fix the highlighted fields'); return; }
    const body = toPayload({ ...form.getFieldsValue(true), ...v });
    setSaving(true);
    try {
      if (mode === 'new') {
        const { data } = await api.post('/dockets', body);
        setLastSaved({
          docketNo: data.docketNo, destinationBranch: body.destinationBranch, bookingDate: body.bookingDate,
          destinationName: destBranches.find((b) => b.code === body.destinationBranch)?.name ?? body.destinationBranch,
        });
        setLastManifestNo('');
        modal.confirm({
          title: 'Docket booked',
          icon: null,
          content: <>{data.message}<br />Grand total: <strong>₹ {data.totals.grandTotal.toFixed(2)}</strong></>,
          okText: 'Next docket (same client & consignor)',
          cancelText: 'Next docket (blank)',
          onOk: () => startNext(true),
          onCancel: () => startNext(false),
        });
      } else {
        const { data } = await api.put(`/dockets/${encodeURIComponent(loaded.header.docketNo)}`, body);
        message.success(data.message);
        loadDocket(loaded.header.docketNo);
      }
    } catch (e) {
      const details = e.response?.data?.details;
      if (Array.isArray(details)) form.setFields(details.map((d) => ({ name: d.path.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)), errors: [d.message] })));
      message.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function doCancel() {
    setSaving(true);
    try {
      const { data } = await api.post(`/dockets/${encodeURIComponent(loaded.header.docketNo)}/cancel`, { remark: cancelRemark });
      message.success(data.message);
      setCancelRemark('');
      loadDocket(loaded.header.docketNo);
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (!canBook && mode === 'new') return <Result status="403" title="Your login cannot book dockets" />;

  const h = loaded?.header;
  const statusTags = h && (
    <Space wrap>
      {h.grnCancelled && <Tag color="red">CANCELLED</Tag>}
      {h.billNo && <Tag color="purple">Billed: {h.billNo}</Tag>}
      {h.nextStepDone && <Tag color="blue">Manifested</Tag>}
      {!h.grnCancelled && !h.billNo && !h.nextStepDone && <Tag color="green">Booked</Tag>}
    </Space>
  );

  const docketSearch = mode !== 'new' && (
    <Card size="small" style={{ marginBottom: 12 }}>
      <Space wrap>
        <Input.Search
          placeholder="Docket no."
          enterButton={<><SearchOutlined /> Find</>}
          style={{ width: 280 }}
          defaultValue={params.get('docket') || ''}
          loading={loading}
          onSearch={(no) => { if (no.trim()) { setParams({ docket: no.trim() }); loadDocket(no.trim()); } }}
        />
        {statusTags}
      </Space>
    </Card>
  );

  const showForm = mode === 'new' || loaded;
  const isContract = values?.customerType === 'Contractual Client';
  // the docket the side-panel steps are for: the one just booked (new) or the one loaded (modify / cancel)
  const stepDocket = mode === 'new' ? lastSaved : h ? {
    docketNo: h.docketNo, destinationBranch: h.destinationBranch, bookingDate: h.bookingDate,
    destinationName: destBranches.find((b) => b.code === h.destinationBranch)?.name ?? h.destinationBranch,
  } : null;
  const PANEL_TITLE = { manifest: 'Manifest Entry', challan: 'Challan Entry', drs: 'DRS Entry' };
  // e-way bill: needed when the goods are worth more than ₹ 50,000
  const invoiceTotal = (values?.invoices ?? []).reduce((a, i) => a + (Number(i?.invoiceValue) || 0), 0);
  const ewbNeeded = !readOnly && invoiceTotal > 50000 && !values?.eWayBill && !(values?.invoices ?? []).some((i) => i?.eWayBill);

  return (
    <div className="page-card">
      <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }} wrap>
        <Typography.Title level={3} style={{ margin: 0 }}>{TITLES[mode]}</Typography.Title>
        <Typography.Text type="secondary">Origin: {user.currentBranch.name} : {user.currentBranch.code}</Typography.Text>
      </Space>
      {docketSearch}
      {!showForm ? <Empty description="Enter a docket number to load it" /> : (
        <Form form={form} layout="vertical" disabled={readOnly || saving} scrollToFirstError onValuesChange={onValuesChange} onKeyDown={enterToNext}>
          {mode === 'modify' && h?.billNo && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={`Cannot modify: bill ${h.billNo} has been generated.`} />}
          {h?.grnCancelled && <Alert type="error" showIcon style={{ marginBottom: 12 }} message="This docket is cancelled." />}
          <Row gutter={16}>
            <Col xs={24} xl={wide ? 24 : 17}>
              {/* ---------------------------------------------------- booking */}
              <Card size="small" title="Booking" style={{ marginBottom: 12 }}>
                <Row gutter={12}>
                  <Col xs={24} sm={12} md={8}>
                    <Form.Item label="Docket no." name="docketNo" rules={[{ required: true, whitespace: true }]}>
                      <Input
                        maxLength={30}
                        disabled={mode !== 'new' || readOnly}
                        onBlur={(e) => onDocketNoEntered(e.target.value)}
                        suffix={mode === 'new' ? <Tooltip title="Next number"><ReloadOutlined onClick={fillNextNumber} /></Tooltip> : <span />}
                      />
                    </Form.Item>
                    {issueInfo && mode === 'new' && (
                      <Typography.Text className="docket-issue-note" type={!issueInfo.issued || !issueInfo.ownBranch ? 'warning' : 'secondary'} style={{ display: 'block', marginTop: -16, marginBottom: 8, fontSize: 12 }}>
                        {!issueInfo.issued
                          ? 'This number is not in any shipper issued to a branch'
                          : `Issued to ${issueInfo.branchName}${issueInfo.clientName ? ` for ${issueInfo.clientName}` : ''}${issueInfo.ownBranch ? '' : ' — not your branch'}`}
                      </Typography.Text>
                    )}
                  </Col>
                  <Col xs={12} sm={6} md={4}>
                    <Form.Item label="Booking date" name="bookingDate" rules={[{ required: true }]}>
                      <DatePicker format={DATE_FMT} style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={6} md={4}>
                    <Form.Item label="Expected delivery" name="expectedDate"><DatePicker format={DATE_FMT} style={{ width: '100%' }} /></Form.Item>
                  </Col>
                  <Col xs={24} sm={12} md={8}>
                    <Form.Item label="Manual docket no." name="manualDocketNo"><Input maxLength={30} /></Form.Item>
                  </Col>
                  {/* next steps for the docket just booked (or the one loaded): open in a side panel, already filled in */}
                  <Col xs={24} md={8}>
                    <div className="docket-next-steps">
                      <span className="docket-next-label">{stepDocket ? `Next for ${stepDocket.docketNo}` : 'Next steps'}</span>
                      <Space.Compact block>
                        <Button size="small" icon={<FileDoneOutlined />} onClick={() => setPanel('manifest')} disabled={false}>Manifest</Button>
                        <Button size="small" icon={<CarOutlined />} onClick={() => setPanel('challan')} disabled={false}>Challan</Button>
                        <Button size="small" icon={<SendOutlined />} onClick={() => setPanel('drs')} disabled={false}>DRS</Button>
                      </Space.Compact>
                    </div>
                  </Col>
                  <Col xs={24} md={12} xxl={8}>
                    <Form.Item label="Customer type" name="customerType" rules={[{ required: true }]}>
                      <Radio.Group optionType="button" options={['General Client', 'Contractual Client']} onChange={() => setRateInfo(null)} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={6} md={4}>
                    <Form.Item label="Booking type" name="bookingType" rules={[{ required: true }]}>
                      <Select options={(opts?.bookingTypes ?? ['To Pay', 'Paid', 'FOC']).filter((t) => t !== 'Inter Division').map((t) => ({ value: t, label: t }))}
                        onChange={() => setRateInfo(null)} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={6} md={4}>
                    <Form.Item label="Mode" name="bookingMode" rules={[{ required: true }]}><MasterSelect master="booking-mode" options={opts?.bookingModes} /></Form.Item>
                  </Col>
                  <Col xs={12} sm={6} md={4}>
                    <Form.Item label="Delivery" name="deliveryMode"><MasterSelect master="delivery-mode" options={opts?.deliveryModes} disabled={user.divCode === 'DIV1001' || readOnly} /></Form.Item>
                  </Col>
                  <Col xs={12} sm={6} md={4}>
                    <Form.Item label="Load" name="loadType"><Select options={[{ value: 'PTL', label: 'PTL' }, { value: 'FTL', label: 'FTL' }]} /></Form.Item>
                  </Col>
                  <Col xs={24} md={12} xxl={8}>
                    <Form.Item label="Contents" name="docType">
                      <Radio.Group optionType="button" options={[{ value: 'NONDOC', label: 'Non document' }, { value: 'DOC', label: 'Document' }]} />
                    </Form.Item>
                  </Col>
                  {/* export / import — only where the division books international (Division Master → business profile) */}
                  {biz?.allowInternational && (
                    <Col xs={24} md={12} xxl={8}>
                      <Form.Item label="Shipment" name={['international', 'shipmentType']}>
                        <Radio.Group optionType="button" disabled={readOnly}
                          options={[{ value: 'DOMESTIC', label: 'Domestic' }, { value: 'EXPORT', label: 'Export' }, { value: 'IMPORT', label: 'Import' }]} />
                      </Form.Item>
                    </Col>
                  )}
                </Row>
                <Divider style={{ margin: '4px 0 12px' }} />
                <Row gutter={12}>
                  <Col xs={24} sm={12} md={8}>
                    <Form.Item label="Destination city" name="destination" rules={[{ required: true, whitespace: true }]}>
                      <SearchSelect
                        placeholder="Type city name"
                        fetcher={(q) => get('/dockets/lookup/cities', { q }).then((rows) => rows.map((r) => ({ ...r, value: r.name, label: `${r.name} (${r.code})` })))}
                        onPick={onDestinationPicked}
                        minChars={1}
                        quickAdd={{
                          master: 'city',
                          toOption: (r) => {
                            const name = String(r.city_name ?? '').trim();
                            const code = String(r.city_code ?? '').trim();
                            return { value: name, name, code, label: `${name} (${code})` };
                          },
                        }}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12} md={8}>
                    <Form.Item label="Destination branch" name="destinationBranch" rules={[{ required: true }]}>
                      <Select options={destBranches.map((b) => ({ value: b.code, label: `${b.name} : ${b.code}` }))} placeholder="Pick destination city first"
                        onChange={(b) => {
                          // Get_BranchLocation: the branch's own location when none is picked yet
                          if (!form.getFieldValue('destinationLocation')) applyDestLocation(destLocations.find((l) => l.branch === b));
                        }} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={4}>
                    <Form.Item label="Origin location" name="originLocation">
                      <MasterSelect master="location" allowClear options={originLocations.map((l) => ({ value: l.code, label: l.name }))}
                        disabled={readOnly}
                        quickInitial={{ City_Code: user.cityCode, branch_code: user.currentBranch?.code }}
                        onCreated={() => get('/dockets/lookup/origin-locations').then((r) => setOriginLocations(r.locations)).catch(() => {})}
                        onChange={() => { if (rateInfo && !readOnly) fetchRate({ silent: true }); }} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={4}>
                    {/* ddlLocation: a location of the destination city → PIN; an ODA location → ODA charge */}
                    <Form.Item label="Destination location" name="destinationLocation">
                      <MasterSelect master={destCityCode ? 'location' : undefined} allowClear placeholder={destLocations.length ? 'Location' : 'Pick destination first'}
                        disabled={readOnly}
                        options={destLocations.map((l) => ({ value: l.code, label: `${l.name}${l.pinCode ? ` (${l.pinCode})` : ''}${l.oda ? ' · ODA' : ''}` }))}
                        quickInitial={() => ({ City_Code: destCityCode, branch_code: form.getFieldValue('destinationBranch') })}
                        onCreated={async (row) => {
                          // a new destination location: reload the city's locations and apply it (PIN, ODA)
                          const locs = await get('/dockets/lookup/oda-locations', { city: form.getFieldValue('destination') }).catch(() => []);
                          setDestLocations(locs);
                          applyDestLocation(locs.find((l) => l.code === String(row.Location_Code ?? '').trim()));
                        }}
                        onChange={(v) => { applyDestLocation(destLocations.find((l) => l.code === v)); if (rateInfo && !readOnly) fetchRate({ silent: true }); }} />
                    </Form.Item>
                    <Form.Item name="odaLocation" hidden><Input /></Form.Item>
                  </Col>
                  <Col xs={12} md={4}>
                    <Form.Item label="Dest. PIN" name="pinCode" rules={[{ pattern: /^$|^\d{6}$/, message: '6 digits' }]}>
                      <Input maxLength={6} onBlur={(e) => onPinEntered(e.target.value.trim())} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={4}><Form.Item label="E-way bill" name="eWayBill"><Input maxLength={30} /></Form.Item></Col>
                </Row>
                {isContract && (
                  <Row gutter={12}>
                    <Col xs={24} md={12}>
                      <Form.Item label="On account of (client)" name="onAccountOf" rules={[{ required: true, message: 'Select the contractual client' }]}>
                        <SearchSelect
                          placeholder="Search client"
                          fetcher={(q) => get('/dockets/lookup/clients', { q }).then((rows) => rows.map((r) => ({ ...r, label: `${r.name} (${r.code})` })))}
                          onPick={onClientPicked}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item label="Billing at" name="billingAt" rules={[{ required: true }]}>
                        <Select options={billingAts.map((b) => ({ value: b.code, label: `${b.name} : ${b.code}` }))} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={4} style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 24 }}>
                      <Button icon={<CalculatorOutlined />} onClick={() => fetchRate()} block>Get rate</Button>
                    </Col>
                  </Row>
                )}
                {!isContract && (
                  <Row gutter={12} style={{ marginBottom: 12 }}>
                    <Col>
                      {/* GetRate for a General Client: the Paid / To Pay general rate of the booking type */}
                      <Button icon={<CalculatorOutlined />} onClick={() => fetchRate()} disabled={readOnly}>Get general rate</Button>
                    </Col>
                  </Row>
                )}
                {rateInfo && (
                  <Typography.Text type="secondary">
                    {isContract ? 'Contract' : `${values?.bookingType} general rate`} #{rateInfo.rateId}: ₹{rateInfo.rate} per {rateInfo.rateOn.toLowerCase()}
                    {rateInfo.slabRate
                      ? rateInfo.slab.pkgSize
                        ? ` (category slab: ${rateInfo.slab.itemCode}, ${rateInfo.slab.pkgSize.toLowerCase()}, ${rateInfo.slab.weight} kg; flat rate ₹${rateInfo.flatRate})`
                        : ` (weight slab for ${rateInfo.slab.weight} kg; flat rate ₹${rateInfo.flatRate})`
                      : ''}
                    {rateInfo.distance ? ` × ${rateInfo.distance} km` : ''}
                    , min {rateInfo.minWeight} kg / ₹{rateInfo.minFreight}, fuel {rateInfo.fuelPercent}%
                    {rateInfo.chargeSlab?.collection != null ? `, pickup ₹${rateInfo.chargeSlab.collection} (slab)` : ''}
                    {rateInfo.chargeSlab?.delivery != null ? `, delivery ₹${rateInfo.chargeSlab.delivery} (slab)` : ''}
                    {rateInfo.expectedDays ? `, ${rateInfo.expectedDays} days` : ''}
                  </Typography.Text>
                )}
              </Card>

              {/* ---------------------------------------------------- parties */}
              <Row gutter={12} style={{ marginBottom: 12 }}>
                <Col xs={24} md={12}><PartyFields name="consigner" title="Consignor" form={form} onChanged={onPartyChanged} /></Col>
                <Col xs={24} md={12}><PartyFields name="consignee" title="Consignee" form={form} onChanged={onPartyChanged} /></Col>
              </Row>
              {shipmentType !== 'DOMESTIC' && <InternationalCard form={form} type={shipmentType} readOnly={readOnly} />}

              {/* ---------------------------------------------------- goods */}
              <Card size="small" title="Goods" style={{ marginBottom: 12 }}>
                <Row gutter={12}>
                  <Col xs={12} md={6}>
                    <Form.Item label="Packets" name="packets" rules={[{ required: true }]}>
                      <InputNumber min={1} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={6}><Form.Item label="Actual wt (kg)" name="actualWeight"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
                  <Col xs={12} md={6}>
                    {/* filled automatically (greater of actual and volumetric); rate slab + ODA band follow it (onValuesChange) */}
                    <Form.Item label="Charge wt (kg)" name="chargeWeight">
                      <InputNumber min={0} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={6}>
                    <Form.Item label="Package type" name="itemContent">
                      <MasterSelect master="item" allowClear options={opts?.items}
                        onChange={() => { if (!readOnly && form.getFieldValue('rateOn') === 'CATEGORY') fetchRate({ silent: true }); }} />
                    </Form.Item>
                  </Col>
                  <Col xs={24}><Form.Item label="Description of goods" name="itemDescription"><Input maxLength={500} /></Form.Item></Col>
                </Row>
                <Space style={{ marginBottom: 8 }} wrap>
                  <Typography.Text strong>Dimensions</Typography.Text>
                  <Form.Item name="dimensionUnit" noStyle><Select size="small" style={{ width: 90 }} options={(opts?.dimensionUnits ?? ['cm']).map((u) => ({ value: u, label: u }))} /></Form.Item>
                  <Button size="small" onClick={applyVolumetric} disabled={readOnly} title="Charge weight and packets follow the rows automatically">Recalculate weight</Button>
                </Space>
                <RowsTable
                  name="dimensions"
                  addLabel="Add dimension"
                  disabled={readOnly}
                  newRow={{ packets: 1 }}
                  columns={[
                    { name: 'packets', title: 'Pkts', input: <InputNumber min={1} style={{ width: 70 }} /> },
                    { name: 'length', title: 'L', input: <InputNumber min={0} style={{ width: 80 }} /> },
                    { name: 'width', title: 'W', input: <InputNumber min={0} style={{ width: 80 }} /> },
                    { name: 'height', title: 'H', input: <InputNumber min={0} style={{ width: 80 }} /> },
                    { name: 'perCft', title: 'Per CFT', input: <InputNumber min={0} style={{ width: 80 }} /> },
                    { name: 'totalCft', title: 'CFT', input: <InputNumber disabled style={{ width: 80 }} /> },
                    { name: 'chargeWeight', title: 'Chg wt', input: <InputNumber disabled style={{ width: 90 }} /> },
                  ]}
                />
              </Card>

              {/* ---------------------------------------------------- invoices */}
              <Card size="small" title="Invoices" style={{ marginBottom: 12 }}>
                {ewbNeeded && (
                  <Alert type="warning" showIcon style={{ marginBottom: 8 }}
                    message={`Invoice value ₹ ${invoiceTotal.toLocaleString('en-IN')} — an e-way bill is required above ₹ 50,000. Enter it in the invoice row or in E-way bill above.`} />
                )}
                <RowsTable
                  name="invoices"
                  addLabel="Add invoice"
                  disabled={readOnly}
                  newRow={{
                    invoiceDate: values?.bookingDate ?? dayjs(),
                    packets: Math.max((Number(values?.packets) || 0) - (values?.invoices ?? []).reduce((a, i) => a + (Number(i?.packets) || 0), 0), 0) || undefined,
                  }}
                  columns={[
                    { name: 'invoiceNo', title: 'Invoice no.', input: <Input style={{ width: 130 }} />, rules: [{ required: true, message: 'Required' }] },
                    { name: 'invoiceDate', title: 'Date', input: <DatePicker format={DATE_FMT} style={{ width: 130 }} /> },
                    { name: 'invoiceValue', title: 'Value', input: <InputNumber min={0} style={{ width: 120 }} /> },
                    { name: 'packets', title: 'Pkts', input: <InputNumber min={0} style={{ width: 70 }} /> },
                    { name: 'eWayBill', title: 'E-way bill', input: <Input style={{ width: 140 }} /> },
                    { name: 'eWayBillValidDate', title: 'EWB valid till', input: <DatePicker format={DATE_FMT} style={{ width: 130 }} /> },
                  ]}
                />
              </Card>

              {/* ---------------------------------------------------- pricing */}
              <Card size="small" title="Freight & charges" style={{ marginBottom: 12 }}>
                <Row gutter={12}>
                  <Col xs={12} md={4}>
                    <Form.Item label="Freight type" name="freightType" rules={[{ required: true, message: 'Select the freight type' }]}>
                      <MasterSelect master="container" options={opts?.freightTypes} placeholder="Select" />
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={4}>
                    <Form.Item label="Rate on" name="rateOn">
                      <Select options={['WEIGHT', 'BOX', 'BAG', 'KM', 'FTL', 'FREIGHT', 'CATEGORY'].map((r) => ({ value: r, label: r }))} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={4}><Form.Item label="Rate" name="rate"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
                  <Col xs={12} md={4}><Form.Item label="Min wt" name="minWeight"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
                  <Col xs={12} md={4}><Form.Item label="Min freight" name="minFreight"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
                  <Col xs={12} md={4}><Form.Item label="Fuel %" name="fuelPercent"><InputNumber min={0} max={100} style={{ width: '100%' }} /></Form.Item></Col>
                  <Col xs={12} md={4}><Form.Item label="Discount %" name="discountPercent"><InputNumber min={0} max={100} style={{ width: '100%' }} /></Form.Item></Col>
                  {values?.rateOn === 'KM' && <Col xs={12} md={4}><Form.Item label="Distance (km)" name="distance"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>}
                  {values?.rateOn === 'FTL' && <Col xs={12} md={4}><Form.Item label="FTL amount" name="ftlAmount"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>}
                  {values?.rateOn === 'FREIGHT' && <Col xs={12} md={4}><Form.Item label="Freight" name="manualFreight"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>}
                  {['BOX', 'BAG'].includes(values?.rateOn) && <Col xs={12} md={4}><Form.Item label="Min boxes" name="minBox"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>}
                  {values?.rateOn === 'CATEGORY' && (
                    <Col xs={12} md={4}>
                      {/* ddlPkgSize: with the package type it picks the contract's category slab */}
                      <Form.Item label="Package size" name="pkgSize" extra="With the package type, picks the category rate">
                        <Select allowClear options={(opts?.pkgSizes ?? ['BIG', 'MEDIUM', 'SMALL']).map((p) => ({ value: p, label: p }))}
                          onChange={() => { if (!readOnly) fetchRate({ silent: true }); }} />
                      </Form.Item>
                    </Col>
                  )}
                  <Col xs={12} md={4}><Form.Item label="Docket charge" name="docketCharge"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
                </Row>
                <Typography.Text strong>Other charges</Typography.Text>
                <Row gutter={12} style={{ marginTop: 8 }}>
                  {OTHER_CHARGE_FIELDS.map(([k, label]) => (
                    <Col key={k} xs={12} sm={8} md={6} lg={4}>
                      <Form.Item label={label} name={['charges', k]}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
                    </Col>
                  ))}
                </Row>
                <Row gutter={16}>
                  <Col xs={24} lg={12}>
                    <Typography.Text strong>Additional charges (taxable)</Typography.Text>
                    <RowsTable
                      name="additionalCharges"
                      addLabel="Add charge"
                      disabled={readOnly}
                      columns={[
                        { name: 'code', title: 'Charge', render: (f) => (
                          <Form.Item name={[f.name, 'code']} style={{ margin: 0 }}>
                            <MasterSelect master="charge-code" style={{ width: 150 }} options={opts?.chargeCodes} quickInitial={{ is_tax: false }}
                              onChange={(val, o) => form.setFieldValue(['additionalCharges', f.name, 'name'], o?.label)} />
                          </Form.Item>) },
                        { name: 'name', title: 'Name', input: <Input style={{ width: 130 }} /> },
                        { name: 'amount', title: 'Amount', input: <InputNumber min={0} style={{ width: 100 }} /> },
                      ]}
                    />
                  </Col>
                  <Col xs={24} lg={12}>
                    <Typography.Text strong>Charges after tax</Typography.Text>
                    <RowsTable
                      name="additionalChargesTax"
                      addLabel="Add charge"
                      disabled={readOnly}
                      columns={[
                        { name: 'code', title: 'Charge', render: (f) => (
                          <Form.Item name={[f.name, 'code']} style={{ margin: 0 }}>
                            <MasterSelect master="charge-code" style={{ width: 150 }} options={opts?.taxChargeCodes} quickInitial={{ is_tax: true }}
                              onChange={(val, o) => form.setFieldValue(['additionalChargesTax', f.name, 'name'], o?.label)} />
                          </Form.Item>) },
                        { name: 'name', title: 'Name', input: <Input style={{ width: 130 }} /> },
                        { name: 'amount', title: 'Amount', input: <InputNumber min={0} style={{ width: 100 }} /> },
                      ]}
                    />
                  </Col>
                </Row>
              </Card>

              {/* ---------------------------------------------------- tax */}
              <Card size="small" title="GST" style={{ marginBottom: 12 }}>
                <Row gutter={12}>
                  <Col xs={24} md={8}>
                    <Form.Item label="Tax type" name="taxMode">
                      <Radio.Group optionType="button" options={['GST', 'IGST', 'NA']} />
                    </Form.Item>
                  </Col>
                  {values?.taxMode === 'IGST' && <Col xs={12} md={4}><Form.Item label="IGST %" name="igstRate"><InputNumber min={0} max={100} style={{ width: '100%' }} /></Form.Item></Col>}
                  {values?.taxMode === 'GST' && <Col xs={12} md={4}><Form.Item label="CGST %" name="cgstRate"><InputNumber min={0} max={100} style={{ width: '100%' }} /></Form.Item></Col>}
                  {values?.taxMode === 'GST' && <Col xs={12} md={4}><Form.Item label="SGST %" name="sgstRate"><InputNumber min={0} max={100} style={{ width: '100%' }} /></Form.Item></Col>}
                  <Col xs={24} md={8}>
                    <Form.Item label="GST paid by" name="gstPaidBy">
                      <Select options={['Transporter', 'Billing Party'].map((x) => ({ value: x, label: x }))} />
                    </Form.Item>
                  </Col>
                  <Col span={24}><Form.Item label="Remarks" name="remarks"><Input.TextArea rows={2} maxLength={500} /></Form.Item></Col>
                </Row>
              </Card>
            </Col>

            <Col xs={24} xl={wide ? 24 : 7} className={wide ? 'docket-summary-bar' : undefined}>
              <TotalsCard totals={totals} serverTotals={h ? { grandTotal: h.grandTotal } : null} horizontal={wide} />
              <Card size="small" style={wide ? undefined : { marginTop: 12 }} className={wide ? 'docket-summary-actions' : undefined}>
                {mode === 'new' && (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Button type="primary" size="large" icon={<SaveOutlined />} block loading={saving} onClick={submit} disabled={false}>Save docket</Button>
                    <Button block onClick={() => startNext(false)} disabled={saving}>Clear</Button>
                  </Space>
                )}
                {mode === 'modify' && loaded && (
                  <Button type="primary" size="large" icon={<SaveOutlined />} block loading={saving} onClick={submit} disabled={readOnly}>Update docket</Button>
                )}
                {mode === 'cancel' && loaded && (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Input.TextArea
                      rows={3}
                      placeholder="Reason for cancellation"
                      value={cancelRemark}
                      onChange={(e) => setCancelRemark(e.target.value)}
                      disabled={saving || h?.grnCancelled || Boolean(h?.billNo) || h?.nextStepDone}
                      maxLength={300}
                    />
                    <Button
                      danger
                      type="primary"
                      size="large"
                      icon={<StopOutlined />}
                      block
                      loading={saving}
                      disabled={cancelRemark.trim().length < 3 || h?.grnCancelled || Boolean(h?.billNo) || h?.nextStepDone || !['admin', 'employee'].includes(user.role)}
                      onClick={() => modal.confirm({
                        title: `Cancel docket ${h.docketNo}?`,
                        content: 'This cannot be undone.',
                        okText: 'Cancel docket',
                        okButtonProps: { danger: true },
                        cancelText: 'Keep',
                        onOk: doCancel,
                      })}
                    >
                      Cancel docket
                    </Button>
                    {h?.nextStepDone && <Typography.Text type="danger">Cannot cancel: manifest already generated.</Typography.Text>}
                  </Space>
                )}
                {mode !== 'new' && loaded && (
                  <Button type="link" block disabled={false} onClick={() => navigate(`/tracking?docket=${encodeURIComponent(h.docketNo)}`)}>Track this docket</Button>
                )}
              </Card>
            </Col>
          </Row>
        </Form>
      )}

      {/* next steps in a right-hand panel, filled in for the docket (outside the docket form so its settings don't apply) */}
      <AntDrawer
        open={Boolean(panel)}
        onClose={() => setPanel(null)}
        placement="right"
        width={Math.min(1180, Math.round(window.innerWidth * 0.94))}
        destroyOnHidden
        className="docket-steps-drawer"
        title={`${PANEL_TITLE[panel] ?? ''}${stepDocket ? ` — docket ${stepDocket.docketNo} → ${stepDocket.destinationName}` : ''}`}
        extra={(
          <Space size={4}>
            {['manifest', 'challan', 'drs'].filter((p) => p !== panel).map((p) => (
              <Button key={p} size="small" onClick={() => setPanel(p)}>{PANEL_TITLE[p]}</Button>
            ))}
            {panel === 'manifest' && lastManifestNo && (
              <Button size="small" type="primary" icon={<RightOutlined />} onClick={() => setPanel('challan')}>Next: Challan for {lastManifestNo}</Button>
            )}
          </Space>
        )}
      >
        {!stepDocket && <Alert type="info" showIcon style={{ marginBottom: 8 }} message="Save a docket first and its details are filled in here automatically. You can still make an entry by hand." />}
        {panel === 'manifest' && (
          <ManifestEntryPage
            key={`m-${stepDocket?.docketNo ?? ''}`}
            preset={stepDocket ? { docketNo: stepDocket.docketNo, bookingDate: stepDocket.bookingDate,
              destination: { code: stepDocket.destinationBranch, name: stepDocket.destinationName } } : null}
            onSaved={(no) => setLastManifestNo(no)}
          />
        )}
        {panel === 'challan' && (
          <ChallanEntryPage
            key={`c-${stepDocket?.docketNo ?? ''}-${lastManifestNo}`}
            preset={stepDocket ? { destinationBranch: stepDocket.destinationBranch, destinationName: stepDocket.destinationName,
              manifestNo: lastManifestNo, date: stepDocket.bookingDate } : null}
          />
        )}
        {panel === 'drs' && <DrsEntryPage key={`d-${stepDocket?.docketNo ?? ''}`} preset={stepDocket ? { docketNo: stepDocket.docketNo } : null} />}
      </AntDrawer>
    </div>
  );
}
