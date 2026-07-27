// Abstracts *where* a list's hidden-column set lives, so a caller can swap
// in a backend-backed store later (e.g. a typiql-generated column-config
// type) without touching List.tsx's selection/filtering logic — only the
// store implementation changes. Defaults to localStorage everywhere today.
export interface ColumnVisibilityStore {
  readHidden(key: string): Set<string>;
  writeHidden(key: string, hidden: Set<string>): void;
}

const COLUMN_VISIBILITY_KEY_PREFIX = 'typical-admin-list-columns:';

// Persists the *hidden* set, not the visible set — every column defaults to
// visible (opt-out model), and a schema key added later automatically shows
// up for existing users with no migration, since it simply won't be in
// their saved hidden set. Same try/catch-wrapped shape as denim's own
// theme-cache localStorage helpers (src/lib/denim/components/index.tsx).
export const localStorageColumnVisibilityStore: ColumnVisibilityStore = {
  readHidden(key: string): Set<string> {
    try {
      const raw = localStorage.getItem(`${COLUMN_VISIBILITY_KEY_PREFIX}${key}`);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? new Set(parsed) : new Set();
    } catch {
      return new Set();
    }
  },
  writeHidden(key: string, hidden: Set<string>) {
    try {
      localStorage.setItem(`${COLUMN_VISIBILITY_KEY_PREFIX}${key}`, JSON.stringify([...hidden]));
    } catch {
      // best-effort, same rationale as denim's theme cache.
    }
  },
};
