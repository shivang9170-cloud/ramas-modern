// Client Contract, stages 1–3 — City / Location / State / Zone rates of a client, with optional weight slabs on WEIGHT
// rates (replaces those parts of Rate/Client_Contract.aspx).
// Pick a client to see its rates; "New rates" adds one or more rows for a billing branch with start / end / effective
// dates. A new rate for an existing route is a new version; docket booking uses the version in force on the booking date.
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, App, Button, Card, Checkbox, Col, Collapse, DatePicker, Drawer, Form, Input, InputNumber, Radio, Row, Select, Space, Switch, Table, Tag, Typography,
} from 'antd';
import { DownloadOutlined, EditOutlined, MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { exportCsv } from '../../utils/exportTable.js';
import MasterSelect from '../../components/masters/MasterSelect.jsx';

// The page's "Export to Excel" of the rate grid: every column of the rate, one row per rate (CSV, opens in Excel).
const yesNo = (v) => (v ? 'Yes' : 'No');
const exportColumns = () => [
  { title: 'Ref', dataIndex: 'entRef' },
  { title: 'Contract type', dataIndex: 'typeLabel' },
  { title: 'Rate type', dataIndex: 'rateType' },
  { title: 'Client', dataIndex: 'clientName' },
  { title: 'Client code', dataIndex: 'clientCode' },
  { title: 'Billing at', dataIndex: 'billingName' },
  { title: 'From', dataIndex: 'originName' },
  { title: 'To', dataIndex: 'destinationName' },
  { title: 'Mode', dataIndex: 'modeName' },
  { title: 'Delivery mode', dataIndex: 'deliveryModeName' },
  { title: 'Rate on', dataIndex: 'rateOn' },
  { title: 'FTL type', dataIndex: 'ftlTypeName' },
  { title: 'Load type', dataIndex: 'loadType' },
  { title: 'Rate', dataIndex: 'rate' },
  { title: 'FTL rate', dataIndex: 'ftlRate' },
  { title: 'Freight', dataIndex: 'freight' },
  { title: 'Distance (km)', dataIndex: 'distance' },
  { title: 'Rate / km / kg', dataIndex: 'perKmPerKg' },
  { title: 'Admin %', dataIndex: 'adminPercent' },
  { title: 'Min weight', dataIndex: 'minWeight' },
  { title: 'Min boxes', dataIndex: 'minBoxes' },
  { title: 'Min freight', dataIndex: 'minFreight' },
  { title: 'CFT / vol.', dataIndex: 'volumetricWeight' },
  { title: 'Expected days', dataIndex: 'expectedDays' },
  ...Object.entries(CHARGE_LABELS).map(([k, title]) => ({ title, dataIndex: `charge_${k}`, exportValue: (_, r) => r.charges?.[k] ?? 0 })),
  { title: 'Collection per box', dataIndex: 'collectionPerBox', exportValue: yesNo },
  { title: 'Delivery per box', dataIndex: 'deliveryPerBox', exportValue: yesNo },
  { title: 'Slabs', dataIndex: 'hasSlabs', exportValue: yesNo },
  { title: 'Pickup / delivery slabs', dataIndex: 'hasChargeSlabs', exportValue: yesNo },
  { title: 'Start', dataIndex: 'startDate' },
  { title: 'End', dataIndex: 'endDate' },
  { title: 'Effective from', dataIndex: 'effectiveFrom' },
  { title: 'Status', dataIndex: 'active', exportValue: (v) => (v ? 'Active' : 'Inactive') },
];

const CHARGE_LABELS = {
  fuelPercent: 'Fuel %', statistical: 'Statistical', fov: 'FOV', oda: 'ODA', ocr: 'OCR', halting: 'Halting', delivery: 'Delivery',
  collection: 'Collection', minCollection: 'Min collection', minDelivery: 'Min delivery', logistics: 'Logistics', dod: 'DOD / DACC',
  risk: 'Risk', handling: 'Handling', service: 'Service', ocs: 'OCS', topay: 'To Pay', hamali: 'Hamali', discount: 'Discount %',
};
const money = (v) => (v ? Number(v).toLocaleString('en-IN') : '—');
const d = (v) => (v ? dayjs(v).format('DD/MM/YYYY') : '—');

// master: "+ New …" (quick add) when the place is not in its master yet; the new one is then searched so it shows
function RemoteSelect({ url, params, value, onChange, initial, placeholder, style, master, nameOf }) {
  const [q, setQ] = useState('');
  const { data: found = [], isFetching } = useQuery({
    queryKey: ['remote', url, params, q], queryFn: () => api.get(url, { params: { ...params, q } }).then((r) => r.data),
  });
  const options = useMemo(() => [...new Map([...(initial ? [initial] : []), ...found].map((o) => [o.value, o])).values()], [found, initial]);
  return (
    <MasterSelect master={master} showSearch filterOption={false} onSearch={setQ} loading={isFetching} value={value} onChange={onChange}
      options={options} placeholder={placeholder} style={style} allowClear onCreated={(row) => setQ(nameOf ? nameOf(row) : '')} />
  );
}

const PLACE_MASTER = { STATE: 'state', ZONE: 'zone', CITY: 'city', LOCATION: 'location' };

// Where from / to: states and zones are short lists; cities and locations are searched.
function PlaceSelect({ type, opts, value, onChange }) {
  if (type === 'STATE' || type === 'ZONE') {
    return <MasterSelect master={PLACE_MASTER[type]} allowClear value={value} onChange={onChange} options={type === 'STATE' ? opts?.states ?? [] : opts?.zones ?? []} />;
  }
  return (
    <RemoteSelect url="/contracts/places" params={{ type }} value={value} onChange={onChange} master={PLACE_MASTER[type]}
      nameOf={(r) => String((type === 'CITY' ? r.city_name : r.Location_Name) ?? '').trim()} />
  );
}
const PLACE_WORD = { CITY: 'city', LOCATION: 'location', STATE: 'state', ZONE: 'zone' };

function ChargeFields({ prefix }) {
  return (
    <Row gutter={8}>
      {Object.entries(CHARGE_LABELS).map(([k, label]) => (
        <Col xs={12} md={6} key={k}>
          <Form.Item name={[...prefix, 'charges', k]} label={label}><InputNumber min={0} max={k.endsWith('Percent') || k === 'discount' ? 100 : undefined} style={{ width: '100%' }} /></Form.Item>
        </Col>
      ))}
      {/* chk_is_per_box_col / chk_is_per_box_del: kept on the rate (the legacy docket's per-box sum was switched off) */}
      <Col xs={12} md={6}><Form.Item name={[...prefix, 'collectionPerBox']} valuePropName="checked"><Checkbox>Collection charge per box</Checkbox></Form.Item></Col>
      <Col xs={12} md={6}><Form.Item name={[...prefix, 'deliveryPerBox']} valuePropName="checked"><Checkbox>Delivery charge per box</Checkbox></Form.Item></Col>
    </Row>
  );
}

// CARGO (DIV1002) weight rates on City / Location: rate = km x rate per km per kg + admin % (txtPkV_TextChanged).
const isPerKmPriced = (divCode, type, rateOn) => divCode === 'DIV1002' && rateOn === 'WEIGHT' && ['CITY', 'LOCATION'].includes(type);
const round2 = (x) => Math.round(x * 100) / 100;

function DistanceField({ prefix, onFetchDistance }) {
  return (
    <Form.Item label="Distance (km)" required>
      <Space.Compact style={{ width: '100%' }}>
        <Form.Item name={[...prefix, 'distance']} noStyle rules={[{ required: true, message: 'Distance' }]}>
          <InputNumber min={0} style={{ width: '100%' }} aria-label="Distance km" />
        </Form.Item>
        {onFetchDistance && <Button onClick={onFetchDistance} title="From the distance master">Fetch</Button>}
      </Space.Compact>
    </Form.Item>
  );
}

function AmountFields({ prefix, rateOn, onFetchDistance, perKmPriced, listPrefix = prefix }) {
  if (perKmPriced) {
    // listPrefix: the full path from the form root (inside a Form.List the field names are relative to the list item)
    return (
      <Row gutter={8}>
        <Col xs={12} md={5}><DistanceField prefix={prefix} onFetchDistance={onFetchDistance} /></Col>
        <Col xs={12} md={4}>
          <Form.Item name={[...prefix, 'perKmPerKg']} label="Rate / km / kg" rules={[{ required: true, message: 'Rate / km / kg' }]}>
            <InputNumber min={0} step={0.001} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        <Col xs={12} md={3}><Form.Item name={[...prefix, 'adminPercent']} label="Admin %"><InputNumber min={0} max={100} style={{ width: '100%' }} /></Form.Item></Col>
        <Col xs={12} md={4}>
          <Form.Item label="Rate / kg (worked out)" shouldUpdate>
            {({ getFieldValue, getFieldsValue }) => {
              const r = (listPrefix.length ? getFieldValue(listPrefix) : getFieldsValue(true)) ?? {};
              const base = round2((Number(r.distance) || 0) * (Number(r.perKmPerKg) || 0));
              const admin = round2(base * (Number(r.adminPercent) || 0) / 100);
              return <Typography.Text strong>₹ {round2(base + admin)} <Typography.Text type="secondary">(base {base} + admin {admin})</Typography.Text></Typography.Text>;
            }}
          </Form.Item>
        </Col>
        <Col xs={12} md={4}><Form.Item name={[...prefix, 'minWeight']} label="Min weight"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
        <Col xs={12} md={4}><Form.Item name={[...prefix, 'minFreight']} label="Min freight"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
        <Col xs={12} md={4}><Form.Item name={[...prefix, 'volumetricWeight']} label="CFT / vol."><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
        <Col xs={12} md={4}><Form.Item name={[...prefix, 'expectedDays']} label="Expected days"><InputNumber min={0} max={60} style={{ width: '100%' }} /></Form.Item></Col>
      </Row>
    );
  }
  return (
    <Row gutter={8}>
      {(['WEIGHT', 'BOX', 'CATEGORY', 'KM'].includes(rateOn) || !rateOn) && (
        <Col xs={12} md={4}>
          <Form.Item name={[...prefix, 'rate']} label={{ BOX: 'Rate / box', CATEGORY: 'Rate / docket (no slab)', KM: 'Rate / km' }[rateOn] ?? 'Rate / kg'}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
      )}
      {rateOn === 'KM' && (
        <Col xs={12} md={5}>
          {/* TxtTotalKm: the route's distance; the docket's freight is rate x distance */}
          <DistanceField prefix={prefix} onFetchDistance={onFetchDistance} />
        </Col>
      )}
      {rateOn === 'FTL' && <Col xs={12} md={4}><Form.Item name={[...prefix, 'ftlRate']} label="FTL rate"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>}
      {rateOn === 'FREIGHT' && <Col xs={12} md={4}><Form.Item name={[...prefix, 'freight']} label="Freight"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>}
      <Col xs={12} md={4}><Form.Item name={[...prefix, 'minWeight']} label="Min weight"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
      {rateOn === 'BOX' && <Col xs={12} md={4}><Form.Item name={[...prefix, 'minBoxes']} label="Min boxes"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>}
      <Col xs={12} md={4}><Form.Item name={[...prefix, 'minFreight']} label="Min freight"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
      <Col xs={12} md={4}><Form.Item name={[...prefix, 'volumetricWeight']} label="CFT / vol."><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
      <Col xs={12} md={4}><Form.Item name={[...prefix, 'expectedDays']} label="Expected days"><InputNumber min={0} max={60} style={{ width: '100%' }} /></Form.Item></Col>
    </Row>
  );
}

// Weight slabs of a WEIGHT rate (ClientRate_With_Slab): up to 10 bands; a docket takes the band holding its charge weight.
const MAX_SLABS = 10;
function SlabFields({ name }) {
  return (
    <Form.List name={name}>
      {(fields, { add, remove }) => (
        <>
          {fields.length > 0 && (
            <Row gutter={8} className="slab-head">
              <Col span={4}>From kg</Col><Col span={4}>To kg</Col><Col span={5}>Rate / kg</Col><Col span={4}>Discount %</Col><Col span={5}>Approved disc. %</Col>
            </Row>
          )}
          {fields.map((f) => (
            <Row gutter={8} key={f.key} align="top">
              <Col span={4}><Form.Item name={[f.name, 'from']} rules={[{ required: true, message: 'From' }]} style={{ marginBottom: 8 }}><InputNumber min={0} style={{ width: '100%' }} aria-label="Slab from kg" /></Form.Item></Col>
              <Col span={4}><Form.Item name={[f.name, 'to']} rules={[{ required: true, message: 'To' }]} style={{ marginBottom: 8 }}><InputNumber min={0} style={{ width: '100%' }} aria-label="Slab to kg" /></Form.Item></Col>
              <Col span={5}><Form.Item name={[f.name, 'rate']} rules={[{ required: true, message: 'Rate' }]} style={{ marginBottom: 8 }}><InputNumber min={0} style={{ width: '100%' }} aria-label="Slab rate" /></Form.Item></Col>
              <Col span={4}><Form.Item name={[f.name, 'discount']} style={{ marginBottom: 8 }}><InputNumber min={0} max={100} style={{ width: '100%' }} aria-label="Slab discount" /></Form.Item></Col>
              <Col span={5}><Form.Item name={[f.name, 'approvedDiscount']} style={{ marginBottom: 8 }}><InputNumber min={0} max={100} style={{ width: '100%' }} aria-label="Slab approved discount" /></Form.Item></Col>
              <Col span={2}><Button type="text" danger icon={<MinusCircleOutlined />} aria-label="Remove slab" onClick={() => remove(f.name)} /></Col>
            </Row>
          ))}
          <Button size="small" type="dashed" icon={<PlusOutlined />} disabled={fields.length >= MAX_SLABS} onClick={() => add({ discount: 0, approvedDiscount: 0 })}>
            Add weight slab {fields.length ? `(${fields.length}/${MAX_SLABS})` : ''}
          </Button>
        </>
      )}
    </Form.List>
  );
}
const cleanSlabs = (slabs) => (slabs ?? []).map((b) => ({ ...b, discount: b.discount ?? 0, approvedDiscount: b.approvedDiscount ?? 0 }));

// Category slabs of a CATEGORY rate (ClientRate_Category_Slab): product + weight band, a rate for each package size.
// The docket picks the band from its package type, package size and charge weight; the rate is for the whole docket.
function CategorySlabFields({ name, items }) {
  return (
    <Form.List name={name}>
      {(fields, { add, remove }) => (
        <>
          {fields.length > 0 && (
            <Row gutter={8} className="slab-head">
              <Col span={6}>Product</Col><Col span={3}>From kg</Col><Col span={3}>To kg</Col><Col span={4}>Big ₹</Col><Col span={3}>Medium ₹</Col><Col span={3}>Small ₹</Col>
            </Row>
          )}
          {fields.map((f) => (
            <Row gutter={8} key={f.key} align="top">
              <Col span={6}><Form.Item name={[f.name, 'itemCode']} rules={[{ required: true, message: 'Product' }]} style={{ marginBottom: 8 }}><Select showSearch optionFilterProp="label" options={items ?? []} aria-label="Category product" /></Form.Item></Col>
              <Col span={3}><Form.Item name={[f.name, 'from']} rules={[{ required: true, message: 'From' }]} style={{ marginBottom: 8 }}><InputNumber min={0} style={{ width: '100%' }} aria-label="Category from kg" /></Form.Item></Col>
              <Col span={3}><Form.Item name={[f.name, 'to']} rules={[{ required: true, message: 'To' }]} style={{ marginBottom: 8 }}><InputNumber min={0} style={{ width: '100%' }} aria-label="Category to kg" /></Form.Item></Col>
              <Col span={4}><Form.Item name={[f.name, 'big']} style={{ marginBottom: 8 }}><InputNumber min={0} style={{ width: '100%' }} aria-label="Big package rate" /></Form.Item></Col>
              <Col span={3}><Form.Item name={[f.name, 'medium']} style={{ marginBottom: 8 }}><InputNumber min={0} style={{ width: '100%' }} aria-label="Medium package rate" /></Form.Item></Col>
              <Col span={3}><Form.Item name={[f.name, 'small']} style={{ marginBottom: 8 }}><InputNumber min={0} style={{ width: '100%' }} aria-label="Small package rate" /></Form.Item></Col>
              <Col span={2}><Button type="text" danger icon={<MinusCircleOutlined />} aria-label="Remove category slab" onClick={() => remove(f.name)} /></Col>
            </Row>
          ))}
          <Button size="small" type="dashed" icon={<PlusOutlined />} disabled={fields.length >= MAX_SLABS} onClick={() => add({ big: 0, medium: 0, small: 0 })}>
            Add category slab {fields.length ? `(${fields.length}/${MAX_SLABS})` : ''}
          </Button>
        </>
      )}
    </Form.List>
  );
}
// Pickup / delivery charge slabs (Min_chargeRate_slab): kg (WEIGHT) or packets (BOX) → minimum collection / delivery
// charge on the docket. They belong to the route (client + cities + rate on), not to one version.
const CHARGE_SLAB_MODES = { pickup: ['DM-101', 'DM-103'], delivery: ['DM-101', 'DM-104'] };
const chargeSlabKinds = (type, rateOn, deliveryMode) => (type === 'CITY' && ['WEIGHT', 'BOX'].includes(rateOn)
  ? Object.keys(CHARGE_SLAB_MODES).filter((k) => CHARGE_SLAB_MODES[k].includes(deliveryMode)) : []);

function ChargeSlabFields({ name, unit }) {
  return (
    <Form.List name={name}>
      {(fields, { add, remove }) => (
        <>
          {fields.length > 0 && (
            <Row gutter={8} className="slab-head">
              <Col span={7}>From {unit}</Col><Col span={7}>To {unit}</Col><Col span={8}>Charge ₹</Col>
            </Row>
          )}
          {fields.map((f) => (
            <Row gutter={8} key={f.key} align="top">
              <Col span={7}><Form.Item name={[f.name, 'from']} rules={[{ required: true, message: 'From' }]} style={{ marginBottom: 8 }}><InputNumber min={0} style={{ width: '100%' }} aria-label={`Charge slab from ${unit}`} /></Form.Item></Col>
              <Col span={7}><Form.Item name={[f.name, 'to']} rules={[{ required: true, message: 'To' }]} style={{ marginBottom: 8 }}><InputNumber min={0} style={{ width: '100%' }} aria-label={`Charge slab to ${unit}`} /></Form.Item></Col>
              <Col span={8}><Form.Item name={[f.name, 'amount']} rules={[{ required: true, message: 'Charge' }]} style={{ marginBottom: 8 }}><InputNumber min={0} style={{ width: '100%' }} aria-label="Charge slab amount" /></Form.Item></Col>
              <Col span={2}><Button type="text" danger icon={<MinusCircleOutlined />} aria-label="Remove charge slab" onClick={() => remove(f.name)} /></Col>
            </Row>
          ))}
          <Button size="small" type="dashed" icon={<PlusOutlined />} disabled={fields.length >= MAX_SLABS} onClick={() => add({})}>
            Add slab {fields.length ? `(${fields.length}/${MAX_SLABS})` : ''}
          </Button>
        </>
      )}
    </Form.List>
  );
}

function ChargeSlabSection({ prefix, kinds, rateOn }) {
  const unit = rateOn === 'BOX' ? 'pkts' : 'kg';
  return (
    <Row gutter={16}>
      {kinds.map((k) => (
        <Col xs={24} md={12} key={k}>
          <Typography.Text strong>{k === 'pickup' ? 'Pickup (collection) charge' : 'Delivery charge'}</Typography.Text>
          <div style={{ marginTop: 6 }}><ChargeSlabFields name={[...prefix, 'chargeSlabs', k]} unit={unit} /></div>
        </Col>
      ))}
    </Row>
  );
}
const cleanChargeSlabs = (c, kinds) => Object.fromEntries(kinds.map((k) => [k, (c?.[k] ?? []).filter(Boolean)]));

const cleanCategorySlabs = (slabs) => (slabs ?? []).map((b) => ({ ...b, big: b.big ?? 0, medium: b.medium ?? 0, small: b.small ?? 0 }));

// Copy a rate into a new row (the page's rbtnCERate with txtDiscount / txtHike — hidden on the legacy page):
//   "Copy general rate"  the General Rate Master rate in force for the row's route (Card Rate);
//   "Copy current rate"  this client's own current rate for the route at this billing branch (Existing Rate), e.g. to
//                         renew it with a hike.
// The rate, charges and weight slabs are filled in; a discount % or a hike % then changes the rate and the slabs.
function GeneralRateCopy({ form, fieldName, type }) {
  const { message } = App.useApp();
  const base = Form.useWatch(['rows', fieldName, 'generalRate'], form);
  const source = Form.useWatch(['rows', fieldName, 'copiedFrom'], form);
  async function copy(from) {
    const r = form.getFieldValue(['rows', fieldName]) ?? {};
    if (!r.origin || !r.destination || !r.mode || !r.rateOn) { message.info('Select from, to, mode and rate on first'); return; }
    const route = { type, origin: r.origin, destination: r.destination, mode: r.mode, rateOn: r.rateOn, deliveryMode: r.deliveryMode ?? '', ftlType: r.ftlType ?? '', docType: r.docType ?? '2' };
    const own = { rateType: form.getFieldValue('rateType') ?? 'Credit', client: form.getFieldValue('client') ?? '', billingAt: form.getFieldValue('billingAt') ?? '' };
    try {
      const { data } = from === 'general'
        ? await api.get('/contracts/general-rate', { params: route })
        : await api.get('/contracts/current-rate', { params: { ...route, ...own } });
      if (!data) {
        message.warning(from === 'general' ? 'Rate is not available in the General Rate Master for this route' : 'This client has no current rate for this route');
        return;
      }
      const pick = ['rate', 'ftlRate', 'freight', 'minWeight', 'minBoxes', 'minFreight', 'volumetricWeight', 'expectedDays', 'distance', 'perKmPerKg', 'adminPercent'];
      form.setFieldValue(['rows', fieldName], {
        ...r, ...Object.fromEntries(pick.map((k) => [k, data[k]])), charges: { ...data.charges },
        slabs: (data.slabs ?? []).map((b) => ({ ...b })), generalSlabs: data.slabs ?? [],
        generalRate: data.rate, generalRef: data.entRef, copiedFrom: from, discountOnGeneral: 0, hikeOnGeneral: 0,
      });
      message.success(`${from === 'general' ? 'General' : 'Current'} rate ${data.entRef} copied: ₹${data.rate}${data.slabs?.length ? ` with ${data.slabs.length} weight slab(s)` : ''}`);
    } catch (e) { message.error(errorMessage(e)); }
  }
  const adjust = (field) => (v) => {
    const pct = Number(v) || 0;
    const other = field === 'discountOnGeneral' ? 'hikeOnGeneral' : 'discountOnGeneral';
    const factor = field === 'discountOnGeneral' ? 1 - pct / 100 : 1 + pct / 100;
    const round = (x) => Math.round(x * factor * 100) / 100;
    form.setFieldValue(['rows', fieldName, other], 0);         // one or the other, as the page enabled only one
    form.setFieldValue(['rows', fieldName, 'rate'], round(base));
    // the copied weight slabs change the same way (btnIsSlab_Click applied txtDiscount / txtHike to every band)
    const generalSlabs = form.getFieldValue(['rows', fieldName, 'generalSlabs']) ?? [];
    if (generalSlabs.length) form.setFieldValue(['rows', fieldName, 'slabs'], generalSlabs.map((b) => ({ ...b, rate: round(b.rate) })));
  };
  return (
    <Space wrap style={{ marginBottom: 8 }}>
      <Button size="small" onClick={() => copy('general')}>Copy from general rate</Button>
      <Button size="small" onClick={() => copy('current')}>Copy current rate</Button>
      {base > 0 && (
        <>
          <Typography.Text type="secondary">{source === 'current' ? 'Current' : 'General'} ₹{base}</Typography.Text>
          <Form.Item name={[fieldName, 'discountOnGeneral']} noStyle>
            <InputNumber size="small" min={0} max={100} prefix="Discount %" style={{ width: 150 }} onChange={adjust('discountOnGeneral')} />
          </Form.Item>
          <Form.Item name={[fieldName, 'hikeOnGeneral']} noStyle>
            <InputNumber size="small" min={0} max={1000} prefix="Hike %" style={{ width: 140 }} onChange={adjust('hikeOnGeneral')} />
          </Form.Item>
        </>
      )}
    </Space>
  );
}

const BOOK_API = { CLIENT: '/contracts', GENERAL: '/general-rates' };

function NewRatesForm({ book = 'CLIENT', open, opts, initialClient, initialRateType, onClose, onSaved }) {
  const { message } = App.useApp();
  const { user } = useAuth();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const gen = book === 'GENERAL';
  const apiBase = BOOK_API[book];
  const rows = Form.useWatch('rows', form) ?? [];
  const type = Form.useWatch('type', form) ?? 'CITY';
  const rateType = Form.useWatch('rateType', form) ?? 'Credit';
  const credit = !gen && rateType === 'Credit';
  const word = PLACE_WORD[type];
  const blankRow = { mode: opts?.modes?.find((m) => m.value === 'RD')?.value, deliveryMode: opts?.deliveryModes?.[0]?.value, rateOn: opts?.rateOn?.[0]?.value, docType: '2', charges: {} };

  // BindLocDis: the location distance master fills the KM distance
  async function fetchDistance(i) {
    const r = form.getFieldValue(['rows', i]);
    if (!r?.origin || !r?.destination) { message.info('Select from and to first'); return; }
    try {
      const { data } = await api.get(`${apiBase}/distance`, { params: { type, from: r.origin, to: r.destination } });
      if (data.distance) form.setFieldValue(['rows', i, 'distance'], data.distance);
      else message.warning('No distance in the distance master for this route — type it in');
    } catch (e) { message.error(errorMessage(e)); }
  }

  async function save() {
    let v;
    try { v = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      const f = (x) => x.format('YYYY-MM-DD');
      const { data } = await api.post(apiBase, {
        ...v, startDate: f(v.startDate), endDate: f(v.endDate), effectiveFrom: f(v.effectiveFrom), notificationDays: v.notificationDays ?? '',
        rows: v.rows.map((r) => ({
          ...r, ftlType: r.ftlType ?? '', loadType: r.loadType ?? '', slabs: r.rateOn === 'WEIGHT' ? cleanSlabs(r.slabs) : [],
          categorySlabs: !gen && r.rateOn === 'CATEGORY' ? cleanCategorySlabs(r.categorySlabs) : [],
          chargeSlabs: cleanChargeSlabs(r.chargeSlabs, v.rateType === 'Credit' ? chargeSlabKinds(v.type, r.rateOn, r.deliveryMode) : []),
          charges: Object.fromEntries(Object.entries(r.charges ?? {}).filter(([, x]) => x !== null && x !== undefined)),
        })),
      });
      message.success(data.message);
      form.resetFields();
      onSaved(v.client, v.rateType);
    } catch (e) {
      const details = e.response?.data?.details;
      message.error(details?.length ? details.map((x) => x.message).join('; ') : errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer title={gen ? 'New general rates' : 'New contract rates'} open={open} onClose={onClose} width={Math.min(1100, window.innerWidth)} destroyOnClose
      extra={<Button type="primary" loading={saving} onClick={save}>Save rates</Button>}>
      <Form form={form} layout="vertical" preserve={false}
        initialValues={{
          type: 'CITY', rateType: initialRateType || 'Credit', client: initialClient || undefined, active: true, startDate: opts ? dayjs(opts.financialYear.from) : null,
          endDate: opts ? dayjs(opts.financialYear.to) : null, effectiveFrom: dayjs(), rows: [blankRow],
        }}>
        <Form.Item name="type" label="Contract type" extra="Docket booking uses the most specific match: location, then city, state, zone">
          <Radio.Group optionType="button" options={opts?.types ?? []}
            onChange={() => form.setFieldValue('rows', (form.getFieldValue('rows') ?? []).map((r) => ({ ...r, origin: undefined, destination: undefined })))} />
        </Form.Item>
        {gen ? (
          <Alert type="info" showIcon style={{ marginBottom: 12 }}
            message="The standard tariff (no client). A client contract can copy a general rate and give a discount or hike on it." />
        ) : (
          <Form.Item name="rateType" label="Rate type"
            extra={credit ? 'A client\'s contract rates' : `General rates: a General Client docket booked as ${rateType} takes them (no client, no billing branch)`}>
            <Radio.Group optionType="button" options={opts?.rateTypes ?? []} />
          </Form.Item>
        )}
        <Row gutter={12}>
          {credit && (
            <>
              <Col xs={24} md={8}>
                <Form.Item name="client" label="Client" rules={[{ required: true, message: 'Select client' }]}>
                  <RemoteSelect url="/contracts/clients" placeholder="Type client name" />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name="billingAt" label="Billing branch" rules={[{ required: true, message: 'Select billing branch' }]}>
                  <Select showSearch optionFilterProp="label" options={opts?.billingBranches ?? []} />
                </Form.Item>
              </Col>
            </>
          )}
          <Col xs={12} md={4}><Form.Item name="active" label="Active" valuePropName="checked"><Switch /></Form.Item></Col>
          <Col xs={12} md={4}><Form.Item name="notificationDays" label="Notify days before end"><Input maxLength={3} inputMode="numeric" /></Form.Item></Col>
          <Col xs={8} md={4}>
            <Form.Item name="startDate" label="Start date" rules={[{ required: true, message: 'Start date' }]}
              extra={opts ? `Within ${dayjs(opts.financialYear.from).format('DD/MM/YYYY')} – ${dayjs(opts.financialYear.to).format('DD/MM/YYYY')}` : undefined}>
              <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={8} md={4}><Form.Item name="endDate" label="End date" rules={[{ required: true, message: 'End date' }]}><DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} /></Form.Item></Col>
          <Col xs={8} md={4}>
            <Form.Item name="effectiveFrom" label="Effective from" rules={[{ required: true, message: 'Effective date' }]}>
              <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(x) => x.isBefore(dayjs(), 'day')} />
            </Form.Item>
          </Col>
        </Row>
        <Form.List name="rows">
          {(fields, { add, remove }) => (
            <>
              {fields.map((field, i) => (
                <Card key={field.key} size="small" style={{ marginBottom: 12 }}
                  title={`Rate ${i + 1}`} extra={fields.length > 1 && <Button size="small" type="text" danger icon={<MinusCircleOutlined />} onClick={() => remove(field.name)}>Remove</Button>}>
                  <Row gutter={8}>
                    <Col xs={12} md={5}>
                      <Form.Item name={[field.name, 'origin']} label={`From ${word}`} rules={[{ required: true, message: `From ${word}` }]}>
                        <PlaceSelect type={type} opts={opts} />
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={5}>
                      <Form.Item name={[field.name, 'destination']} label={`To ${word}`} rules={[{ required: true, message: `To ${word}` }]}>
                        <PlaceSelect type={type} opts={opts} />
                      </Form.Item>
                    </Col>
                    <Col xs={8} md={3}><Form.Item name={[field.name, 'mode']} label="Mode" rules={[{ required: true, message: 'Mode' }]}><MasterSelect master="booking-mode" options={opts?.modes ?? []} /></Form.Item></Col>
                    <Col xs={8} md={4}><Form.Item name={[field.name, 'deliveryMode']} label="Delivery" rules={[{ required: true, message: 'Delivery' }]}><MasterSelect master="delivery-mode" options={opts?.deliveryModes ?? []} /></Form.Item></Col>
                    <Col xs={8} md={3}>
                      <Form.Item name={[field.name, 'rateOn']} label="Rate on" rules={[{ required: true, message: 'Rate on' }]}>
                        {/* no KM on City To City (the page removed it there) */}
                        <Select options={(opts?.rateOn ?? []).filter((o) => (o.value !== 'KM' || type !== 'CITY') && (o.value !== 'CATEGORY' || !gen))} />
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={4}>
                      <Form.Item name={[field.name, 'docType']} label="Docket type">
                        <Radio.Group optionType="button" size="small" options={[{ value: '1', label: 'Doc' }, { value: '2', label: 'Non doc' }]} />
                      </Form.Item>
                    </Col>
                    {rows[i]?.rateOn === 'FTL' && (
                      <>
                        <Col xs={12} md={5}><Form.Item name={[field.name, 'ftlType']} label="FTL type" rules={[{ required: true, message: 'FTL type' }]}><MasterSelect master="container" options={opts?.ftlTypes ?? []} /></Form.Item></Col>
                        <Col xs={12} md={4}><Form.Item name={[field.name, 'loadType']} label="Load type"><Select allowClear options={opts?.loadTypes ?? []} /></Form.Item></Col>
                      </>
                    )}
                  </Row>
                  {!gen && <GeneralRateCopy form={form} fieldName={field.name} type={type} />}
                  <AmountFields prefix={[field.name]} listPrefix={['rows', field.name]} rateOn={rows[i]?.rateOn}
                    perKmPriced={isPerKmPriced(user.divCode, type, rows[i]?.rateOn)}
                    onFetchDistance={type === 'LOCATION' || isPerKmPriced(user.divCode, type, rows[i]?.rateOn) ? () => fetchDistance(field.name) : undefined} />
                  <Collapse size="small" items={[
                    { key: 'c', label: 'Charges', children: <ChargeFields prefix={[field.name]} /> },
                    ...(rows[i]?.rateOn === 'WEIGHT' ? [{
                      key: 's', label: `Weight slabs${rows[i]?.slabs?.length ? ` (${rows[i].slabs.length})` : ''}`, forceRender: true,
                      children: <><Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>Optional. A docket whose charge weight falls in a slab uses the slab rate instead of the rate above.</Typography.Paragraph><SlabFields name={[field.name, 'slabs']} /></>,
                    }] : []),
                    ...(credit && chargeSlabKinds(type, rows[i]?.rateOn, rows[i]?.deliveryMode).length ? [{
                      key: 'p', label: 'Pickup / delivery charge slabs', forceRender: true,
                      children: (
                        <>
                          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                            Optional. The docket&apos;s {rows[i]?.rateOn === 'BOX' ? 'packets' : 'charge weight'} picks the pickup / delivery charge. They apply to this route for this client (every version); leave empty to keep the current ones.
                          </Typography.Paragraph>
                          <ChargeSlabSection prefix={[field.name]} kinds={chargeSlabKinds(type, rows[i]?.rateOn, rows[i]?.deliveryMode)} rateOn={rows[i]?.rateOn} />
                        </>
                      ),
                    }] : []),
                  ]} />
                  {!gen && rows[i]?.rateOn === 'CATEGORY' && (
                    <Card size="small" type="inner" title="Category slabs (required)" style={{ marginTop: 8 }}>
                      <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                        The docket&apos;s package type, package size and charge weight pick the rate. The rate above is used when no slab matches.
                      </Typography.Paragraph>
                      <CategorySlabFields name={[field.name, 'categorySlabs']} items={opts?.items} />
                    </Card>
                  )}
                </Card>
              ))}
              <Button type="dashed" icon={<PlusOutlined />} onClick={() => add(blankRow)} block>Add another rate</Button>
            </>
          )}
        </Form.List>
      </Form>
    </Drawer>
  );
}

function EditRateForm({ book = 'CLIENT', row, opts, onClose, onSaved }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const gen = book === 'GENERAL';
  const apiBase = BOOK_API[book];
  // the list row has no slabs: load the full rate
  const { data: rate, error } = useQuery({
    queryKey: ['contract', book, row?.type, row?.id], enabled: Boolean(row), gcTime: 0,
    queryFn: () => api.get(`${apiBase}/${row.type}/${row.id}`).then((r) => r.data),
  });
  const chargeKinds = rate && !gen && rate.rateType === 'Credit' ? chargeSlabKinds(rate.type, rate.rateOn, rate.deliveryMode) : [];

  async function fetchDistance() {
    try {
      const { data } = await api.get(`${apiBase}/distance`, { params: { type: rate.type, from: rate.origin, to: rate.destination } });
      if (data.distance) form.setFieldValue('distance', data.distance);
      else message.warning('No distance in the distance master for this route — type it in');
    } catch (e) { message.error(errorMessage(e)); }
  }

  async function save() {
    let v;
    try { v = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      const { data } = await api.put(`${apiBase}/${rate.type}/${rate.id}`, {
        ...v, endDate: v.endDate.format('YYYY-MM-DD'), notificationDays: v.notificationDays ?? '',
        ...(rate.rateOn === 'WEIGHT' ? { slabs: cleanSlabs(v.slabs) } : {}),
        ...(!gen && rate.rateOn === 'CATEGORY' ? { categorySlabs: cleanCategorySlabs(v.categorySlabs) } : {}),
        ...(chargeKinds.length ? { chargeSlabs: cleanChargeSlabs(v.chargeSlabs, chargeKinds) } : {}),
        charges: Object.fromEntries(Object.entries(v.charges ?? {}).filter(([, x]) => x !== null && x !== undefined)),
      });
      message.success(data.message);
      onSaved();
    } catch (e) {
      const details = e.response?.data?.details;
      message.error(details?.length ? details.map((x) => x.message).join('; ') : errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer title={row ? `${row.entRef} · ${row.typeLabel}: ${row.originName} → ${row.destinationName} (${row.rateOn})` : ''} open={Boolean(row)} onClose={onClose}
      width={Math.min(820, window.innerWidth)} destroyOnClose extra={<Button type="primary" loading={saving} disabled={!rate} onClick={save}>Update</Button>}>
      {error && <Alert type="error" showIcon message={errorMessage(error)} />}
      {rate && (
        <Form form={form} layout="vertical" preserve={false}
          initialValues={{ ...rate, endDate: dayjs(rate.endDate), notificationDays: rate.notificationDays }}>
          <Typography.Paragraph type="secondary">
            {gen ? 'General Rate Master' : rate.rateType === 'Credit' ? `Client ${rate.clientName} · billing ${rate.billingName}` : `${rate.rateType} general rate`} · {rate.modeName} / {rate.deliveryModeName} · effective {d(rate.effectiveFrom)}.
            To change the route, rate-on or effective date, add a new rate instead.
          </Typography.Paragraph>
          <AmountFields prefix={[]} rateOn={rate.rateOn} perKmPriced={isPerKmPriced(rate.division, rate.type, rate.rateOn)}
            onFetchDistance={isPerKmPriced(rate.division, rate.type, rate.rateOn) || (rate.rateOn === 'KM' && rate.type === 'LOCATION') ? fetchDistance : undefined} />
          <ChargeFields prefix={[]} />
          {rate.rateOn === 'WEIGHT' && (
            <Card size="small" title="Weight slabs" style={{ marginBottom: 16 }}>
              <SlabFields name="slabs" />
            </Card>
          )}
          {!gen && rate.rateOn === 'CATEGORY' && (
            <Card size="small" title="Category slabs" style={{ marginBottom: 16 }}>
              <CategorySlabFields name="categorySlabs" items={opts?.items} />
            </Card>
          )}
          {chargeKinds.length > 0 && (
            <Card size="small" title="Pickup / delivery charge slabs" style={{ marginBottom: 16 }}
              extra={<Typography.Text type="secondary" style={{ fontSize: 12 }}>For this route, every version</Typography.Text>}>
              <ChargeSlabSection prefix={[]} kinds={chargeKinds} rateOn={rate.rateOn} />
            </Card>
          )}
          <Row gutter={12}>
            <Col xs={12} md={6}>
              <Form.Item name="endDate" label="End date" extra="Can only be extended" rules={[{ required: true, message: 'End date' }]}>
                <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(x) => x.isBefore(dayjs(rate.endDate), 'day')} />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}><Form.Item name="notificationDays" label="Notify days before end"><Input maxLength={3} inputMode="numeric" /></Form.Item></Col>
            <Col xs={12} md={6}><Form.Item name="active" label="Active" valuePropName="checked"><Switch /></Form.Item></Col>
          </Row>
        </Form>
      )}
    </Drawer>
  );
}

// book CLIENT: Rate/Client_Contract.aspx; book GENERAL: Rate/General_Rate_Master.aspx (the standard tariff, no client).
export default function ContractPage({ book = 'CLIENT' }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const gen = book === 'GENERAL';
  const apiBase = BOOK_API[book];
  const [clientCode, setClientCode] = useState();
  const [status, setStatus] = useState('active');
  const [expiring, setExpiring] = useState(false);
  const [type, setType] = useState('');
  const [rateType, setRateType] = useState('Credit');      // Credit: pick a client; Paid / To Pay: the general rates
  const credit = !gen && rateType === 'Credit';
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const canEdit = ['admin', 'employee'].includes(user.role);

  const { data: opts } = useQuery({ queryKey: ['contract-options', user.divCode, user.financialYear], queryFn: () => api.get('/contracts/options').then((r) => r.data) });
  const { data = [], isFetching, error } = useQuery({
    queryKey: ['contracts', book, credit ? clientCode : '', rateType, status, expiring, type, user.divCode],
    enabled: !credit || Boolean(clientCode) || expiring,
    queryFn: () => api.get(apiBase, {
      params: { client: credit ? clientCode ?? '' : '', rateType: gen ? '' : rateType, type, status, ...(expiring ? { expiringInDays: 30 } : {}) },
    }).then((r) => r.data),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['contracts'] });

  return (
    <Card className="page-card" title={gen ? 'General Rate Master' : 'Client Contract'}
      extra={canEdit && <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)} disabled={!opts}>New rates</Button>}>
      <Space wrap style={{ marginBottom: 12 }}>
        {!gen && (
          <Select value={rateType} onChange={setRateType} style={{ width: 190 }} aria-label="Rate type"
            options={opts?.rateTypes ?? [{ value: 'Credit', label: 'Credit (client contract)' }]} />
        )}
        {credit && <RemoteSelect url="/contracts/clients" value={clientCode} onChange={setClientCode} placeholder="Choose a client" style={{ width: 320 }} />}
        <Select value={type} onChange={setType} style={{ width: 190 }} options={[{ value: '', label: 'All contract types' }, ...(opts?.types ?? [])]} />
        <Radio.Group optionType="button" value={status} onChange={(e) => setStatus(e.target.value)}
          options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'all', label: 'All' }]} />
        <Switch checked={expiring} onChange={setExpiring} checkedChildren="Ending in 30 days" unCheckedChildren="Ending in 30 days" />
        <Button icon={<DownloadOutlined />} disabled={!data.length}
          onClick={() => exportCsv(`${gen ? 'general-rates' : 'client-contract'}-${dayjs().format('YYYY-MM-DD')}`, exportColumns(), data)}>
          Export to Excel
        </Button>
      </Space>
      {error && <Alert type="error" showIcon message={errorMessage(error)} style={{ marginBottom: 12 }} />}
      {credit && !clientCode && !expiring ? (
        <Alert type="info" showIcon message="Choose a client to see its rates, or switch on “Ending in 30 days” to see contracts about to end." />
      ) : (
        <Table
          size="small"
          rowKey={(r) => `${r.type}-${r.id}`}
          loading={isFetching}
          dataSource={data}
          scroll={{ x: 'max-content' }}
          pagination={{ defaultPageSize: 25, showSizeChanger: true }}
          columns={[
            { title: 'Ref', dataIndex: 'entRef' },
            { title: 'Type', dataIndex: 'typeLabel' },
            ...(gen || (credit && clientCode) ? [] : [{ title: 'Client', key: 'client', render: (_, r) => r.clientName || <Tag>{r.rateType} (general)</Tag> }]),
            ...(gen ? [] : [{ title: 'Billing', dataIndex: 'billingName' }]),
            { title: 'Route', key: 'r', render: (_, r) => `${r.originName} → ${r.destinationName}` },
            { title: 'Mode', key: 'm', render: (_, r) => `${r.modeName} / ${r.deliveryModeName}` },
            { title: 'Rate on', dataIndex: 'rateOn', render: (v, r) => (r.ftlTypeName ? `${v} (${r.ftlTypeName})` : v) },
            {
              title: 'Rate', key: 'rate', align: 'right',
              render: (_, r) => (
                <>
                  {money(r.rateOn === 'FTL' ? r.ftlRate : r.rateOn === 'FREIGHT' ? r.freight : r.rate)}
                  {r.rateOn === 'KM' && ` /km × ${r.distance} km`}
                  {r.hasSlabs && <Tag color="blue" style={{ marginLeft: 6, marginRight: 0 }}>Slabs</Tag>}
                  {r.hasChargeSlabs && <Tag color="purple" style={{ marginLeft: 6, marginRight: 0 }}>Pickup/delivery slabs</Tag>}
                </>
              ),
            },
            { title: 'Min wt', dataIndex: 'minWeight', align: 'right', render: money },
            { title: 'Min freight', dataIndex: 'minFreight', align: 'right', render: money },
            { title: 'Fuel %', key: 'fuel', align: 'right', render: (_, r) => r.charges.fuelPercent || '—' },
            { title: 'Effective', dataIndex: 'effectiveFrom', render: d },
            { title: 'Valid', key: 'v', render: (_, r) => `${d(r.startDate)} – ${d(r.endDate)}` },
            { title: 'Status', dataIndex: 'active', render: (v) => (v ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag>) },
            { title: '', key: 'a', render: (_, r) => canEdit && <Button size="small" icon={<EditOutlined />} aria-label={`Edit ${r.entRef}`} onClick={() => setEditing(r)} /> },
          ]}
        />
      )}
      <NewRatesForm book={book} open={adding} opts={opts} initialClient={clientCode} initialRateType={rateType} onClose={() => setAdding(false)}
        onSaved={(c, rt) => { setAdding(false); if (!gen) setRateType(rt ?? 'Credit'); if (c) setClientCode(c); refresh(); }} />
      <EditRateForm book={book} row={editing} opts={opts} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />
    </Card>
  );
}
