// Convenience re-exports for code inside a denim-fabric app: Fluent,
// react-router, Apollo hooks and typical-admin-fabric's Form/List/cards, plus
// getStyle(). (This was `denim/lib` before the core/skin split.) Import from
// the original packages when in doubt.
import { mergeStyleSets, getTheme } from '@fluentui/react';
import { useLocation } from 'react-router-dom';
import stylesJson from './getStyle';
export {
  ThemeProvider as Fabric,
  Stack,
  Icon,
  IconButton,
  Separator,
  PrimaryButton,
  Panel,
  PanelType,
  Nav,
  loadTheme,
  getTheme,
  Toggle,
  TextField,
  Modal,
  DefaultButton,
  mergeStyleSets,
  mergeStyles,
  FontWeights,
  Checkbox,
  Pivot,
  PivotItem,
  Link as FLink,
  Dropdown,
  Label,
  DetailsList,
  DetailsRow,
  ComboBox,
  SelectionMode,
  TagPicker,
  ChoiceGroup,
  Dialog,
} from '@fluentui/react';
export { useConstCallback } from '@fluentui/react-hooks';
export { Link, Route, Routes, Navigate, NavLink, useParams, useLocation } from 'react-router-dom';
export { useQuery, useMutation } from '@apollo/client/react';
export { ButtonDropdown } from './ButtonDropdown';
export { format } from 'date-fns';
export { default as Form } from '../../typical-admin-fabric/lib/templates/Form';
export { default as List } from '../../typical-admin-fabric/lib/List';
export { default as ThumbnailCard } from '../../typical-admin-fabric/lib/templates/ThumbnailCard';
export { default as FormCard } from '../../typical-admin-fabric/lib/templates/FormCard';
export { default as WideCard } from '../../typical-admin-fabric/lib/templates/WideCard';

/** Shared class names (header, modal, content, breakpoint helpers) for the current theme. */
export const getStyle = () => mergeStyleSets(stylesJson(getTheme()));

/**
 * The current application's path segment, from the router's location (so
 * it also works under HashRouter). Prefer the core's `useNav().activeApp`.
 */
export const useCurrentApp = () => useLocation().pathname.split('/')[1];

export interface IndexableObject {
  [key: string]: any;
}
