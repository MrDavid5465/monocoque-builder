import React from 'react';
import ReactiveAdmin from '../../lib/typical-admin-fabric';
import SwitchableList from '../../lib/typical-admin-fabric/SwitchableList';
import TemplateEdit from './TemplateEdit';
import TemplateNew from './TemplateNew';
import { GET_TEMPLATES, ADD_TEMPLATE, REMOVE_TEMPLATE } from '../Telemetry/DashboardDesigner/queries';
import { dashboardThumbnailUrl } from '../Telemetry/DashboardDesigner/thumbnailUrl';

// No "get one" query exists server-side (same as the old Templates/index.tsx
// route) — show/edit resolve :id client-side against the list, so both slots
// point at the same TemplateEdit wrapper. dispatcher.show/edit are required
// structurally by IDispatcher/ITASchema but not actually read, same rationale
// as DashboardsAdmin/CarsAdmin. dispatcher.delete IS read directly by
// Show.tsx/CardList.tsx.
const dispatcher = { list: GET_TEMPLATES, show: GET_TEMPLATES, edit: GET_TEMPLATES, new: ADD_TEMPLATE, delete: REMOVE_TEMPLATE };
const name = { singular: 'Template', plural: 'Templates' };
const templateSchema = {
  name: { label: 'Name' },
  thumbnail: {
    label: 'Thumbnail',
    onRender: ({ value }: { value?: string }) => dashboardThumbnailUrl(value),
  },
};
const schemaDefinition = { list: { columns: templateSchema, buttons: { add: true } }, show: {}, edit: {}, new: {} };

const TemplatesAdmin: React.FC = () => (
  <ReactiveAdmin
    dispatcher={dispatcher}
    name={name}
    schemaDefinition={schemaDefinition}
    components={{
      list: (props: any) => (
        <SwitchableList {...props} titleField="name" thumbnailField="thumbnail" defaultView="card" />
      ),
      show: TemplateEdit,
      edit: TemplateEdit,
      new: TemplateNew,
    }}
  />
);

export default TemplatesAdmin;
