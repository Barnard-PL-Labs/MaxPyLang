// jit.grab — webcam capture. Manifest: 1 inlet, 2 outlets [video, control].
//
// In the browser: opens getUserMedia into a hidden <video>, and exposes each decoded
// frame through videoOuts[0]. Capture starts on the transport ▶ (a user gesture, so
// the camera-permission prompt is allowed to appear). In Node/headless it builds as an
// inert node: the video outlet exists but getFrame() always returns undefined.

import { register, type MaxNode, type VideoFrame } from '../../engine/registry';
import { hasDOM, frameSize, videoSkeleton } from './_shared';

register('jit.grab', () => {
  const skel = videoSkeleton(1);

  let video: HTMLVideoElement | undefined;
  let stream: MediaStream | undefined;
  let opened = false;

  const canCapture = (): boolean =>
    hasDOM() &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function';

  const open = (): void => {
    if (opened || !canCapture()) return;
    opened = true;
    video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: false })
      .then((s) => {
        stream = s;
        if (video) {
          video.srcObject = s;
          void video.play();
        }
      })
      .catch((err) => console.warn('jit.grab: camera unavailable —', err));
  };

  const getFrame = (): VideoFrame | undefined => {
    // readyState >= 2 (HAVE_CURRENT_DATA) means a frame is decodable.
    if (!video || video.readyState < 2) return undefined;
    const { w, h } = frameSize(video);
    if (!w || !h) return undefined;
    return { source: video, width: w, height: h };
  };

  return {
    ...skel,
    videoOuts: [{ getFrame }, undefined],
    // A bang / "open" message could also drive capture; here ▶ opens the camera.
    start: open,
    stop: () => {
      stream?.getTracks().forEach((t) => t.stop());
      stream = undefined;
      opened = false;
    },
    dispose: () => {
      stream?.getTracks().forEach((t) => t.stop());
      stream = undefined;
      video = undefined;
    },
  } satisfies MaxNode;
});
