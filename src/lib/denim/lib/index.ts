import { mergeStyleSets, getTheme } from "@fluentui/react";
import { initializeIcons } from "@fluentui/react";
import stylesJson from "./getStyle";
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
} from "@fluentui/react";
export { useConstCallback } from "@fluentui/react-hooks";
export { Link, Route, Routes, Navigate, NavLink, useParams, useLocation } from "react-router-dom";
export { useQuery, useMutation } from "@apollo/client/react";
export { ButtonDropdown } from "./ButtonDropdown";
export { format } from "date-fns";
export { default as Form } from "../../typical-admin-fabric/lib/templates/Form";
export { default as List } from "../../typical-admin-fabric/lib/List";
export { default as ThumbnailCard } from "../../typical-admin-fabric/lib/templates/ThumbnailCard";
export { default as FormCard } from "../../typical-admin-fabric/lib/templates/FormCard";

export const getStyle = () => mergeStyleSets(stylesJson(getTheme()));
export const getCurrentApp = () => {
  return document.location.pathname.split("/")[1];
};

export interface IndexableObject {
  [key: string]: any;
}


initializeIcons();
