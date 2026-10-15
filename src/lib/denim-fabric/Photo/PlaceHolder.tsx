import React from 'react';
import Dropzone from 'react-dropzone';
import { UserIcon, ImageIcon } from './icons';
import { Dialog } from './lib';

import withConditionalRender from '../lib/withConditionalRender';
import Overlay from './Overlay';
import Base64Img from './Base64Img';

const ConditionalUserIcon = withConditionalRender(UserIcon);
const ConditionalImageIcon = withConditionalRender(ImageIcon);
const ConditionalOverlay = withConditionalRender(Overlay);

interface Props {
  cropping: any;
  error: any;
  icon: any;
  image: any;
  methods: any;
  selected: any;
  height: any;
  width: any;
}

const PlaceHolder: React.FC<Props> = ({
  cropping,
  error,
  icon,
  image,
  methods,
  selected,
  height,
  width,
}) => {
  return (
    <div
      id="placeholder"
      style={{
        position: 'relative',
        display: cropping ? 'none' : 'block',
        height,
        width,
      }}
    >
      <Dropzone
        multiple={false}
        maxSize={500000}
        accept={{ 'image/jpeg': [], 'image/png': [] }}
        onDrop={methods.select}
      >
        {({ getRootProps, getInputProps }) => {
          return (
            <div {...getRootProps()}>
              <input {...getInputProps()} />
              <ConditionalUserIcon and={[image === '', icon === 'user']} />
              <ConditionalImageIcon and={[image === '', icon === 'image']} />
              {!!image && (
                <Base64Img image={`data:image/png;base64,${image}`} />
              )}
            </div>
          );
        }}
      </Dropzone>

      <ConditionalOverlay
        and={[image !== '', !cropping, !selected]}
        methods={methods}
      />
      <div
        style={{ padding: '1em 0 1em 0', display: error ? 'block' : 'none' }}
      >
        <Dialog onDismiss={methods.dismiss}>{error}</Dialog>
      </div>
    </div>
  );
};

export default PlaceHolder;
