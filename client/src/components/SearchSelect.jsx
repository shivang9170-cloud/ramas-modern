// Debounced server-side search box (replaces AjaxControlToolkit AutoCompleteExtender).
import { useEffect, useRef, useState } from 'react';
import { AutoComplete, Button, Input, Spin } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { masterNoun, useQuickAdd } from './masters/quickAddContext.js';

/**
 * props:
 *   fetcher(term) -> Promise<Array<{ value, label, ...data }>>
 *   onPick(option)  called with the chosen option (full object)
 *   value/onChange  controlled text value (works inside Form.Item)
 *   quickAdd        optional { master, toOption(row) -> option, initial } — "+ Add “typed” as new …" under the list
 *                   (components/masters/QuickAdd.jsx); the new record is then picked like a found one. Shown only to
 *                   users who may add to that master.
 */
export default function SearchSelect({ fetcher, onPick, value, onChange, placeholder, minChars = 2, disabled, id, quickAdd, ...rest }) {
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [typed, setTyped] = useState('');
  const [open, setOpen] = useState(false);
  const timer = useRef();
  const seq = useRef(0);
  const qa = useQuickAdd();
  const def = quickAdd && !disabled ? qa.def(quickAdd.master) : null;

  useEffect(() => () => clearTimeout(timer.current), []);

  const search = (term) => {
    setTyped(term ?? '');
    clearTimeout(timer.current);
    if (!term || term.trim().length < minChars) { setOptions([]); return; }
    timer.current = setTimeout(async () => {
      const mine = ++seq.current;
      setLoading(true);
      try {
        const rows = await fetcher(term.trim());
        if (mine === seq.current) setOptions(rows.map((r, i) => ({ ...r, key: `${r.value}-${i}` })));
      } catch {
        if (mine === seq.current) setOptions([]);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 250);
  };

  async function add() {
    setOpen(false);
    const nameField = def.fields.find((f) => f.name === def.nameField);
    const initial = { ...(typeof quickAdd.initial === 'function' ? quickAdd.initial() : quickAdd.initial ?? {}) };
    const t = typed.trim();
    if (t && nameField) initial[nameField.name] = nameField.upper ? t.toUpperCase() : t;
    const row = await qa.open(quickAdd.master, { initial });
    if (!row) return;
    const option = quickAdd.toOption(row);
    onChange?.(option.value);
    onPick?.(option);
  }

  const searched = typed.trim().length >= minChars;
  const quick = def ? {
    open,
    onOpenChange: setOpen,
    popupRender: (menu) => (
      <>
        {menu}
        <div className="master-quick-add">
          <Button type="link" size="small" icon={<PlusOutlined />} onMouseDown={(e) => e.preventDefault()} onClick={add}>
            {typed.trim() ? `Add “${typed.trim()}” as new ${masterNoun(def)}` : `New ${masterNoun(def)}`}
          </Button>
        </div>
      </>
    ),
  } : {};

  return (
    <AutoComplete
      value={value}
      options={options}
      onSearch={search}
      onChange={onChange}
      onSelect={(_, option) => onPick?.(option)}
      disabled={disabled}
      // with quick add the list must open even when nothing matched (to offer "+ Add … as new")
      notFoundContent={loading ? <Spin size="small" /> : def && searched ? 'No match' : null}
      {...quick}
      {...rest}
    >
      {/* id goes on the real <input> so the Form.Item label is linked to it */}
      <Input id={id} placeholder={placeholder} allowClear />
    </AutoComplete>
  );
}
