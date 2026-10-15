import React from 'react';

export default React.forwardRef((props: any, ref: any) => (
  <div
    id="original"
    style={{
      display: props.cropping || !props.selected ? 'none' : 'block',
    }}
  >
    <canvas
      style={{
        border: 'dashed',
        borderRadius: '0.385em',
      }}
      ref={ref}
    />
  </div>
));
