// MIS auto mail (replaces Setting/MIS_Report_Auto.aspx): the daily MIS mail's switch, times and back days, the client
// e-mail addresses with their columns, the header / footer, and a preview of a client's mail.
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, App, Button, Card, Checkbox, Col, DatePicker, Form, Input, InputNumber, Popconfirm, Row, Select, Space, Switch, Table, Tabs,
} from 'antd';
import { PlusOutlined, SaveOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '../../api/client.js';
import { date, get, problem, send, ymd } from './common.js';

function SettingsTab() {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const { data } = useQuery({ queryKey: ['mis-settings'], queryFn: () => get('/auto-mis/settings') });
  useEffect(() => { if (data) form.setFieldsValue({ ...data, effectiveDate: data.effectiveDate ? dayjs(data.effectiveDate) : null }); }, [data, form]);
  async function save() {
    let v;
    try { v = await form.validateFields(); } catch { return; }
    await send(message, () => api.put('/auto-mis/settings', { ...v, mailTime2: v.mailTime2 ?? '', effectiveDate: ymd(v.effectiveDate) }));
  }
  return (
    <Form form={form} layout="vertical" style={{ maxWidth: 520 }}>
      <Alert type="warning" showIcon style={{ marginBottom: 12 }}
        message="Mails are not sent yet: an SMTP account has to be set in the server settings first. Everything below is saved and the Preview tab shows what each client would get." />
      <Form.Item name="active" label="Auto mail active" valuePropName="checked"><Switch /></Form.Item>
      <Row gutter={12}>
        <Col span={12}><Form.Item name="mailTime1" label="Mail time 1 (HH:mm)" rules={[{ required: true, pattern: /^([01]\d|2[0-3]):[0-5]\d$/, message: 'Enter the time as HH:mm' }]}><Input /></Form.Item></Col>
        <Col span={12}><Form.Item name="mailTime2" label="Mail time 2 (HH:mm)" rules={[{ pattern: /^([01]\d|2[0-3]):[0-5]\d$/, message: 'Enter the time as HH:mm' }]}><Input /></Form.Item></Col>
        <Col span={12}><Form.Item name="effectiveDate" label="Active / inactive from"><DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} /></Form.Item></Col>
        <Col span={12}><Form.Item name="backDays" label="Dockets of the last (days)" rules={[{ required: true, message: 'Enter the days' }]}><InputNumber min={0} max={365} style={{ width: '100%' }} /></Form.Item></Col>
      </Row>
      <Button type="primary" icon={<SaveOutlined />} onClick={save}>Save</Button>
    </Form>
  );
}

function EmailsTab() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const columns = useQuery({ queryKey: ['mis-columns'], queryFn: () => get('/auto-mis/columns') }).data ?? [];
  const clients = useQuery({ queryKey: ['mis-clients'], queryFn: () => get('/auto-mis/clients') }).data ?? [];
  const { data = [], isFetching } = useQuery({ queryKey: ['mis-emails'], queryFn: () => get('/auto-mis/emails') });
  const [client, setClient] = useState();
  const [picked, setPicked] = useState(null);
  const [list, setList] = useState([]);
  const [emails, setEmails] = useState(['', '']);
  const chosen = picked ?? columns.map((c) => c.value);

  async function save() {
    const res = await send(message, () => api.post('/auto-mis/emails', { clients: list, emails: emails.map((e) => e.trim()).filter(Boolean) }));
    if (res) { setList([]); setEmails(['', '']); queryClient.invalidateQueries({ queryKey: ['mis-emails'] }); }
  }
  return (
    <>
      <Space wrap align="start" style={{ marginBottom: 12 }}>
        <Select showSearch optionFilterProp="label" placeholder="Client" style={{ width: 300 }} options={clients} value={client} onChange={setClient} />
        <Button icon={<PlusOutlined />} disabled={!client} onClick={() => {
          if (list.some((x) => x.client === client)) { message.error('Client already added'); return; }
          setList([...list, { client, columns: chosen }]); setClient(undefined);
        }}>Add client</Button>
      </Space>
      <Checkbox.Group value={chosen} onChange={setPicked} style={{ marginBottom: 12 }}
        options={columns.map((c) => ({ value: c.value, label: c.label, disabled: c.fixed }))} />
      {list.length > 0 && (
        <Table size="small" rowKey="client" dataSource={list} pagination={false} style={{ marginBottom: 12 }}
          columns={[
            { title: 'Client', dataIndex: 'client', render: (v) => clients.find((c) => c.value === v)?.label ?? v },
            { title: 'Columns', dataIndex: 'columns', render: (v) => v.map((x) => columns.find((c) => c.value === x)?.label).join(', ') },
            { title: '', key: 'x', render: (_, r) => <Button size="small" danger onClick={() => setList(list.filter((x) => x !== r))}>Remove</Button> },
          ]} />
      )}
      <Space wrap style={{ marginBottom: 16 }}>
        <Input placeholder="E-mail 1" style={{ width: 240 }} value={emails[0]} onChange={(e) => setEmails([e.target.value, emails[1]])} />
        <Input placeholder="E-mail 2" style={{ width: 240 }} value={emails[1]} onChange={(e) => setEmails([emails[0], e.target.value])} />
        <Button type="primary" icon={<SaveOutlined />} disabled={!list.length} onClick={save}>Save</Button>
      </Space>
      <Table size="small" rowKey="id" loading={isFetching} dataSource={data}
        columns={[
          { title: 'Client', dataIndex: 'clientName' },
          { title: 'E-mail', dataIndex: 'email' },
          { title: 'Columns', dataIndex: 'columnNames', render: (v) => v.join(', ') },
          {
            title: '', key: 'x',
            render: (_, r) => (
              <Popconfirm title="Remove this e-mail?" onConfirm={async () => { if (await send(message, () => api.delete(`/auto-mis/emails/${r.id}`))) queryClient.invalidateQueries({ queryKey: ['mis-emails'] }); }}>
                <Button size="small" danger>Remove</Button>
              </Popconfirm>
            ),
          },
        ]} />
    </>
  );
}

function HeaderFooterTab() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [header, setHeader] = useState('');
  const [footer, setFooter] = useState('');
  const { data = [] } = useQuery({ queryKey: ['mis-hf'], queryFn: () => get('/auto-mis/header-footer') });
  return (
    <>
      <Space direction="vertical" style={{ width: '100%', maxWidth: 640, marginBottom: 12 }}>
        <Input.TextArea rows={3} placeholder="Header" value={header} onChange={(e) => setHeader(e.target.value)} />
        <Input.TextArea rows={3} placeholder="Footer" value={footer} onChange={(e) => setFooter(e.target.value)} />
        <Button type="primary" icon={<SaveOutlined />} onClick={async () => {
          if (await send(message, () => api.post('/auto-mis/header-footer', { header, footer }))) { setHeader(''); setFooter(''); queryClient.invalidateQueries({ queryKey: ['mis-hf'] }); }
        }}>Save</Button>
      </Space>
      <Table size="small" rowKey="id" dataSource={data} columns={[
        { title: 'Header', dataIndex: 'header' }, { title: 'Footer', dataIndex: 'footer' },
        { title: 'By', dataIndex: 'createdBy' }, { title: 'On', dataIndex: 'createdDate', render: date },
      ]} />
    </>
  );
}

function PreviewTab() {
  const { message } = App.useApp();
  const clients = useQuery({ queryKey: ['mis-clients'], queryFn: () => get('/auto-mis/clients') }).data ?? [];
  const [client, setClient] = useState();
  const [data, setData] = useState(null);
  async function load(v) {
    setClient(v);
    try { setData(await get('/auto-mis/preview', { client: v })); } catch (e) { message.error(problem(e)); }
  }
  return (
    <>
      <Select showSearch optionFilterProp="label" placeholder="Client" style={{ width: 300, marginBottom: 12 }} options={clients} value={client} onChange={load} />
      {data && (
        <Table size="small" rowKey="docketNo" dataSource={data.rows} scroll={{ x: 'max-content' }}
          title={() => `${data.clientName} — dockets of the last ${data.backDays} day(s)`}
          columns={data.columns.map((c) => ({ title: c.title, dataIndex: c.key, render: ['bookingDate', 'statusDate'].includes(c.key) ? date : undefined }))} />
      )}
    </>
  );
}

export default function AutoMisPage() {
  return (
    <Card className="page-card" title="MIS Auto Mail">
      <Tabs items={[
        { key: 'settings', label: 'Settings', children: <SettingsTab /> },
        { key: 'emails', label: 'Client e-mails', children: <EmailsTab /> },
        { key: 'hf', label: 'Header / footer', children: <HeaderFooterTab /> },
        { key: 'preview', label: 'Preview', children: <PreviewTab /> },
      ]} />
    </Card>
  );
}
