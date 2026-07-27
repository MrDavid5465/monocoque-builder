import { getTheme, mergeStyleSets } from '@fluentui/react';
import stylesJson from './getStyle';

export { default as Form } from './templates/Form';
export { default as ThumbnailCard } from './templates/ThumbnailCard';
export { default as FormCard } from './templates/FormCard';
export { useMutation, useQuery } from '@apollo/client/react';
export {
  PrimaryButton,
  DefaultButton,
  Stack,
  Separator,
  Modal,
  getTheme,
  SelectionMode,
  DetailsList,
  IconButton,
  Icon,
  Link
} from '@fluentui/react';
export { useNavigate, useLocation, useParams } from 'react-router'
export { Route } from 'react-router-dom';
export { default as List } from './List';
export interface Name {
  singular: string;
  plural: string;
}
export interface IndexableObject {
  [key: string]: any;
}
export const getStyle = () => mergeStyleSets(stylesJson(getTheme()));
