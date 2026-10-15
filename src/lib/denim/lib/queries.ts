import { gql } from '@apollo/client';
import type { DocumentNode } from 'graphql';

// The GraphQL contract Denim needs from a backend. Every part is optional:
// see README, "Server contract", and buildMyQuery below. This file has no
// UI-kit imports: it is part of the headless core.

export interface IApplication {
  /** Label in the nav (waffle panel, header, sidebar). */
  name: string;
  /** URL segment: the application owns `/<path>/*`. */
  path: string;
  /** `/<path>` redirects to `/<path>/<defaultRoute>`; "" for none. */
  defaultRoute: string;
  /** Key into the shell's `components` map. */
  frontEnd: string;
  /** Sub-pages, `/<path>/<link.path>`. */
  links: Array<ILink>;
  /**
   * Optional heading the application is listed under in a grouped nav (e.g.
   * "RIG", "LIGHTING"). Groups appear in the order their first application
   * appears; applications without one go under the shell's default group.
   * Skins without groups ignore it.
   */
  group?: string | null;
  /**
   * Optional icon name. The core treats it as an opaque string; denim-fabric
   * reads it as a Fluent UI icon name (e.g. "Devices3", "Lightbulb").
   */
  icon?: string | null;
}
export interface ILink {
  path: string;
  text: string;
}

/** Fields Denim selects on each `my.applications` entry. */
export const APPLICATION_FIELDS = `
  path
  defaultRoute
  name
  links {
    path
    text
  }
  frontEnd
`;

/**
 * Optional `Application` fields a shell may also select, e.g. "group icon".
 * Not in APPLICATION_FIELDS because a backend that lacks them would reject
 * the whole query; pass them through `<DenimProvider applicationFields>`.
 */
export const OPTIONAL_APPLICATION_FIELDS = 'group icon';

/** Fields Denim itself selects on `my.settings` (settingsSource="server"). */
export const DENIM_SETTINGS_FIELDS = `
  launchPage
  theme
  fontSize
`;

export interface IMyQueryOptions {
  /** Select `my.applications` (false when <Denim applications={...}> is given). */
  applications?: boolean;
  /** Select `my.settings` (settingsSource="server"). */
  settings?: boolean;
  /** Extra AppSettings fields an app's settings tabs read, e.g. "deviceName units". */
  settingsFields?: string;
  /** Extra Application fields to select, e.g. "group icon". */
  applicationFields?: string;
}

/**
 * Builds the `my` query for the parts of the contract an app uses. With
 * neither part there is nothing to ask, and <Denim> doesn't query at all.
 */
export function buildMyQuery({
  applications = true,
  settings = false,
  settingsFields = '',
  applicationFields = '',
}: IMyQueryOptions = {}): DocumentNode {
  const parts = [
    applications ? `applications { ${APPLICATION_FIELDS} ${applicationFields} }` : '',
    settings ? `settings { ${DENIM_SETTINGS_FIELDS} ${settingsFields} }` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return gql(`query my { my { ${parts || '__typename'} } }`);
}

const MY = buildMyQuery();

// `$settings` is declared non-null so this document is valid against both a
// nullable `updateSettings(settings: AppSettingsInput)` and a non-null one.
// Only `__typename` is selected, so the mutation may return any object type;
// Denim refetches `my` afterwards rather than reading the result.
export const UPDATE_SETTINGS = gql`
  mutation updateSettings($settings: AppSettingsInput!) {
    updateSettings(settings: $settings) {
      __typename
    }
  }
`;

export interface IAppNav {
  text: string;
  path: string;
  roles: Array<string>;
}

export interface IUser {
  applications: Array<IApplication>;
  settings?: Record<string, any> | null;
}

export interface IMy {
  my: Partial<IUser>;
}

// File helpers, kept for apps that use them. Denim itself never sends these
// (Photo hands the image to its `submit` prop), so a backend doesn't need
// them unless the app does.
export interface IFile {
  id: string;
  name: string;
  fileId: string;
  file: string;
  thumbnail: string;
  type: string;
}
const UPLOAD = gql`
  mutation uploadFile($name: String!, $file: String!, $type: String!) {
    uploadFile(name: $name, file: $file, type: $type) {
      id
      name
      thumbnail
    }
  }
`;

const GET_FILE = gql`
  query getFile($id: String!) {
    getFileBase64(id: $id) {
      id
      fileId
      name
      file
    }
  }
`;

const dispatcher = {
  my: MY,
  updateSettings: UPDATE_SETTINGS,
  getFile: GET_FILE,
  upload: UPLOAD
};

export default dispatcher;
