// Export / import details of a docket (docket_international). Shown only when the docket is booked as Export or Import
// (and the division allows international). Countries, ports, currencies and carriers come from their masters — each
// drop-down offers "+ New …" to users who may add to that master.
//   * picking the country abroad suggests its currency; picking a currency fills its rate to rupees (editable)
//   * the rupee value of the invoice is worked out as you type
import { useQuery } from '@tanstack/react-query';
import { Card, Col, DatePicker, Form, Input, InputNumber, Row, Select, Typography } from 'antd';
import { GlobalOutlined } from '@ant-design/icons';
import { get } from '../../api/client.js';
import MasterSelect from '../../components/masters/MasterSelect.jsx';

const DATE_FMT = 'DD/MM/YYYY';
const P = (name) => ['international', name];

export default function InternationalCard({ form, type, readOnly }) {
  const { data: o } = useQuery({ queryKey: ['docket-international-options'], queryFn: () => get('/dockets/lookup/international'), staleTime: 5 * 60_000 });
  const isExport = type === 'EXPORT';
  const abroadField = isExport ? 'destinationCountry' : 'originCountry';
  const abroad = Form.useWatch(P(abroadField), form);
  const currency = Form.useWatch(P('currency'), form);
  const rate = Form.useWatch(P('exchangeRate'), form);
  const value = Form.useWatch(P('invoiceValueFc'), form);
  const inr = (Number(value) || 0) * (Number(rate) || 0);

  // ports of the country abroad on the foreign side, Indian ports on ours
  const ports = (country) => (o?.ports ?? []).filter((p) => !country || p.country === country);
  const foreignPorts = ports(abroad);
  const indianPorts = ports('IN');

  function onCountry(code) {
    const c = o?.countries.find((x) => x.value === code);
    if (c?.currency && !form.getFieldValue(P('currency'))) onCurrency(c.currency, true);
  }
  function onCurrency(code, set = false) {
    const cur = o?.currencies.find((x) => x.value === code);
    form.setFieldValue(P('exchangeRate'), cur?.rate ?? form.getFieldValue(P('exchangeRate')));
    if (set) form.setFieldValue(P('currency'), code);
  }

  const party = isExport ? 'Consignee abroad' : 'Shipper abroad';

  return (
    <Card size="small" style={{ marginBottom: 12 }}
      title={<><GlobalOutlined /> {isExport ? 'Export' : 'Import'} details</>}>
      <Row gutter={12}>
        <Col xs={12} md={6}>
          <Form.Item label={isExport ? 'Destination country' : 'Origin country'} name={P(abroadField)}
            rules={[{ required: true, message: 'Select the country' }]}>
            <MasterSelect master="country" valueField="CountryCode" options={(o?.countries ?? []).filter((c) => c.value !== 'IN')}
              disabled={readOnly} onChange={onCountry} />
          </Form.Item>
        </Col>
        <Col xs={12} md={6}>
          <Form.Item label={isExport ? 'Port of loading (India)' : 'Port of loading (abroad)'} name={P('originPort')}>
            <MasterSelect master="port" allowClear options={isExport ? indianPorts : foreignPorts} disabled={readOnly}
              quickInitial={isExport ? { CountryCode: 'IN' } : { CountryCode: abroad }} />
          </Form.Item>
        </Col>
        <Col xs={12} md={6}>
          <Form.Item label={isExport ? 'Port of discharge (abroad)' : 'Port of discharge (India)'} name={P('destinationPort')}>
            <MasterSelect master="port" allowClear options={isExport ? foreignPorts : indianPorts} disabled={readOnly}
              quickInitial={isExport ? { CountryCode: abroad } : { CountryCode: 'IN' }} />
          </Form.Item>
        </Col>
        <Col xs={12} md={6}>
          <Form.Item label="Airline / shipping line" name={P('carrierCode')}>
            <MasterSelect master="carrier" allowClear options={o?.carriers ?? []} disabled={readOnly} />
          </Form.Item>
        </Col>
        <Col xs={12} md={6}><Form.Item label="MAWB / ocean BL no." name={P('mawbNo')}><Input maxLength={30} disabled={readOnly} /></Form.Item></Col>
        <Col xs={12} md={6}><Form.Item label="HAWB / house BL no." name={P('hawbNo')}><Input maxLength={30} disabled={readOnly} /></Form.Item></Col>
        <Col xs={12} md={6}><Form.Item label="Flight / voyage" name={P('flightVoyage')}><Input maxLength={30} disabled={readOnly} /></Form.Item></Col>
        <Col xs={12} md={6}>
          <Form.Item label="Incoterm" name={P('incoterm')}>
            <Select allowClear disabled={readOnly} options={(o?.incoterms ?? []).map((x) => ({ value: x, label: x }))} />
          </Form.Item>
        </Col>
        <Col xs={12} md={6}>
          <Form.Item label="Invoice currency" name={P('currency')} rules={[{ required: true, message: 'Select the currency' }]}>
            <MasterSelect master="currency" valueField="CurrencyCode" options={o?.currencies ?? []} disabled={readOnly}
              onChange={(v) => onCurrency(v)} onCreated={(r) => form.setFieldValue(P('exchangeRate'), Number(r.RateToINR) || 1)} />
          </Form.Item>
        </Col>
        <Col xs={12} md={6}>
          <Form.Item label={`Rate (1 ${currency || 'unit'} = Rs.)`} name={P('exchangeRate')}>
            <InputNumber min={0} step={0.01} style={{ width: '100%' }} disabled={readOnly} />
          </Form.Item>
        </Col>
        <Col xs={12} md={6}>
          <Form.Item label={`Invoice value${currency ? ` (${currency})` : ''}`} name={P('invoiceValueFc')}
            rules={[{ required: true, message: 'Enter the invoice value' }]}
            extra={inr ? `= Rs. ${inr.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : undefined}>
            <InputNumber min={0} step={1} style={{ width: '100%' }} disabled={readOnly} />
          </Form.Item>
        </Col>
        <Col xs={12} md={6}>
          <Form.Item label="HS code" name={P('hsCode')} rules={[{ pattern: /^$|^\d{4,12}$/, message: '4–12 digits' }]}>
            <Input maxLength={12} disabled={readOnly} />
          </Form.Item>
        </Col>
        <Col xs={12} md={6}>
          <Form.Item label="IEC no." name={P('iecNo')} normalize={(v) => v?.toUpperCase()}
            rules={[{ pattern: /^$|^[A-Z0-9]{10}$/i, message: '10 characters' }]}>
            <Input maxLength={10} disabled={readOnly} />
          </Form.Item>
        </Col>
        <Col xs={12} md={6}>
          <Form.Item label={isExport ? 'Shipping bill no.' : 'Bill of entry no.'} name={P('customsDocNo')}><Input maxLength={30} disabled={readOnly} /></Form.Item>
        </Col>
        <Col xs={12} md={6}>
          <Form.Item label={isExport ? 'Shipping bill date' : 'Bill of entry date'} name={P('customsDocDate')}>
            <DatePicker format={DATE_FMT} style={{ width: '100%' }} disabled={readOnly} />
          </Form.Item>
        </Col>
      </Row>
      <Typography.Text strong>{party}</Typography.Text>
      <Row gutter={12} style={{ marginTop: 6 }}>
        <Col xs={24} md={8}>
          <Form.Item label="Name" name={P('overseasName')} normalize={(v) => v?.toUpperCase()} rules={[{ required: true, whitespace: true, message: `Enter the ${party.toLowerCase()}` }]}>
            <Input maxLength={200} disabled={readOnly} />
          </Form.Item>
        </Col>
        <Col xs={24} md={16}><Form.Item label="Address" name={P('overseasAddress')}><Input maxLength={500} disabled={readOnly} /></Form.Item></Col>
        <Col xs={12} md={6}><Form.Item label="City" name={P('overseasCity')} normalize={(v) => v?.toUpperCase()}><Input maxLength={60} disabled={readOnly} /></Form.Item></Col>
        <Col xs={12} md={6}><Form.Item label="ZIP / postal code" name={P('overseasZip')}><Input maxLength={15} disabled={readOnly} /></Form.Item></Col>
        <Col xs={12} md={6}><Form.Item label="Phone" name={P('overseasPhone')}><Input maxLength={30} disabled={readOnly} /></Form.Item></Col>
        <Col xs={12} md={6}>
          <Form.Item label="E-mail" name={P('overseasEmail')} rules={[{ type: 'email', message: 'Invalid e-mail' }]}><Input maxLength={100} disabled={readOnly} /></Form.Item>
        </Col>
      </Row>
    </Card>
  );
}
