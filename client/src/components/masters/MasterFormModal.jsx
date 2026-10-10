// The add / edit form of a simple master (server: modules/masters/definitions.js), in a modal. Used by the master
// screen itself (pages/masters/MasterPage.jsx) and by quick add from any drop-down (QuickAdd.jsx).
//   * a new record opens with the defaults, the next free code (autoCode) and any `initial` values
//   * fields with autofill fill their related fields (City -> State + Branch, GSTIN -> State …)
//   * drop-downs of other masters offer "+ New …" (MasterSelect), so a missing State / District is added right there
//   * "Save & New" (allowSaveNew) keeps the form open for the next record with the same drop-down choices
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App, Button, Checkbox, Form, Input, InputNumber, Modal, Radio, Select, Typography,
} from 'antd';
import { api, errorMessage } from '../../api/client.js';
import MasterSelect from './MasterSelect.jsx';
import { carryOver, useQuickAdd } from './quickAddContext.js';

const isOn = (field, v) => v === true || v === 1 || v === '1' || v === field.yes || v === 'true';

function FieldOptions({ masterKey, field, form, ...rest }) {
  const quickAdd = useQuickAdd();
  const { data = [], isLoading } = useQuery({
    queryKey: ['master-options', masterKey, field.name],
    queryFn: () => api.get(`/masters/${masterKey}/options/${field.name}`).then((r) => r.data),
    staleTime: 5 * 60_000,
  });
  const options = data.map((o) => {
    const v = String(o.value).trim();
    const l = String(o.label ?? v).trim();
    return { value: v, label: l === v ? l : `${l} (${v})` };
  });
  const common = { ...rest, loading: isLoading, showSearch: true, allowClear: !field.required, optionFilterProp: 'label', options };
  if (!field.quickAdd) return <Select {...common} />;
  return (
    <MasterSelect
      {...common}
      master={field.quickAdd}
      valueField={field.quickValue}
      quickInitial={() => carryOver(form.getFieldsValue(), quickAdd.def(field.quickAdd))}
    />
  );
}

// `rest` carries value/checked/onChange/id injected by Form.Item — it must reach the control.
function FieldInput({ masterKey, field, def, editing, form, ...rest }) {
  const disabled = editing && field.createOnly;
  switch (field.type) {
    case 'select': return <FieldOptions {...rest} masterKey={masterKey} field={field} form={form} disabled={disabled} />;
    case 'status': return <Radio.Group {...rest} options={def.statusValues} optionType="button" disabled={disabled} />;
    case 'textarea': return <Input.TextArea {...rest} rows={3} maxLength={field.max} showCount={Boolean(field.max)} disabled={disabled} />;
    case 'number': return <InputNumber {...rest} min={field.min} style={{ width: '100%' }} disabled={disabled} />;
    case 'checkbox': return <Checkbox {...rest} disabled={disabled}>{field.label}</Checkbox>;
    default:
      return (
        <Input
          {...rest}
          maxLength={field.max}
          disabled={disabled}
          style={field.upper ? { textTransform: 'uppercase' } : undefined}
        />
      );
  }
}

/**
 * masterKey, def      the master and its public definition (GET /api/masters/:key or /api/masters)
 * row                 the record to edit, or null for a new one
 * initial             values for a new record (quick add: the typed name, the state already picked …)
 * open, onClose       visibility
 * onSaved(row, { next })   after a save; next = "Save & New" (the form stays open, ready for the next record)
 * allowSaveNew        show "Save & New"
 * title               default: "Add <title>" / "Edit <title>"
 */
export default function MasterFormModal({ masterKey, def, row = null, initial, open, onClose, onSaved, allowSaveNew = false, title }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [filled, setFilled] = useState([]);   // labels of the fields the last autofill set
  const addNext = useRef(false);
  const autofillSeq = useRef(0);
  const suggested = useRef('');   // the code last suggested from the name (replaced while the user has not typed his own)
  const locked = useRef(new Set()); // fields handed in by the page (e.g. the employee's branch): autofill leaves them alone
  const codeSeq = useRef(0);
  const editing = row !== null && row !== undefined;

  // autoCode 'number': next free number (D004 …) once; 'name': from the name typed (NOIDA -> NOI), while the code box
  // is empty or still holds the previous suggestion
  async function suggestCode(name) {
    if (editing || !def.autoCode) return;
    const current = form.getFieldValue(def.keyField);
    if (current && current !== suggested.current) return;
    if (def.autoCode === 'name' && !String(name ?? '').trim()) return;
    const seq = ++codeSeq.current;
    try {
      const { data: next } = await api.get(`/masters/${masterKey}/next-code`, { params: def.autoCode === 'name' ? { name } : {} });
      const now = form.getFieldValue(def.keyField);
      if (seq !== codeSeq.current || !next.code || (now && now !== suggested.current)) return;
      suggested.current = next.code;
      form.setFieldsValue({ [def.keyField]: next.code });
    } catch { /* the user types the code */ }
  }

  // A new record: defaults, `initial`, and (after "Save & New") the drop-down / status / tick choices just used.
  async function start(previous) {
    form.resetFields();
    setFilled([]);
    if (editing) {
      const values = {};
      for (const f of def.fields) {
        const v = row[f.name];
        values[f.name] = f.type === 'checkbox' ? isOn(f, v) : (typeof v === 'string' ? v.trim() : v);
      }
      form.setFieldsValue(values);
      return;
    }
    const values = {};
    for (const f of def.fields) {
      if (f.type === 'status') values[f.name] = def.statusValues[0];
      if (f.type === 'checkbox') values[f.name] = f.default ?? f.name === 'IsActive';
      else if (f.default !== undefined) values[f.name] = f.default;
      if (previous && ['select', 'status', 'checkbox'].includes(f.type) && previous[f.name] !== undefined) values[f.name] = previous[f.name];
    }
    locked.current = new Set();
    for (const [k, v] of Object.entries(initial ?? {})) {
      if (v === undefined || v === null || v === '') continue;
      values[k] = v;
      if (k !== def.nameField) locked.current.add(k);
    }
    form.setFieldsValue(values);
    suggested.current = '';
    suggestCode(def.nameField ? values[def.nameField] : '');
    // a value handed in for a field with autofill (e.g. the city) fills its related fields too
    const changed = Object.fromEntries(def.fields.filter((f) => f.hasAutofill && values[f.name]).map((f) => [f.name, values[f.name]]));
    if (Object.keys(changed).length) onValuesChange(changed, true);
  }

  useEffect(() => {
    if (open && def) start();
  }, [open, def?.key, row]); // eslint-disable-line react-hooks/exhaustive-deps

  // A field with autofill (City -> State + Branch …): fill the related fields from the server.
  async function onValuesChange(changed, onlyEmpty = false) {
    if (def.autoCode === 'name' && def.nameField && def.nameField in changed) suggestCode(changed[def.nameField]);
    for (const [name, value] of Object.entries(changed)) {
      const f = def.fields.find((x) => x.name === name);
      if (!f?.hasAutofill) continue;
      const seq = ++autofillSeq.current;
      try {
        const { data: values } = await api.get(`/masters/${masterKey}/autofill/${encodeURIComponent(name)}`, { params: { v: value ?? '' } });
        if (seq !== autofillSeq.current || !values) continue;
        const set = Object.fromEntries(Object.entries(values)
          .filter(([k]) => !locked.current.has(k) && (!onlyEmpty || !form.getFieldValue(k))));
        if (!Object.keys(set).length) continue;
        form.setFieldsValue(set);
        setFilled(def.fields.filter((x) => x.name in set).map((x) => x.label));
      } catch { /* nothing filled */ }
    }
  }

  const save = useMutation({
    mutationFn: async (values) => {
      const body = { ...values };
      for (const f of def.fields) if (f.type === 'checkbox') body[f.name] = values[f.name] ? f.yes : f.no;
      if (editing) return api.put(`/masters/${masterKey}/${encodeURIComponent(String(row[def.keyField]).trim())}`, body);
      return api.post(`/masters/${masterKey}`, body);
    },
    onSuccess: (res) => {
      message.success(editing ? 'Record updated' : `${def.title}: record added`);
      queryClient.invalidateQueries({ queryKey: ['master', masterKey] });
      queryClient.invalidateQueries({ queryKey: ['master-options'] });
      const next = !editing && addNext.current;
      addNext.current = false;
      const previous = form.getFieldsValue();
      onSaved?.(res.data, { next });
      if (next) start(previous);
    },
    onError: (err) => {
      addNext.current = false;
      const details = err.response?.data?.details;
      if (Array.isArray(details) && details.some((d) => d.path)) {
        form.setFields(details.filter((d) => d.path).map((d) => ({ name: d.path, errors: [d.message] })));
      }
      message.error(errorMessage(err));
    },
  });

  if (!def) return null;

  return (
    <Modal
      title={title ?? (editing ? `Edit ${def.title}` : `Add ${def.title}`)}
      open={open}
      onCancel={onClose}
      forceRender
      footer={[
        <Button key="cancel" onClick={onClose}>Cancel</Button>,
        allowSaveNew && !editing && (
          <Button key="next" loading={save.isPending && addNext.current} onClick={() => { addNext.current = true; form.submit(); }}>
            Save &amp; New
          </Button>
        ),
        <Button key="save" type="primary" loading={save.isPending && !addNext.current} onClick={() => { addNext.current = false; form.submit(); }}>
          Save
        </Button>,
      ]}
    >
      <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)} onValuesChange={(changed) => onValuesChange(changed)}>
        {def.fields.map((f) => (
          <Form.Item
            key={f.name}
            name={f.name}
            label={f.type === 'checkbox' ? undefined : f.label}
            valuePropName={f.type === 'checkbox' ? 'checked' : 'value'}
            rules={f.required ? [{ required: true, whitespace: true, message: `${f.label} is required` }] : []}
            normalize={f.upper ? (v) => (typeof v === 'string' ? v.toUpperCase() : v) : undefined}
            extra={editing && f.createOnly ? 'Cannot be changed' : undefined}
          >
            <FieldInput masterKey={masterKey} field={f} def={def} editing={editing} form={form} />
          </Form.Item>
        ))}
      </Form>
      {filled.length > 0 && (
        <Typography.Text type="success" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
          Filled automatically: {filled.join(', ')} — change if needed
        </Typography.Text>
      )}
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>Legacy page: {def.legacyPage}</Typography.Text>
    </Modal>
  );
}
