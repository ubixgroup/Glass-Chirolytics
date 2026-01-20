import { drawHandLandmarks } from './drawingUtils';
import { processGestureData } from './gestureUtils';
import { GestureRecognizer } from '@mediapipe/tasks-vision';
import { GestureData } from '@/types/types';

type CanvasDimensions = {
  width: number;
  height: number;
};

// sets up the canvas for the current frame
export function setupCanvas(
  ctx: CanvasRenderingContext2D,
  canvasElement: HTMLCanvasElement,
  dimensions: CanvasDimensions
) {
  // set dimensions
  canvasElement.width = dimensions.width;
  canvasElement.height = dimensions.height;

  // save state and clear
  ctx.save();

  // apply mirror transform
  ctx.translate(dimensions.width, 0);
  ctx.scale(-1, 1);
}

// processes a single frame of video, handling gesture recognition and drawing
export function processVideoFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  gestureRecognizer: GestureRecognizer,
  dimensions: CanvasDimensions,
  setGestureData: {
    setLeftGestureData: (data: GestureData | null) => void;
    setRightGestureData: (data: GestureData | null) => void;
  },
  isRemote = false
) {
  if (video.readyState < 2) {
    setGestureData.setLeftGestureData(null);
    setGestureData.setRightGestureData(null);
    return null;
  }

  const results = gestureRecognizer.recognizeForVideo(video, Date.now());

  // draw landmarks with isRemote parameter
  drawHandLandmarks(ctx, results, isRemote);

  // process and update gesture data
  const { leftGestureData, rightGestureData } = processGestureData(results);
  setGestureData.setLeftGestureData(leftGestureData);
  setGestureData.setRightGestureData(rightGestureData);

  return results;
}

// checks if the frame should be processed based on elapsed time
// (30fps)
export function shouldProcessFrame(
  lastFrameTime: number,
  minFrameInterval: number = 1000 / 30
): boolean {
  const now = Date.now();
  const elapsed = now - lastFrameTime;
  return elapsed >= minFrameInterval;
}
