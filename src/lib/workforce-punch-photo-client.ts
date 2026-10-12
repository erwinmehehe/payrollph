"use client";

/** Foreground camera normalization only. No IndexedDB, image telemetry or raw photo persistence. */
export const SELFIE_MAX_BYTES = 512 * 1024;
export const SELFIE_MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_PIXELS = 48_000_000;

export function selfieCanvasSize(width:number,height:number,maxEdge=1280){
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)
      ||width<1||height<1||!Number.isSafeInteger(maxEdge)||maxEdge<1)
    throw Error("Selfie has invalid dimensions.");
  const ratio=Math.min(1,maxEdge/Math.max(width,height));
  return {width:Math.max(1,Math.round(width*ratio)),
    height:Math.max(1,Math.round(height*ratio))};
}
async function decodeSelfie(file:File):Promise<{image:ImageBitmap|HTMLImageElement;url:string|null}>{
  if(typeof createImageBitmap==="function"){
    try {return {image:await createImageBitmap(file),url:null};}
    catch { /* Try browser's image-element fallback. */ }
  }
  const url=URL.createObjectURL(file);
  try{
    const image=await new Promise<HTMLImageElement>((resolve,reject)=>{
      const img=new Image();
      img.onload=()=>resolve(img);
      img.onerror=()=>reject(Error("Selfie image could not be decoded."));
      img.src=url;
    });
    return {image,url};
  }catch(error){URL.revokeObjectURL(url);throw error;}
}
function asJpeg(canvas:HTMLCanvasElement,quality:number):Promise<Blob|null>{
  return new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",quality));
}
/**
 * The phone camera often produces several MB. Convert in memory to a bounded,
 * metadata-free JPEG before the server's independent JPEG parser and AV scan.
 * Always fail, never silently drop a selected image, if conversion fails.
 */
export async function normalizePunchSelfie(file:File):Promise<File>{
  if(!file||file.size<1||file.size>SELFIE_MAX_SOURCE_BYTES)
    throw Error("Selfie must be a non-empty image no larger than 16 MB.");
  if(file.type && !/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type))
    throw Error("Choose a JPEG, PNG, WebP or supported phone-camera image.");
  const {image,url}=await decodeSelfie(file);
  try{
    const width=image.width,height=image.height;
    if(!Number.isFinite(width*height)||width*height>MAX_PIXELS)
      throw Error("Selfie image is too large to process safely.");
    const canvas=document.createElement("canvas");
    const context=canvas.getContext("2d",{alpha:false});
    if(!context)throw Error("Camera image processing is unavailable.");
    for(const maxEdge of [1280,1024,768,576]){
      const size=selfieCanvasSize(width,height,maxEdge);
      canvas.width=size.width;canvas.height=size.height;
      context.drawImage(image,0,0,size.width,size.height);
      for(const quality of [0.82,0.68,0.54,0.4]){
        const blob=await asJpeg(canvas,quality);
        if(blob&&blob.size>0&&blob.size<=SELFIE_MAX_BYTES){
          return new File([blob],"punch-evidence.jpg",{
            type:"image/jpeg",lastModified:Date.now(),
          });
        }
      }
    }
    throw Error("The photo could not be reduced below 512 KB. Try a smaller picture.");
  }finally{
    if(url)URL.revokeObjectURL(url);
    if("close" in image&&typeof image.close==="function")image.close();
  }
}
