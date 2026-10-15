import React from 'react';

export default React.forwardRef(
  ({ cropping, height, width }: any, ref: any) => {
    const dimension =
      width === height
        ? { height: '15.246em', width: '15.246em' }
        : width > height
        ? { height: 'auto', width: '15.246em' }
        : { height: '15.246em', width: 'auto' };

    return (
      <div id="preview" style={{ display: cropping ? 'block' : 'none' }}>
        <canvas
          style={{
            ...dimension,
            border: 'dashed',
            borderRadius: '0.385em',
          }}
          ref={ref}
        />
      </div>
    );
  }
);
