import React from 'react';
import { IconButton as Button, Icon } from './lib';
import { IndexableObject } from '../lib';

export const IconButton: React.FC<any> = props => {
  const { icon, ...rest } = props;

  return (
    <Button
      style={{
        display: 'inline-block',
        margin: '0.3em',
      }}
      {...rest}
    >
      {icons[icon]}
    </Button>
  );
};

export const UserIcon = () => <Icon iconName={'UserEvent'} />;
export const ImageIcon = () => (
  <Icon
    style={{ height: '15.092em', width: '15.092em', fontSize: '15.092em' }}
    iconName={'PictureFill'}
  />
);

export const CropIcon = () => <IconButton />;
export const DownloadIcon = () => (
  <IconButton>
    <Icon iconName={'Download'} />
  </IconButton>
);
export const TrashIcon = () => (
  <IconButton>
    <Icon iconName={'Delete'} />
  </IconButton>
);

const icons: IndexableObject = {
  crop: <Icon iconName={'Crop'} />,
  download: <Icon iconName={'Download'} />,
  trash: <Icon iconName={'Delete'} />,
};
