import React from 'react';
import { Name, Icon, IconButton } from './lib';
import { Stack, Separator, useLocation, useParams, useNavigate } from './lib';
import { IDispatcher } from '../typical-admin';

interface Props {
  name: Name;
  dispatcher: IDispatcher;
  /** Suppresses this row's Add button when the grid below already
   *  renders one of its own (List's ListControls toolbar, driven by
   *  schemaDefinition.list.buttons.add). Both were showing at once on
   *  every table-view admin. The toolbar one wins — it sits with the
   *  other grid controls, and card view (which has no toolbar) still
   *  relies on the button here. */
  hideAdd?: boolean;
}

const Links: React.FC<Props> = ({ name: _name, dispatcher, hideAdd }) => {
  const { pathname } =  useLocation();
  const { id } = useParams();
  const navigate = useNavigate();
  const urls = {
    edit: new RegExp(`/edit$`),
    new: new RegExp(`/new$`),
    show: new RegExp(`/show$`),
  };

  if (urls.show.test(pathname)) {
    return (
      <Stack
        horizontal
        tokens={{ childrenGap: '0.77em' }}
        verticalAlign={'center'}
      >
        <IconButton onClick={() => navigate(pathname.replace(`/${id}/show`, '/'))}>
          <Icon iconName={'back'} />
        </IconButton>
        {dispatcher.edit && (
          <>
            <Separator vertical />
            <IconButton onClick={() => navigate(pathname.replace('show', 'edit'))}>
              <Icon iconName={'edit'} />
            </IconButton>
          </>
        )}
      </Stack>
    );
  } else if (urls.edit.test(pathname)) {
    return (
      <IconButton onClick={() => navigate(pathname.replace('edit', 'show'))}>
        <Icon iconName={'back'} />
      </IconButton>
    );
  } else if (urls.new.test(pathname)) {
    return (
      <IconButton onClick={() => navigate(pathname.replace('/new', ''))}>
        <Icon iconName={'back'} />
      </IconButton>
    );
  } else {
    return (
      <Stack
        horizontal
        tokens={{ childrenGap: '0.77em' }}
        verticalAlign={'center'}
      >
        <IconButton onClick={() => navigate("../")}>
          <Icon iconName={'back'} />
        </IconButton>
        {dispatcher.new && !hideAdd && (
          <>
            <Separator vertical />
            <IconButton onClick={() => navigate(`${pathname}/new`)}>
              <Icon iconName={'add'} />
            </IconButton>
          </>
        )}
      </Stack>
    );
  }
};
export default Links;
