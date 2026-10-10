// Sub-ledger building blocks shared by Account Master and the accounts entry screens:
//   AddSubLedgerModal     "+ Sub-Ledger": create a ledger under a main ledger (POST /api/account-ledgers/:code/sub-ledgers)
//   MainSubLedgerFields   two form fields - Main Ledger -> Sub-Ledger - with the same "+ Sub-Ledger" button next to them
import { useEffect, useState } from 'react';
import { App, Button, Form, Input, InputNumber, Modal, Select, Space } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { api, errorMessage } from '../../api/client.js';

const upper = { style: { textTransform: 'uppercase' } };

export function AddSubLedgerModal({ main, onClose, onCreated, showOpening = false }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (main) form.resetFields(); }, [main, form]);

  async function save() {
    let v;
    try { v = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      const { data } = await api.post(`/account-ledgers/${main.code}/sub-ledgers`, { name: v.name, openingBal: v.openingBal || 0 });
      message.success(data.message);
      onCreated(data);
    } catch (e) {
      const details = e.response?.data?.details;
      message.error(details?.length ? details.map((d) => d.message).join('; ') : errorMessage(e));
    } finally { setSaving(false); }
  }

  return (
    <Modal open={Boolean(main)} onCancel={onClose} title={`New Sub-Ledger under ${main?.name ?? ''}`} okText="Create" confirmLoading={saving}
      onOk={save} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={save}>
        <Form.Item name="name" label="Sub-ledger name" rules={[{ required: true, min: 2, message: 'Enter the sub-ledger name' }]}>
          <Input maxLength={100} {...upper} placeholder="e.g. STATIONERY" autoFocus onPressEnter={save} />
        </Form.Item>
        {showOpening && (
          <Form.Item name="openingBal" label="Opening balance">
            <InputNumber min={-9999999999} max={9999999999} step={100} style={{ width: '100%' }} />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}

/**
 * Main Ledger -> Sub-Ledger inside a parent <Form>. mains: [{ value, label, subs: [{ value, label, balance }] }].
 * onCreated(code) is called after "+ Sub-Ledger" so the parent can reload `mains`; the new sub-ledger is selected.
 */
export function MainSubLedgerFields({ form, mains = [], onCreated, required = true }) {
  const mainCode = Form.useWatch('mainLedger', form);
  const [adding, setAdding] = useState(null);
  const main = mains.find((m) => m.value === mainCode);
  const subs = main?.subs ?? [];

  return (
    <>
      <Form.Item name="mainLedger" label="Main Ledger" rules={required ? [{ required: true, message: 'Select the main ledger' }] : []}>
        <Select showSearch optionFilterProp="label" placeholder="e.g. OFFICE EXPENSES" options={mains.map(({ value, label }) => ({ value, label }))}
          onChange={() => form.setFieldsValue({ subLedger: undefined })}
          notFoundContent="No main ledger yet - create one in Account Master" />
      </Form.Item>
      <Form.Item label="Sub-Ledger" required={required}>
        <Space.Compact style={{ width: '100%' }}>
          <Form.Item name="subLedger" noStyle rules={required ? [{ required: true, message: 'Select the sub-ledger' }] : []}>
            <Select showSearch optionFilterProp="label" disabled={!mainCode} style={{ width: '100%' }}
              placeholder={mainCode ? (subs.length ? 'Select sub-ledger' : 'No sub-ledger yet - add one') : 'Select the main ledger first'}
              options={subs.map((x) => ({ value: x.value, label: x.label }))} />
          </Form.Item>
          <Button icon={<PlusOutlined />} disabled={!mainCode} onClick={() => setAdding({ code: main.value, name: main.label })}>Sub-Ledger</Button>
        </Space.Compact>
      </Form.Item>
      <AddSubLedgerModal main={adding} onClose={() => setAdding(null)}
        onCreated={(data) => { setAdding(null); form.setFieldsValue({ subLedger: data.code }); onCreated?.(data.code); }} />
    </>
  );
}
