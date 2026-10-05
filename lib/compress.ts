// Shrinks big phone photos to max 1600px JPEG before upload.
// HEIC (iPhone) photos the browser can't read are converted first.
// If shrinking fails, the original file is uploaded instead, except for HEIC,
// which most browsers (and the projector) can't show.
export async function compressImage(file: File, max = 1600): Promise<Blob> {
  const heic = isHeic(file);
  try {
    let img: HTMLImageElement;
    try {
      img = await loadImage(file);
    } catch (e) {
      if (!heic) throw e;
      const { default: heic2any } = await import("heic2any");
      const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
      img = await loadImage(Array.isArray(converted) ? converted[0] : converted);
    }

    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    if (blob) return blob;
    if (heic) throw new Error("Couldn't convert HEIC photo");
    return file;
  } catch (e) {
    if (heic) throw e;
    return file;
  }
}

function isHeic(file: File) {
  return /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

// Fully decoded image, so its object URL can be released right away
async function loadImage(blob: Blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}
