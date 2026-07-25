import React from 'react';
import 'react-image-crop/dist/ReactCrop.css';
import EXIF from 'exif-js';

import {
  clearCanvas,
  downloadBase64File,
  image64toCanvasRef,
  extractBase64,
} from './utils';
import Cropper from './Cropper';
import Original from './Original';
import PlaceHolder from './PlaceHolder';
import Preview from './Preview';
import { Stack } from './lib';
import { IndexableObject } from '../../lib';

const defaultProps = {
  base64URL: null,
  cropping: false,
  error: null,
  file: null,
  fileDimensions: {},
  icon: 'image',
  image: '',
  previewDimensions: { height: 100, width: 100 },
  selected: false,
};

// Pre-class-fields-syntax pattern: typing this class component's instance
// properties (all assigned in the constructor, not declared as class
// fields) via a same-named merged interface rather than restructuring the
// class body — left as-is rather than converted, since `handleImageLoaded`
// here is referenced (`this.handleImageLoaded`, below) but never actually
// assigned anywhere in this file, and touching this class's shape risks
// interacting with that in ways not worth risking in an unrelated lint pass.
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
interface Photo {
  preview: any;
  original: any;
  state: any;
  props: any;
  height: any;
  width: any;
  handleImageLoaded: () => any;
}
interface foo {
  height: any;
  width: any;
}
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
class Photo extends React.Component {
  constructor(props: any) {
    super(props);
    this.preview = React.createRef();
    this.original = React.createRef();
    this.state = { ...defaultProps, ...props };
  }

  handleCrop = (crop: any) => {
    this.setState({ crop });
  };

  handleCropCancel = () => {
    clearCanvas([this.preview]);
    this.setState({
      base64URL: null,
      cropping: false,
    });
  };

  handleCropComplete = (crop: any) => {
    const { height, width } = crop;
    this.setState({
      preview: image64toCanvasRef(
        this.preview.current,
        this.state.base64URL,
        crop
      ),
      previewDimensions: { height, width },
    });
  };

  handleCropStart = () => {
    const canvas = this.original.current;
    const type =
      this.state.file === null ? `data:image/png;base64` : this.state.file.type;

    this.setState({
      base64URL: canvas.toDataURL(type),
      cropping: true,
    });
  };

  handleEdit = () => {
    const image = new Image();
    image.src = `data:image/png;base64,${this.state.image}`;
    const canvas = this.original.current;
    const ctx = canvas.getContext('2d');

    image.onload = () => {
      canvas.width = image.width;
      canvas.height = image.height;
      ctx.drawImage(image, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.drawImage(image, -image.width / 2, -image.height / 2);
      ctx.restore();
      ctx.save();

      this.setState(() => ({
        fileDimensions: { height: image.height, width: image.width },
        base64URL: canvas.toDataURL('image/png;base64'),
        cropping: true,
        selected: true,
        error: null,
      }));
    };
  };

  handleErrorDismiss = () => {
    this.setState(() => ({ error: null }));
  };

  handleFileSelect = (acceptedFiles: any, rejectedFiles: any) => {
    if (rejectedFiles.length > 0) {
      rejectedFiles.reduce((total: any, file: any) => {
        return total + file.name;
      });
      this.setState(() => ({
        error:
          'The following files were rejected: ' +
          rejectedFiles.map((file: any) => file.name).join(', '),
      }));
      return;
    }

    // Not an arrow-function candidate like handleEdit's onload above — the
    // nested `function(this: foo)`/`function(this: any)` callbacks below
    // deliberately rely on EXIF.getData's and the Image element's own
    // `this` bindings (EXIF tag lookup, image width/height), so `self` is
    // still needed to reach the Photo component's own `this` from inside
    // them without touching that binding.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const file = acceptedFiles[0];
    const image = new Image();
    const canvas = this.original.current;
    const ctx = canvas.getContext('2d');

    EXIF.getData(file, function(this: foo) {
      const orient: IndexableObject = {
        1: 0,
        3: 180,
        6: 90,
        8: -90,
      };

      const degrees = orient[EXIF.getTag(this, 'Orientation')];

      image.onload = function(this: any) {
        if (degrees === -90 || degrees === 90) {
          canvas.height = this.width;
          canvas.width = this.height;
        } else {
          canvas.height = this.height;
          canvas.width = this.width;
        }

        ctx.drawImage(image, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((degrees * Math.PI) / 180);
        ctx.drawImage(image, -image.width / 2, -image.height / 2);
        ctx.restore();
        ctx.save();

        self.setState(() => ({
          fileDimensions: { height: canvas.height, width: canvas.width },
        }));
      };

      self.setState(
        state => ({
          ...state,
          file,
          selected: true,
          error: null,
        }),
        () => (image.src = URL.createObjectURL(file))
      );
    });
  };

  handleSave = () => {
    const base64 =
      !!this.state.crop && this.state.cropping
        ? extractBase64(this.preview.current.toDataURL('image/png'))
        : extractBase64(this.original.current.toDataURL('image/png'));

    this.props.submit(base64);
    this.reset();
  };

  handleDownload = () => {
    const { id } = this.props;

    downloadBase64File(
      `data:image/jpeg;base64,${this.props.image}`,
      `${id}.jpg`
    );
  };

  paintCanvas = (
    image: any,
    canvas: any,
    ctx: any,
    orientation: any
  ) => {
    if (orientation === -90 || orientation === 90) {
      canvas.height = this.width;
      canvas.width = this.height;
    } else {
      canvas.height = this.height;
      canvas.width = this.width;
    }

    ctx.drawImage(image, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((orientation * Math.PI) / 180);
    ctx.drawImage(image, -image.width / 2, -image.height / 2);
    ctx.restore();
    ctx.save();
  };

  remove = () => {
    this.props.submit('');
  };

  reset = () => {
    clearCanvas([this.original, this.preview]);
    this.setState({
      ...defaultProps,
      ...this.props,
    });
  };

  methods() {
    return {
      crop: this.handleCrop,
      cropCancel: this.handleCropCancel,
      cropComplete: this.handleCropComplete,
      cropStart: this.handleCropStart,
      dismiss: this.handleErrorDismiss,
      download: this.handleDownload,
      edit: this.handleEdit,
      imageLoaded: this.handleImageLoaded,
      remove: this.remove,
      reset: this.reset,
      save: this.handleSave,
      select: this.handleFileSelect,
    };
  }

  render() {
    return (
      <Stack horizontal>
        <Stack.Item>
          <PlaceHolder
            cropping={this.state.cropping}
            error={this.state.error}
            height={236}
            icon={this.state.icon}
            image={this.props.image}
            methods={this.methods()}
            selected={this.state.selected}
            width={196}
          />
          <Preview
            ref={this.preview}
            cropping={this.state.cropping}
            {...this.state.previewDimensions}
          />
        </Stack.Item>
        <Stack.Item>
          <Original
            selected={this.state.selected}
            cropping={this.state.cropping}
            ref={this.original}
          />
          <Cropper
            base64URL={this.state.base64URL}
            crop={this.state.crop}
            cropping={this.state.cropping}
            height={this.state.fileDimensions.height}
            methods={this.methods()}
            selected={this.state.selected}
            width={this.state.fileDimensions.width}
          />
        </Stack.Item>
      </Stack>
    );
  }
}

export default Photo;
