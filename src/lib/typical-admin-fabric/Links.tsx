import React from 'react';
import { Name, Icon, IconButton } from './lib';
import { Stack, Separator, useLocation, useParams, useNavigate } from './lib';
import { IDispatcher } from '../typical-admin';

interface Props {
  name: Name;
  dispatcher: IDispatcher;
}

const Links: React.FC<Props> = ({ name: _name, dispatcher }) => {
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
        {dispatcher.new && (
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
