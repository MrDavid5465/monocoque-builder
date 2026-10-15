export function base64StringToFile(base64String: string, filename: string) {
  const arr = base64String.split(',');
  const mime = (arr[0].match(/:(.*?);/) || '')[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], filename, { type: mime });
}

export function extractImageFileExtensionFromBase64(base64Data: string) {
  return base64Data.substring(
    'data:image/'.length,
    base64Data.indexOf(';base64')
  );
}

export function extractBase64(base64Data: string) {
  return base64Data.slice('data:image/png;base64,'.length);
}

export function downloadBase64File(base64Data: string, filename: string) {
  const element = document.createElement('a');
  element.setAttribute('href', base64Data);
  element.setAttribute('download', filename);
  element.style.display = 'none';
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
}

export function image64toCanvasRef(canvasRef: any, image64: any, crop: any) {
  const canvas = canvasRef; // document.createElement('canvas');
  canvas.width = crop.width;
  canvas.height = crop.height;
  const ctx = canvas.getContext('2d');
  const image = new Image();
  image.src = image64;
  image.onload = function() {
    ctx.drawImage(
      image,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      crop.width,
      crop.height
    );
  };
}

export function clearCanvas(refs: any[]) {
  refs.forEach(ref => {
    const canvas = ref.current;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.canvas.height = 200;
    ctx.canvas.width = 200;
  });
}
