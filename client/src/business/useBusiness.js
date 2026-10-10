// The logged-in division's business profile (server: modules/business): courier / TMS / international.
//   const { data: biz } = useBusiness();   biz.useBagging, biz.allowInternational, biz.tms, biz.limits
// TMS divisions (cargo / FTL) never see the bagging steps; Export / Import shows only where allowInternational.
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';

export function useBusiness() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['business-profile', user?.divCode],
    queryFn: () => api.get('/business/profile').then((r) => r.data),
    enabled: Boolean(user && !user.pwc),
    staleTime: 5 * 60_000,
  });
}
