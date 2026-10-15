import { matchPath, useLocation, useParams } from 'react-router-dom';

/** ReactiveAdmin's detail routes, relative to where it is mounted. */
export const ADMIN_DETAIL_PATTERNS = ['new', ':id/show', ':id/edit'];

export interface IDetailRoute {
  /** The URL the component is mounted at (its route's `/*` stripped), e.g. "/devices". */
  basePath: string;
  /** The URL is on a detail route (a record is selected, or "new"). */
  selected: boolean;
  /** The selected record's id, when the pattern has `:id`. */
  id?: string;
}

/**
 * Reads master-detail selection from the URL: call it in a component mounted
 * under a `<route>/*` (Denim mounts every application that way). Selection
 * in the URL means deep links, reloads and the browser's Back button work.
 */
export function useDetailRoute(patterns: string[] = ADMIN_DETAIL_PATTERNS): IDetailRoute {
  const { pathname } = useLocation();
  const splat = useParams()['*'] ?? '';
  const rest = `/${splat}`.replace(/\/+$/, '');
  // The splat is decoded; compare segment counts rather than strings.
  const restDepth = splat.split('/').filter(Boolean).length;
  const segments = pathname.split('/').filter(Boolean);
  const basePath = `/${segments.slice(0, segments.length - restDepth).join('/')}`;
  for (const pattern of patterns) {
    const match = matchPath({ path: `/${pattern}`, end: true }, rest || '/');
    if (match) return { basePath, selected: true, id: match.params.id };
  }
  return { basePath, selected: false };
}
