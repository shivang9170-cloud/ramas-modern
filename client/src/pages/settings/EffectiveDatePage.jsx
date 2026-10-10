// Effective date change (replaces Setting/EffectiveDateChange.aspx and ClientRateMasterEffectiveDateMmodification.aspx):
// pick client contract rates (Credit / Paid / To Pay) or PRS / DRS vendor rates and give them a new effective date.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, DatePicker, Radio, Select, Space, Table } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { api } from '../../api/client.js';
import { date, get, money, send, ymd } from './common.js';

export default function EffectiveDatePage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const [side, setSide] = useState('client');
  const [rateType, setRateType] = useState('Credit');
  const [who, setWho] = useState();
  const [scope, setScope] = useState(params.get('mode') === 'back' ? 'all' : 'upcoming');
  const [picked, setPicked] = useState([]);
  const [newDate, setNewDate] = useState(null);
  const [saving, setSaving] = useState(false);

  const clients = useQuery({ queryKey: ['eff-clients'], enabled: side === 'client', queryFn: () => get('/effective-dates/clients') }).data ?? [];
  const vendors = useQuery({ queryKey: ['eff-vendors'], enabled: side === 'vendor', queryFn: () => get('/effective-dates/vendors') }).data ?? [];
  const needsWho = side === 'vendor' || rateType === 'Credit';
  const { data = [], isFetching } = useQuery({
    queryKey: ['eff-rates', side, rateType, who, scope], enabled: !needsWho || Boolean(who),
    queryFn: () => (side === 'client'
      ? get('/effective-dates/client-rates', { rateType, client: who ?? '', scope })
      : get('/effective-dates/vendor-rates', { vendor: who, scope })),
  });

  async function save() {
    if (!newDate) { message.error('Effective date change should not be left blank'); return; }
    setSaving(true);
    const res = await send(message, () => (side === 'client'
      ? api.put('/effective-dates/client-rates', {
        rows: picked.map((k) => { const [type, id] = k.split(':'); return { type, id: Number(id) }; }), effectiveFrom: ymd(newDate),
      })
      : api.put('/effective-dates/vendor-rates', { ids: picked, effectiveDate: ymd(newDate) })));
    setSaving(false);
    if (res) { setPicked([]); queryClient.invalidateQueries({ queryKey: ['eff-rates'] }); }
  }

  const clientCols = [
    { title: 'Ref', dataIndex: 'entRef' },
    { title: 'Contract', dataIndex: 'typeLabel' },
    { title: 'Client', dataIndex: 'clientName' },
    { title: 'From', dataIndex: 'originName' },
    { title: 'To', dataIndex: 'destinationName' },
    { title: 'Mode', dataIndex: 'modeName' },
    { title: 'Rate on', dataIndex: 'rateOn' },
    { title: 'Rate', dataIndex: 'rate', align: 'right', render: money },
    { title: 'Start', dataIndex: 'startDate', render: date },
    { title: 'End', dataIndex: 'endDate', render: date },
    { title: 'Effective from', dataIndex: 'effectiveFrom', render: date },
  ];
  const vendorCols = [
    { title: 'Vendor', dataIndex: 'vendorName' },
    { title: 'Rate on', dataIndex: 'rateOn' },
    { title: 'FTL type', dataIndex: 'ftlType' },
    { title: 'Fixed km', dataIndex: 'fixKm', align: 'right' },
    { title: 'Fixed km / per km rate', dataIndex: 'fixKmRate', align: 'right', render: money },
    { title: 'Extra km', dataIndex: 'extraKmRate', align: 'right', render: money },
    { title: 'Per kg', dataIndex: 'perKg', align: 'right', render: money },
    { title: 'Effective', dataIndex: 'effectiveDate', render: date },
  ];

  return (
    <Card className="page-card" title="Effective Date Change"
      extra={(
        <Space>
          <DatePicker format="DD/MM/YYYY" placeholder="New effective date" value={newDate} onChange={setNewDate} />
          <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!picked.length} onClick={save}>Change {picked.length || ''}</Button>
        </Space>
      )}>
      <Space wrap style={{ marginBottom: 12 }}>
        <Radio.Group optionType="button" value={side} onChange={(e) => { setSide(e.target.value); setWho(undefined); setPicked([]); }}
          options={[{ value: 'client', label: 'Client' }, { value: 'vendor', label: 'Vendor (PRS / DRS)' }]} />
        {side === 'client' && (
          <Select style={{ width: 140 }} value={rateType} onChange={(v) => { setRateType(v); setWho(undefined); setPicked([]); }}
            options={['Credit', 'Paid', 'To Pay'].map((v) => ({ value: v, label: v }))} />
        )}
        {needsWho && (
          <Select showSearch optionFilterProp="label" placeholder={side === 'client' ? 'Client' : 'Vendor'} style={{ width: 300 }}
            options={side === 'client' ? clients : vendors} value={who} onChange={(v) => { setWho(v); setPicked([]); }} />
        )}
        <Radio.Group value={scope} onChange={(e) => setScope(e.target.value)}
          options={[{ value: 'upcoming', label: 'Not in force yet' }, { value: 'all', label: 'All (back-date)' }]} />
      </Space>
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message="The new date must lie between the contract's start and end dates (vendor rates: inside the financial year) and may not clash with another version of the same rate." />
      <Table size="small" rowKey={side === 'client' ? 'key' : 'id'} loading={isFetching} dataSource={data} scroll={{ x: 'max-content' }}
        rowSelection={{ selectedRowKeys: picked, onChange: setPicked }} columns={side === 'client' ? clientCols : vendorCols} />
    </Card>
  );
}
