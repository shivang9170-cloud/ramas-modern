// Quick add: open the form of any simple master (server: modules/masters/definitions.js) from anywhere in the app,
// e.g. "+ New City" inside the City drop-down of a branch, a docket or a contract. The forms stack: a City form can
// open "+ New District", whose form can open "+ New State" — each saves on its own and hands the new row back.
//
//   const quickAdd = useQuickAdd();                                   // ./quickAddContext.js
//   const row = await quickAdd.open('city', { initial: { city_name: 'NOIDA' } });   // null when cancelled
//
// After a save every query on screen is refreshed, so the page's own lists show the new record at once.
// "+ New …" shows only for masters the user may add to: admin, or an employee who was given that master's menu item in
// User Access Rights (the server decides: /api/masters canAdd, and refuses the save otherwise).
import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import MasterFormModal from './MasterFormModal.jsx';
import { QuickAddContext, masterNoun } from './quickAddContext.js';

export function QuickAddProvider({ children }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const staff = Boolean(user && !user.pwc && (user.role === 'admin' || user.role === 'employee'));
  // canAdd comes from the server: admin, or an employee given that master in User Access Rights
  const { data: list } = useQuery({
    queryKey: ['master-defs', user?.userId, user?.role, user?.divCode],
    queryFn: () => api.get('/masters').then((r) => r.data),
    enabled: staff,
    staleTime: 5 * 60_000,
  });
  const defs = useMemo(() => new Map((list ?? []).filter((d) => d.canAdd).map((d) => [d.key, d])), [list]);

  const [stack, setStack] = useState([]);       // [{ id, key, initial }]
  const resolvers = useRef(new Map());          // id -> resolve
  const seq = useRef(0);

  const open = useCallback((key, { initial } = {}) => new Promise((resolve) => {
    const id = ++seq.current;
    resolvers.current.set(id, resolve);
    setStack((s) => [...s, { id, key, initial: initial ?? {} }]);
  }), []);

  const finish = useCallback((id, row) => {
    resolvers.current.get(id)?.(row ?? null);
    resolvers.current.delete(id);
    setStack((s) => s.filter((x) => x.id !== id));
    // the page's own look-ups (cities of a state, locations of a branch …) pick up the new record
    if (row) queryClient.invalidateQueries({ refetchType: 'active' });
  }, [queryClient]);

  const value = useMemo(() => ({
    ready: staff && defs.size > 0,
    def: (key) => (staff ? defs.get(key) ?? null : null),
    open,
  }), [staff, defs, open]);

  return (
    <QuickAddContext.Provider value={value}>
      {children}
      {stack.map((item) => {
        const def = defs.get(item.key);
        if (!def) return null;
        return (
          <MasterFormModal
            key={item.id}
            masterKey={item.key}
            def={def}
            initial={item.initial}
            open
            title={`New ${masterNoun(def)}`}
            onClose={() => finish(item.id, null)}
            onSaved={(row) => finish(item.id, row)}
          />
        );
      })}
    </QuickAddContext.Provider>
  );
}
