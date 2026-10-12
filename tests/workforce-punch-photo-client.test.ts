import assert from "node:assert/strict";
import test from "node:test";
import {normalizePunchSelfie,selfieCanvasSize,SELFIE_MAX_BYTES} from "../src/lib/workforce-punch-photo-client";

test("camera dimensions preserve aspect ratio and never enlarge a small photo",()=>{
  assert.deepEqual(selfieCanvasSize(4032,3024),{width:1280,height:960});
  assert.deepEqual(selfieCanvasSize(300,200),{width:300,height:200});
  assert.deepEqual(selfieCanvasSize(1200,2400,600),{width:300,height:600});
  assert.throws(()=>selfieCanvasSize(0,400),/dimensions/);
  assert.throws(()=>selfieCanvasSize(Infinity,100),/dimensions/);
});
test("invalid and oversized files fail before camera decode",async()=>{
  await assert.rejects(normalizePunchSelfie({size:0,type:"image/jpeg"} as File),/non-empty/);
  await assert.rejects(normalizePunchSelfie({size:17*1024*1024,type:"image/jpeg"} as File),/16 MB/);
  await assert.rejects(normalizePunchSelfie({size:100,type:"application/pdf"} as File),/Choose a JPEG/);
});
test("browser conversion keeps original only in memory and returns bounded JPEG bytes",async()=>{
  const originalBitmap=Object.getOwnPropertyDescriptor(globalThis,"createImageBitmap");
  const originalDocument=Object.getOwnPropertyDescriptor(globalThis,"document");
  let draws=0,encoded=0,closed=0;
  const mockImage={width:4000,height:3000,close:()=>{closed++;}};
  const canvas={
    width:0,height:0,
    getContext:()=>({drawImage:()=>{draws++;}}),
    toBlob:(callback:(blob:Blob|null)=>void,mime:string)=>{
      assert.equal(mime,"image/jpeg");
      encoded++;
      const bytes=encoded===1?SELFIE_MAX_BYTES+1:200000;
      queueMicrotask(()=>callback(new Blob([new Uint8Array(bytes)],{type:mime})));
    },
  };
  try{
    Object.defineProperty(globalThis,"createImageBitmap",{
      configurable:true,value:async()=>mockImage,
    });
    Object.defineProperty(globalThis,"document",{
      configurable:true,value:{createElement:(tag:string)=>{
        assert.equal(tag,"canvas");return canvas;
      }},
    });
    const photo=new File([new Uint8Array(300)],"capture.heic",{type:"image/heic"});
    const converted=await normalizePunchSelfie(photo);
    assert.equal(converted.type,"image/jpeg");
    assert.equal(converted.name,"punch-evidence.jpg");
    assert.equal(converted.size,200000);
    assert.equal(canvas.width,1280);
    assert.equal(canvas.height,960);
    assert.equal(draws,1);
    assert.equal(encoded,2);
    assert.equal(closed,1);
  }finally{
    if(originalBitmap)Object.defineProperty(globalThis,"createImageBitmap",originalBitmap);
    else Reflect.deleteProperty(globalThis,"createImageBitmap");
    if(originalDocument)Object.defineProperty(globalThis,"document",originalDocument);
    else Reflect.deleteProperty(globalThis,"document");
  }
});
