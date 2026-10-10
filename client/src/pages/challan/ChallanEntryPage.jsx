// Challan entry — replaces Operation/dispatchentry_fleet.aspx (road, "FOR MANIFEST").
// Pick the route (or destination city), the vendor and vehicle, the driver, tick the
// manifests to load and enter the hire amount. The API recomputes every total.
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  Alert, App, Button, Card, Checkbox, Col, DatePicker, Descriptions, Empty, Form, Input, InputNumber, Radio, Row, Select,
  Space, Table, Tag, TimePicker, Typography,
} from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { api, errorMessage, get } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import SearchSelect from '../../components/SearchSelect.jsx';
import MasterSelect from '../../components/masters/MasterSelect.jsx';
import { calculateChallan } from '../../../../shared/challanCalc.js';

const DATE_FMT = 'DD/MM/YYYY';
const money = (v) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fyStart(fy) {
  const y = Number(String(fy || '').split('-')[0]);
  return y ? dayjs(`${y}-04-01`) : dayjs().startOf('month');
}

/**
 * preset (opened from Docket Entry's side panel): { destinationBranch, manifestNo, date } — the route that reaches the
 * docket's destination branch is chosen (direct first, else via), manifests are listed from that date and the manifest is
 * ticked. onSaved(challanNo) after a save.
 */
export default function ChallanEntryPage({ preset = null, onSaved } = {}) {
  const { user } = useAuth();
  const { message, modal } = App.useApp();
  const [form] = Form.useForm();
  const [city, setCity] = useState(null); // { code, name } for city-wise challans
  const [selected, setSelected] = useState([]);
  const [saving, setSaving] = useState(false);

  const w = (name, fallback) => Form.useWatch(name, form) ?? fallback;
  const freightType = w('freightType', 'SUNDRY');
  const destType = w('destType', 'BRANCH');
  const routeType = w('routeType', 'DIRECT');
  const routeCode = w('routeCode');
  const vendorType = w('vendorType', 'Vendor');
  const vendorCode = w('vendorCode');
  const truckNo = w('truckNo');
  const range = w('range');
  const marketCapacity = w('capacity', 0);
  const charges = {
    labourCharge: w('labourCharge'), hireCharge: w('hireCharge'), otherCharge: w('otherCharge'),
    overloadCharge: w('overloadCharge'), deductionAmt: w('deductionAmt'), advance: w('advance'),
  };
  const isMarket = vendorType === 'Market Vendor';
  const isSelf = vendorType === 'Self';

  const { data: opts } = useQuery({ queryKey: ['challan-options'], queryFn: () => get('/challans/options') });
  const { data: routes = [] } = useQuery({
    queryKey: ['challan-routes', routeType, user.currentBranch.code],
    queryFn: () => get('/challans/routes', { routeType }),
    enabled: destType === 'BRANCH',
  });
  const { data: route } = useQuery({
    queryKey: ['challan-route', routeCode],
    queryFn: () => get(`/challans/routes/${encodeURIComponent(routeCode)}`),
    enabled: destType === 'BRANCH' && Boolean(routeCode),
  });
  const { data: vendors = [] } = useQuery({
    queryKey: ['challan-vendors', vendorType, user.divCode],
    queryFn: () => get('/challans/vendors', { vendorType }),
  });
  const { data: vehicles = [] } = useQuery({
    queryKey: ['challan-vehicles', vendorCode],
    queryFn: () => get('/challans/vehicles', { vendorCode }),
    enabled: Boolean(vendorCode) && !isMarket,
  });
  const { data: vehicle, error: vehicleError } = useQuery({
    queryKey: ['challan-vehicle', truckNo],
    queryFn: () => get(`/challans/vehicles/${encodeURIComponent(truckNo)}`),
    enabled: Boolean(truckNo) && !isMarket,
  });

  const manifestParams = useMemo(() => {
    if (!range) return null;
    const base = { from: range[0].format('YYYY-MM-DD'), to: range[1].format('YYYY-MM-DD'), freightType, destType };
    if (destType === 'BRANCH') return routeCode ? { ...base, routeCode } : null;
    return city ? { ...base, destination: city.code } : null;
  }, [range, freightType, destType, routeCode, city]);
  const { data: manifests = [], isFetching: loadingManifests, error: manifestError, refetch } = useQuery({
    queryKey: ['challan-pending', manifestParams, user.currentBranch.code],
    queryFn: () => get('/challans/pending-manifests', manifestParams),
    enabled: Boolean(manifestParams),
  });
  useEffect(() => { setSelected([]); }, [manifestParams]);

  // from Docket Entry: pick the route to the docket's destination branch
  useEffect(() => {
    if (!preset?.destinationBranch) return;
    (async () => {
      for (const routeType of ['DIRECT', 'VIA']) {
        try {
          const list = await get('/challans/routes', { routeType, toBranch: preset.destinationBranch });
          if (list.length) {
            form.setFieldsValue({ destType: 'BRANCH', freightType: 'SUNDRY', routeType, routeCode: list[0].code,
              ...(preset.date ? { range: [dayjs(preset.date), dayjs()] } : {}) });
            return;
          }
        } catch { /* try the next route type */ }
      }
      message.info(`No route from this branch reaches ${preset.destinationName || preset.destinationBranch} — choose the route`);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // …and tick the manifest made for the docket once the list is in
  useEffect(() => {
    if (preset?.manifestNo && manifests.some((m) => m.manifestNo === preset.manifestNo)) {
      setSelected((s) => (s.includes(preset.manifestNo) ? s : [...s, preset.manifestNo]));
    }
  }, [manifests, preset?.manifestNo]);

  // Self: the legacy page picked the (only) own-fleet vendor automatically.
  useEffect(() => {
    if (isSelf && vendors.length && !vendorCode) form.setFieldValue('vendorCode', vendors[0].code);
  }, [isSelf, vendors, vendorCode, form]);
  // Route time defaults to the first slot of the route.
  useEffect(() => { if (route) form.setFieldValue('routeTime', route.times[0]); }, [route, form]);
  // Own / attached vehicle: prefill the allocated driver (fillDriver).
  useEffect(() => {
    if (vehicle?.driver && !form.getFieldValue('driverName')) {
      form.setFieldsValue({ driverName: vehicle.driver.name, driverMobile: vehicle.driver.mobile });
    }
  }, [vehicle, form]);

  const chosen = manifests.filter((m) => selected.includes(m.manifestNo));
  const totals = chosen.reduce((t, m) => ({ packages: t.packages + m.packages, weight: t.weight + m.weight }), { packages: 0, weight: 0 });
  const capacity = isMarket ? Number(marketCapacity) : Number(vehicle?.capacity ?? 0);
  const overloaded = capacity > 0 && totals.weight > capacity;
  const tdsPercent = vendors.find((v) => v.code === vendorCode)?.tdsPercent ?? 0;
  const amounts = calculateChallan({ ...charges, hireCharge: isSelf ? 0 : charges.hireCharge, tdsPercent });
  useEffect(() => { if (!overloaded) form.setFieldValue('isOverload', false); }, [overloaded, form]);

  async function applyVendorRate() {
    try {
      const r = await get('/challans/vendor-rate', {
        vendorCode, weight: totals.weight, ...(destType === 'BRANCH' ? { routeCode: routeCode ?? '' } : { city: city?.code ?? '' }),
      });
      if (!r.rates.length) { message.info('No road rate in force for this vendor and route (Rate → Vendor Rate Master)'); return; }
      // prefer an FTL rate for a truck, else the first
      const pick = r.rates.find((x) => x.rateMode === 'FTL') ?? r.rates[0];
      form.setFieldValue('hireCharge', pick.hireCharge);
      message.success(`Hire charge ₹${pick.hireCharge} from the ${pick.rateMode} rate ₹${pick.unit} per ${pick.basis}${pick.basis === 'km' ? ` × ${r.km} km` : pick.basis === 'kg' ? ` × ${totals.weight} kg` : ''}`);
    } catch (e) { message.error(errorMessage(e)); }
  }

  function resetVehicle() {
    form.setFieldsValue({ vendorCode: undefined, truckNo: undefined, capacity: undefined, isOverload: false, hireCharge: 0 });
  }

  async function save() {
    let v;
    try { v = await form.validateFields(); } catch { return; }
    if (!chosen.length) { message.warning('Select at least one manifest'); return; }
    if (destType === 'CITY' && !city) { message.warning('Choose the destination city'); return; }
    setSaving(true);
    try {
      const { data } = await api.post('/challans', {
        challanDate: v.challanDate.format('YYYY-MM-DD'),
        challanTime: v.challanTime.format('HH:mm'),
        mode: 'RD',
        vendorType: v.vendorType,
        vendorCode: v.vendorCode,
        freightType: v.freightType,
        destType: v.destType,
        routeType: v.routeType,
        routeCode: v.destType === 'BRANCH' ? v.routeCode : '',
        routeTime: v.destType === 'BRANCH' ? v.routeTime : '',
        destination: v.destType === 'CITY' ? city.code : '',
        truckNo: v.truckNo,
        capacity: isMarket ? v.capacity : undefined,
        isOverload: Boolean(v.isOverload),
        driverName: v.driverName || '',
        driverMobile: v.driverMobile || '',
        dlNo: v.dlNo || '',
        driverRef: v.driverRef || '',
        secondDriverName: v.secondDriverName || '',
        secondDriverMobile: v.secondDriverMobile || '',
        secondDriverDlNo: v.secondDriverDlNo || '',
        sealNo: v.sealNo || '',
        loadedBy: v.loadedBy || '',
        deliveryDate: v.deliveryDate.format('YYYY-MM-DD'),
        deliveryTime: v.deliveryTime ? v.deliveryTime.format('HH:mm') : '',
        openingMeter: v.openingMeter || '',
        closingMeter: v.closingMeter || '',
        ewayBillNo: v.ewayBillNo || '',
        message: v.message || '',
        hireCharge: isSelf ? 0 : v.hireCharge || 0,
        labourCharge: v.labourCharge || 0,
        otherCharge: v.otherCharge || 0,
        overloadCharge: v.overloadCharge || 0,
        deductionAmt: v.deductionAmt || 0,
        advance: v.advance || 0,
        manifests: chosen.map((m) => m.manifestNo),
      });
      modal.success({
        title: 'Challan saved',
        content: <>Challan no. <strong>{data.challanNo}</strong> — {data.manifests} manifest(s), freight ₹{money(data.totals.freight)}</>,
      });
      onSaved?.(data.challanNo);
      setSelected([]);
      refetch();
    } catch (e) {
      const details = e.response?.data?.details;
      message.error(details?.length ? `${e.response.data.error}: ${details.map((d) => d.message).join('; ')}` : errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    { title: 'Manifest no.', dataIndex: 'manifestNo' },
    { title: 'Manual no.', dataIndex: 'manualNo', render: (v) => v || '—' },
    { title: 'Date', dataIndex: 'manifestDate', render: (v, r) => `${dayjs(v).format(DATE_FMT)} ${r.manifestTime}` },
    { title: 'To', dataIndex: 'to' },
    { title: 'Pkts', dataIndex: 'packages', align: 'right' },
    { title: 'Weight', dataIndex: 'weight', align: 'right', render: (v) => v.toFixed(2) },
    { title: 'Freight', dataIndex: 'freight', align: 'right', render: money },
  ];

  return (
    <div className="page-card">
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }} wrap>
        <Typography.Title level={3} style={{ margin: 0 }}>Challan Entry</Typography.Title>
        <Typography.Text type="secondary">From: {user.currentBranch.name} : {user.currentBranch.code} · number is generated on save</Typography.Text>
      </Space>

      <Form
        form={form}
        layout="vertical"
        initialValues={{
          challanDate: dayjs(), challanTime: dayjs(), deliveryDate: dayjs(), freightType: 'SUNDRY', destType: 'BRANCH',
          routeType: 'DIRECT', vendorType: 'Vendor', isOverload: false, range: [fyStart(user.financialYear), dayjs()],
          hireCharge: 0, labourCharge: 0, otherCharge: 0, overloadCharge: 0, deductionAmt: 0, advance: 0,
        }}
      >
        <Card size="small" title="Challan & route" style={{ marginBottom: 12 }}>
          <Row gutter={12}>
            <Col xs={12} md={4}>
              <Form.Item label="Challan date" name="challanDate" rules={[{ required: true }]}>
                <DatePicker format={DATE_FMT} style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
              </Form.Item>
            </Col>
            <Col xs={12} md={3}>
              <Form.Item label="Time" name="challanTime" rules={[{ required: true }]}><TimePicker format="HH:mm" style={{ width: '100%' }} /></Form.Item>
            </Col>
            <Col xs={24} md={5}>
              <Form.Item label="Freight type" name="freightType"><Radio.Group optionType="button" options={opts?.freightTypes ?? []} /></Form.Item>
            </Col>
            <Col xs={24} md={7}>
              <Form.Item label="Destination" name="destType">
                <Radio.Group optionType="button" options={opts?.destinationTypes ?? []} onChange={() => { setCity(null); form.setFieldValue('routeCode', undefined); }} />
              </Form.Item>
            </Col>
            {destType === 'BRANCH' ? (
              <>
                <Col xs={24} md={5}>
                  <Form.Item label="Route type" name="routeType">
                    <Radio.Group optionType="button" options={opts?.routeTypes ?? []} onChange={() => form.setFieldValue('routeCode', undefined)} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item label="Route" name="routeCode" rules={[{ required: true, message: 'Select route' }]}>
                    <Select showSearch optionFilterProp="label" placeholder="Select route" notFoundContent="No routes from this branch"
                      options={routes.map((r) => ({ value: r.code, label: `${r.name} (${r.code})` }))} />
                  </Form.Item>
                </Col>
                <Col xs={12} md={4}>
                  <Form.Item label="Route time" name="routeTime" rules={[{ required: true }]}>
                    <Select options={(route?.times ?? []).map((t) => ({ value: t, label: t }))} disabled={!route} />
                  </Form.Item>
                </Col>
                <Col xs={12} md={12}>
                  {route && (
                    <Form.Item label="Goes to">
                      <Typography.Text>
                        {route.destination.name} : {route.destination.code} · {route.totalKm} km
                        {route.stations.length > 1 && <> · stops: {route.stations.map((s) => s.name).join(', ')}</>}
                      </Typography.Text>
                    </Form.Item>
                  )}
                </Col>
              </>
            ) : (
              <Col xs={24} md={8}>
                <Form.Item label="Destination city" required>
                  <SearchSelect
                    placeholder="Type city name"
                    minChars={1}
                    fetcher={(q) => get('/manifests/destinations', { type: 'city', q })
                      .then((rows) => rows.map((d) => ({ ...d, value: `${d.name} : ${d.code}`, label: `${d.name} : ${d.code}` })))}
                    onPick={(o) => setCity({ code: o.code, name: o.name })}
                    onChange={(t) => { if (!t) setCity(null); }}
                    quickAdd={{
                      master: 'city',
                      toOption: (r) => {
                        const name = String(r.city_name ?? '').trim();
                        const code = String(r.city_code ?? '').trim();
                        return { value: `${name} : ${code}`, label: `${name} : ${code}`, name, code };
                      },
                    }}
                  />
                </Form.Item>
              </Col>
            )}
          </Row>
        </Card>

        <Card size="small" title="Vehicle" style={{ marginBottom: 12 }}>
          <Row gutter={12}>
            <Col xs={24} md={8}>
              <Form.Item label="Vendor type" name="vendorType">
                <Radio.Group optionType="button" options={opts?.vendorTypes ?? []} onChange={resetVehicle} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="Vendor" name="vendorCode" rules={[{ required: true, message: 'Select vendor' }]}>
                {/* market vendor not in the list: "+ New Market / Temporary Vendor" (its ledger is made with it) */}
                <MasterSelect master={isMarket ? 'temp-vendor' : undefined} placeholder="Select vendor"
                  quickInitial={{ FTLDIVISION: user.divCode, vendor_mode: 'RD' }}
                  onChange={() => form.setFieldsValue({ truckNo: undefined })}
                  options={vendors.map((v) => ({ value: v.code, label: v.name }))} />
              </Form.Item>
            </Col>
            <Col xs={12} md={4}>
              {isMarket ? (
                <Form.Item label="Vehicle no." name="truckNo" normalize={(x) => (x || '').toUpperCase().replace(/\s/g, '')}
                  rules={[{ required: true, message: 'Enter vehicle no.' }, { pattern: /^[A-Z0-9]{4,15}$/, message: 'e.g. HR55AB1234' }]}>
                  <Input placeholder="HR55AB1234" maxLength={15} />
                </Form.Item>
              ) : (
                <Form.Item label="Vehicle no." name="truckNo" rules={[{ required: true, message: 'Select vehicle' }]}>
                  <Select showSearch placeholder="Select" disabled={!vendorCode}
                    onChange={() => form.setFieldsValue({ driverName: '', driverMobile: '' })}
                    options={vehicles.map((v) => ({ value: v.truckNo, label: v.truckNo }))} />
                </Form.Item>
              )}
            </Col>
            <Col xs={12} md={4}>
              {isMarket ? (
                <Form.Item label="Capacity (kg)" name="capacity" rules={[{ required: true, message: 'Enter capacity' }]}>
                  <InputNumber min={1} style={{ width: '100%' }} />
                </Form.Item>
              ) : (
                <Form.Item label="Capacity (kg)"><Input value={vehicle ? vehicle.capacity : ''} disabled /></Form.Item>
              )}
            </Col>
          </Row>
          {vehicleError && !isMarket && (
            <Alert type="error" showIcon style={{ marginBottom: 12 }} message={`Vehicle details could not be loaded: ${errorMessage(vehicleError)}`} />
          )}
          {vehicle?.running && (
            <Alert type="warning" showIcon style={{ marginBottom: 12 }}
              message={`Truck is running from ${vehicle.running.from} to ${vehicle.running.to} against challan no. ${vehicle.running.challanNo}`} />
          )}
          {vehicle && (
            <Descriptions size="small" column={{ xs: 2, md: 5 }} style={{ marginBottom: 8 }}>
              <Descriptions.Item label="Type">{vehicle.vehicleName || '—'}</Descriptions.Item>
              <Descriptions.Item label="Make">{vehicle.make || '—'}</Descriptions.Item>
              <Descriptions.Item label="Model">{vehicle.model || '—'}</Descriptions.Item>
              <Descriptions.Item label="Engine">{vehicle.engineNo || '—'}</Descriptions.Item>
              <Descriptions.Item label="Chassis">{vehicle.chassisNo || '—'}</Descriptions.Item>
            </Descriptions>
          )}
        </Card>

        <Card size="small" title="Driver & trip" style={{ marginBottom: 12 }}>
          <Row gutter={12}>
            <Col xs={24} md={6}>
              <Form.Item label="Driver name" name="driverName" rules={[{ required: isSelf, message: 'Driver name is required' }]}>
                <SearchSelect
                  placeholder="Type driver name"
                  fetcher={(q) => get('/challans/drivers', { q }).then((rows) => rows.map((d) => ({ ...d, value: d.name, label: `${d.name} — ${d.branch}` })))}
                  onPick={(o) => { if (o.mobile) form.setFieldValue('driverMobile', o.mobile); }}
                  quickAdd={{
                    master: 'driver',
                    initial: () => ({ branch: user.currentBranch?.name, mobile_no: form.getFieldValue('driverMobile') }),
                    toOption: (r) => ({ value: String(r.Drivername ?? '').trim(), name: String(r.Drivername ?? '').trim(), mobile: String(r.mobile_no ?? '').trim() }),
                  }}
                />
              </Form.Item>
            </Col>
            <Col xs={12} md={4}>
              <Form.Item label="Mobile" name="driverMobile"
                rules={[{ required: isSelf, message: 'Mobile is required' }, { pattern: /^\d{10}$/, message: '10 digits' }]}>
                <Input maxLength={10} inputMode="numeric" />
              </Form.Item>
            </Col>
            <Col xs={12} md={4}><Form.Item label="DL no." name="dlNo"><Input maxLength={50} /></Form.Item></Col>
            <Col xs={12} md={5}><Form.Item label="Reference" name="driverRef"><Input maxLength={100} /></Form.Item></Col>
            <Col xs={12} md={5}><Form.Item label="Seal no." name="sealNo"><Input maxLength={50} /></Form.Item></Col>
            <Col xs={24} md={6}><Form.Item label="Second driver" name="secondDriverName"><Input maxLength={100} /></Form.Item></Col>
            <Col xs={12} md={4}>
              <Form.Item label="Second driver mobile" name="secondDriverMobile" rules={[{ pattern: /^\d{10}$/, message: '10 digits' }]}>
                <Input maxLength={10} inputMode="numeric" />
              </Form.Item>
            </Col>
            <Col xs={12} md={4}><Form.Item label="Second driver DL" name="secondDriverDlNo"><Input maxLength={50} /></Form.Item></Col>
            <Col xs={12} md={5}><Form.Item label="Loaded by" name="loadedBy"><Input maxLength={100} /></Form.Item></Col>
            <Col xs={12} md={5}><Form.Item label="E-way bill no." name="ewayBillNo"><Input maxLength={50} /></Form.Item></Col>
            <Col xs={12} md={4}>
              <Form.Item label="Expected delivery" name="deliveryDate" dependencies={['challanDate']}
                rules={[{ required: true }, ({ getFieldValue }) => ({
                  validator: (_, d) => (!d || !getFieldValue('challanDate') || !d.isBefore(getFieldValue('challanDate'), 'day')
                    ? Promise.resolve() : Promise.reject(new Error('Must be on or after the challan date'))),
                })]}>
                <DatePicker format={DATE_FMT} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={12} md={3}><Form.Item label="Time" name="deliveryTime"><TimePicker format="HH:mm" style={{ width: '100%' }} /></Form.Item></Col>
            <Col xs={12} md={3}><Form.Item label="Opening meter" name="openingMeter"><Input maxLength={20} /></Form.Item></Col>
            <Col xs={12} md={3}><Form.Item label="Closing meter" name="closingMeter"><Input maxLength={20} /></Form.Item></Col>
            <Col xs={24} md={11}><Form.Item label="Message" name="message"><Input maxLength={500} /></Form.Item></Col>
          </Row>
        </Card>

        <Card size="small" title="Manifests to load" style={{ marginBottom: 12 }}>
          <Space wrap style={{ marginBottom: 12 }} align="end">
            <Form.Item label="Manifest date" name="range" style={{ marginBottom: 0 }}><DatePicker.RangePicker format={DATE_FMT} allowClear={false} /></Form.Item>
          </Space>
          {manifestError && <Alert type="error" showIcon message={errorMessage(manifestError)} style={{ marginBottom: 12 }} />}
          {!manifestParams ? (
            <Empty description={destType === 'BRANCH' ? 'Select a route to list its manifests' : 'Choose the destination city'} />
          ) : (
            <Table
              size="small"
              rowKey="manifestNo"
              columns={columns}
              dataSource={manifests}
              loading={loadingManifests}
              scroll={{ x: 'max-content' }}
              pagination={{ defaultPageSize: 50, hideOnSinglePage: true }}
              rowSelection={{ selectedRowKeys: selected, onChange: setSelected }}
              locale={{ emptyText: 'No manifests waiting for dispatch' }}
            />
          )}
          <Space style={{ marginTop: 12 }} wrap>
            <Typography.Text>
              Selected <strong>{chosen.length}</strong> manifest(s) · {totals.packages} pkts · {totals.weight.toFixed(2)} kg
              {capacity > 0 && <> of {capacity} kg capacity</>}
            </Typography.Text>
            {overloaded && <Tag color="red">Overloaded by {(totals.weight - capacity).toFixed(2)} kg</Tag>}
            <Form.Item name="isOverload" valuePropName="checked" noStyle>
              <Checkbox disabled={!overloaded}>Dispatch as overloaded</Checkbox>
            </Form.Item>
          </Space>
        </Card>

        <Card size="small" title="Hire amount">
          <Row gutter={12}>
            {!isSelf && (
              <Col xs={12} md={4}>
                <Form.Item label="Hire charge" name="hireCharge"
                  extra={!isMarket && vendorCode && (
                    // ddlRateMode: the vendor's road rate in force for this route fills the hire charge
                    <Button size="small" type="link" style={{ padding: 0 }} onClick={applyVendorRate}>Use vendor rate</Button>
                  )}>
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            )}
            <Col xs={12} md={4}><Form.Item label="Labour charge" name="labourCharge"><InputNumber min={0} precision={0} style={{ width: '100%' }} /></Form.Item></Col>
            <Col xs={12} md={4}><Form.Item label="Other charge" name="otherCharge"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
            <Col xs={12} md={4}><Form.Item label="Overload charge" name="overloadCharge"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
            <Col xs={12} md={4}><Form.Item label="Deduction" name="deductionAmt"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
            <Col xs={12} md={4}>
              <Form.Item label="Advance" name="advance"
                extra={isSelf ? `Paid from CASH ${user.currentBranch.name}` : undefined}
                rules={[{ validator: (_, a) => (isSelf || !a || a <= amounts.freight ? Promise.resolve() : Promise.reject(new Error('More than total freight'))) }]}>
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Descriptions size="small" bordered column={{ xs: 1, sm: 2, md: 4 }}>
            <Descriptions.Item label="Total freight">₹{money(amounts.freight)}</Descriptions.Item>
            {!isSelf && <Descriptions.Item label={`TDS (${tdsPercent}%)`}>₹{money(amounts.tds)}</Descriptions.Item>}
            {!isSelf && <Descriptions.Item label="Vendor credit">₹{money(amounts.vendorAmount)}</Descriptions.Item>}
            {!isSelf && <Descriptions.Item label="Balance payable">₹{money(amounts.balance)}</Descriptions.Item>}
          </Descriptions>
          <div style={{ marginTop: 16, textAlign: 'right' }}>
            <Button type="primary" size="large" icon={<SaveOutlined />} onClick={save} loading={saving} disabled={!chosen.length}>
              Save challan
            </Button>
          </div>
        </Card>
      </Form>
    </div>
  );
}
