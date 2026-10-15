import React from 'react';

export default function Base64Img({ image }: any) {
  const [dimensions, setDimension] = React.useState<{
    height?: number | string;
    width?: number | string;
  }>({ height: 0, width: 0 });

  React.useEffect(() => {
    const img = new Image();
    img.src = image;
    img.onload = () => {
      setDimension(
        img.width > img.height ? { width: '196px' } : { height: '196px' }
      );
    };
  }, [image]);
  return image ? (
    <div>
      <img alt="Selected File" {...dimensions} src={image} />
    </div>
  ) : null;
}
