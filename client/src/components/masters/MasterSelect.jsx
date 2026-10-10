// A drop-down of a master's records with "+ New …" at the bottom of the list (quick add, see QuickAdd.jsx).
// Typed text that matches nothing becomes the name of the new record ("+ Add “NOIDA” as new City"). After the save the
// new record is selected and the page's lists refresh.
//
//   <Form.Item name="cityCode"><MasterSelect master="city" valueField="city_code" options={cities} /></Form.Item>
//
//   master        key of the master (definitions.js): state, city, district, location, commodity, item, driver …
//   valueField    column of the new record this select stores (default: the master's key, e.g. city_code);
//                 use e.g. "city_name" where the page keeps names
//   quickInitial  object (or () => object) filled into the new record's form, e.g. { state_code: stateCode }
//   toValue       (row) => value, when the page stores something else (e.g. a number id: (r) => Number(r.ID))
//   onCreated     (row, value) after a record was added and selected
// Every other prop is the normal Ant Design Select. For users who cannot add (clients, franchisees) it is a plain Select.
import { useState } from 'react';
import { Button, Select } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { masterNoun, useQuickAdd } from './quickAddContext.js';

export default function MasterSelect({
  master, valueField, toValue, quickInitial, onCreated, popupRender, onSearch, onOpenChange, ...rest
}) {
  const quickAdd = useQuickAdd();
  const def = quickAdd.def(master);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);

  // no access to add (or disabled): the same searchable drop-down, without "+ New …"
  if (!def || rest.disabled) {
    return <Select showSearch optionFilterProp="label" popupRender={popupRender} onSearch={onSearch} onOpenChange={onOpenChange} {...rest} />;
  }

  const noun = masterNoun(def);
  const typed = search.trim();
  const nameField = def.fields.find((f) => f.name === def.nameField);

  async function add() {
    setOpen(false);
    const initial = { ...(typeof quickInitial === 'function' ? quickInitial() : quickInitial ?? {}) };
    if (typed && nameField) initial[nameField.name] = nameField.upper ? typed.toUpperCase() : typed;
    setSearch('');
    const row = await quickAdd.open(master, { initial });
    if (!row) return;
    const value = toValue ? toValue(row) : String(row[valueField || def.keyField] ?? '').trim();
    if (value === '' || value === null || value === undefined) return;
    const label = String(row[def.nameField] ?? value).trim();
    if (rest.mode === 'multiple' || rest.mode === 'tags') rest.onChange?.([...(rest.value ?? []), value], []);
    else rest.onChange?.(value, { value, label });
    onCreated?.(row, value);
  }

  return (
    <Select
      showSearch
      optionFilterProp="label"
      {...rest}
      open={open}
      onOpenChange={(o) => { setOpen(o); if (!o) setSearch(''); onOpenChange?.(o); }}
      onSearch={(t) => { setSearch(t); onSearch?.(t); }}
      popupRender={(menu) => (
        <>
          {popupRender ? popupRender(menu) : menu}
          <div className="master-quick-add">
            <Button
              type="link"
              size="small"
              icon={<PlusOutlined />}
              onMouseDown={(e) => e.preventDefault()}   // keep the focus (and the typed text) in the select
              onClick={add}
            >
              {typed ? `Add “${typed}” as new ${noun}` : `New ${noun}`}
            </Button>
          </div>
        </>
      )}
    />
  );
}
