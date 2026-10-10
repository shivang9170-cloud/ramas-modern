// Change docket financial year (replaces Setting/ChangeDocket_FY.aspx): dockets of last year still moving are brought
// into the login year, stage by stage (booking, manifest, challan, arrival, DRS, DRS challan, billing).
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, DatePicker, Popconfirm, Select, Space, Table } from 'antd';
import dayjs from 'dayjs';
import { api } from '../../api/client.js';
import { date, get, send, ymd } from './common.js';

export default function DocketFyPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const meta = useQuery({ queryKey: ['fy-stages'], queryFn: () => get('/docket-fy/stages') }).data;
  const [stage, setStage] = useState('booking');
  const [range, setRange] = useState(null);
  const [picked, setPicked] = useState([]);
  const [saving, setSaving] = useState(false);
  const from = range?.[0] ? ymd(range[0]) : meta?.from;
  const to = range?.[1] ? ymd(range[1]) : meta?.to;
  const { data, isFetching } = useQuery({
    queryKey: ['fy-pending', stage, from, to], enabled: Boolean(meta), queryFn: () => get('/docket-fy/pending', { stage, from, to }),
  });

  async function move() {
    setSaving(true);
    const res = await send(message, () => api.post('/docket-fy/move', { stage, from, to, dockets: picked }));
    setSaving(false);
    if (res) { setPicked([]); queryClient.invalidateQueries({ queryKey: ['fy-pending'] }); }
  }

  return (
    <Card className="page-card" title="Change Docket Financial Year"
      extra={(
        <Popconfirm title={`Move ${picked.length} docket(s) to ${meta?.current}?`} onConfirm={move} disabled={!picked.length}>
          <Button type="primary" loading={saving} disabled={!picked.length}>Move to {meta?.current}</Button>
        </Popconfirm>
      )}>
      <Space wrap style={{ marginBottom: 12 }}>
        <Select style={{ width: 260 }} value={stage} options={meta?.stages ?? []} onChange={(v) => { setStage(v); setPicked([]); }} />
        <DatePicker.RangePicker format="DD/MM/YYYY" value={range ?? (meta ? [dayjs(meta.from), dayjs(meta.to)] : null)} onChange={setRange} />
      </Space>
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message={`Dockets of ${meta?.previous ?? 'last year'} still pending in the chosen stage. Moving them changes the stage's rows (and a challan's account entries) to ${meta?.current ?? 'the login year'}.`} />
      <Table size="small" rowKey="docketNo" loading={isFetching} dataSource={data?.dockets ?? []} scroll={{ x: 'max-content' }}
        rowSelection={{ selectedRowKeys: picked, onChange: setPicked }} pagination={{ defaultPageSize: 50 }}
        columns={[
          { title: 'Docket', dataIndex: 'docketNo' },
          { title: 'Booked', dataIndex: 'bookingDate', render: date },
          { title: 'Mode', dataIndex: 'mode' },
          { title: 'Origin', dataIndex: 'origin' },
          { title: 'Destination', dataIndex: 'destination' },
          { title: 'Type', dataIndex: 'bookingType' },
          { title: 'Consignor', dataIndex: 'consignor' },
          { title: 'Consignee', dataIndex: 'consignee' },
          { title: 'FY', dataIndex: 'financialYear' },
        ]} />
    </Card>
  );
}
