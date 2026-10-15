import React from 'react';
import ReactCrop from 'react-image-crop';
import { PrimaryButton, DefaultButton, getTheme } from './lib';

interface Props {
  base64URL: string;
  crop: any;
  cropping: any;
  height: number | string;
  width: number | string;
  methods: any;
  selected: any;
}

const Cropper: React.FC<Props> = ({
  base64URL,
  crop,
  cropping,
  height,
  methods,
  selected,
  width,
}) => (
  <div className="react-crop">
    <div
      className="react-crop"
      style={{
        width: `${width}px`,
        height: `${height}px`,
        border: 'dashed',
        borderRadius: '0.385em',
        marginBottom: '0.25em',
        display: cropping ? 'block' : 'none',
      }}
    >
      <ReactCrop
        {...({
          onImageLoaded: methods.imageLoaded,
          onComplete: methods.cropComplete,
          src: base64URL || '',
          onChange: methods.crop,
          crop,
        } as any)}
      />
    </div>
    <SelectedControls
      cropping={cropping}
      methods={methods}
      selected={selected}
    />
    <CroppingControls
      methods={methods}
      cropping={cropping}
      selected={selected}
    />
  </div>
);

interface Controls {
  cropping: boolean;
  methods: {
    save: () => void;
    cropCancel: () => void;
    cropStart: () => void;
    reset: () => void;
  };
  selected: boolean;
}

const CroppingControls: React.FC<Controls> = ({
  cropping,
  methods,
  selected,
}) => (
  <div style={{ display: cropping && selected ? 'block' : 'none' }}>
    <PrimaryButton color="success" onClick={methods.save}>
      Save
    </PrimaryButton>{' '}
    <DefaultButton color="default" onClick={methods.cropCancel}>
      Cancel
    </DefaultButton>
  </div>
);

const SelectedControls: React.FC<Controls> = ({
  cropping,
  methods,
  selected,
}) => {
  const theme = getTheme();
  return (
    <div style={{ display: !cropping && selected ? 'block' : 'none' }}>
      <PrimaryButton color="primary" onClick={methods.save}>
        Save
      </PrimaryButton>{' '}
      <DefaultButton color="success" onClick={methods.cropStart}>
        Crop
      </DefaultButton>{' '}
      <DefaultButton color={theme.palette.red} onClick={methods.reset}>
        Discard
      </DefaultButton>
    </div>
  );
};

export default Cropper;
