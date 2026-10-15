// One confirm dialog for the whole app: typical-admin-fabric's. Re-exported,
// not copied, because confirmAsync() is served only by the
// <ConfirmDialogHost /> from the same module (a module-level singleton), and
// typical-admin-fabric's list delete buttons already call that one. Mount
// <ConfirmDialogHost /> once near the app root.
export {
  confirmAsync,
  ConfirmDialogHost,
  default,
} from '../../typical-admin-fabric/ConfirmDialog';
export type { ConfirmOptions } from '../../typical-admin-fabric/ConfirmDialog';
