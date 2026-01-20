import { GestureRecognizer } from '@mediapipe/tasks-vision';
import { Point, CanvasDimensions } from '@/types/types';
import { InteractionPoint } from '@/types/interactionTypes';

/**
 * draws hand landmarks and connections for both hands
 * @param canvasCtx canvas 2d context to draw on
 * @param results mediapipe gesture recognition results
 * @param isRemote whether these are remote hands (uses different colors)
 */
export function drawHandLandmarks(
  canvasCtx: CanvasRenderingContext2D,
  results: {
    landmarks?: Array<Array<{ x: number; y: number }>>;
    handedness?: Array<Array<{ displayName: string }>>;
  },
  isRemote = false
): void {
  // @ts-expect-error: DrawingUtils is not recognized in @mediapipe/tasks-vision version 0.10.20.
  // But you can call with without importing it?
  const drawingUtils = new window.DrawingUtils(canvasCtx);

  // colors for local hands (green)
  const localConnectorColor = 'rgba(0, 255, 0, 0.4)'; // muted green with transparency
  const localLandmarkColor = 'rgba(255, 255, 255, 0.6)'; // semi-transparent white

  // colors for remote hands (blue/purple)
  const remoteConnectorColor = 'rgba(153, 102, 255, 0.4)'; // muted purple with transparency
  const remoteLandmarkColor = 'rgba(102, 204, 255, 0.6)'; // muted light blue with transparency

  // select colors based on whether these are remote hands
  const connectorColor = isRemote ? remoteConnectorColor : localConnectorColor;
  const landmarkColor = isRemote ? remoteLandmarkColor : localLandmarkColor;

  let leftDrawn = false;
  let rightDrawn = false;

  if (results.landmarks && results.handedness) {
    for (let i = 0; i < results.landmarks.length; i++) {
      const handLabel = results.handedness[i][0].displayName.toLowerCase();
      if (handLabel === 'left' && !leftDrawn) {
        drawingUtils.drawConnectors(
          results.landmarks[i],
          GestureRecognizer.HAND_CONNECTIONS,
          { color: connectorColor, lineWidth: 2 }
        );
        drawingUtils.drawLandmarks(results.landmarks[i], {
          color: landmarkColor,
          lineWidth: 0.5,
          radius: 3,
        });
        leftDrawn = true;
      } else if (handLabel === 'right' && !rightDrawn) {
        drawingUtils.drawConnectors(
          results.landmarks[i],
          GestureRecognizer.HAND_CONNECTIONS,
          { color: connectorColor, lineWidth: 2 }
        );
        drawingUtils.drawLandmarks(results.landmarks[i], {
          color: landmarkColor,
          lineWidth: 0.5,
          radius: 3,
        });
        rightDrawn = true;
      }
      if (leftDrawn && rightDrawn) break;
    }
  }
}

/**
 * draws a hover indicator for "one" gesture
 * @param ctx canvas context
 * @param point interaction point location
 */
export function drawOneGestureFeedback(
  ctx: CanvasRenderingContext2D,
  point: InteractionPoint
): void {
  // draw visual feedback for each hand's hover point (index fingertip)
  ctx.beginPath();
  ctx.arc(point.x, point.y, 10, 0, 2 * Math.PI);
  ctx.fillStyle = 'rgb(64, 224, 208)'; // solid turquoise for both hands
  ctx.fill();

  // draw a small ring around the point for better visibility
  ctx.beginPath();
  ctx.arc(point.x, point.y, 14, 0, 2 * Math.PI);
  ctx.strokeStyle = 'rgba(64, 224, 208, 0.2)';
  ctx.lineWidth = 0.5;
  ctx.stroke();
}

/**
 * draws visual feedback for "fist" gesture used for panning and zooming
 * @param ctx canvas context
 * @param point interaction point location (palm center)
 */
export function drawFistGestureFeedback(
  ctx: CanvasRenderingContext2D,
  point: InteractionPoint
): void {
  // draw visual feedback for palm center point
  ctx.beginPath();
  ctx.arc(point.x, point.y, 12, 0, 2 * Math.PI);
  ctx.fillStyle = 'rgb(50, 205, 50)'; // lime green
  ctx.fill();

  // draw a ring around the point
  ctx.beginPath();
  ctx.arc(point.x, point.y, 16, 0, 2 * Math.PI);
  ctx.strokeStyle = 'rgba(50, 205, 50, 0.3)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

/**
 * draws circle hover area for "grabbing" gesture
 * @param ctx canvas context
 * @param circle circle definition with center and radius
 */
export function drawGrabbingGestureFeedback(
  ctx: CanvasRenderingContext2D,
  circle: { center: Point; radius: number }
): void {
  // draw visual feedback for the hover area
  ctx.beginPath();
  ctx.arc(circle.center.x, circle.center.y, circle.radius, 0, 2 * Math.PI);
  ctx.strokeStyle = 'rgba(255, 140, 0, 0.3)'; // dark orange for both hands
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // add a subtle fill to the circle
  ctx.fillStyle = 'rgba(255, 140, 0, 0.1)';
  ctx.fill();
}

/**
 * draws hover point within grabbing circle
 * @param ctx canvas context
 * @param point point to draw
 */
export function drawGrabbingHoverPoint(
  ctx: CanvasRenderingContext2D,
  point: Point
): void {
  ctx.beginPath();
  ctx.arc(point.x, point.y, 1, 0, 2 * Math.PI);
  ctx.fillStyle = 'rgba(255, 140, 0, 0.15)'; // same color for both hands
  ctx.fill();
}

/**
 * draws selection indicator for thumb_index gesture
 * @param ctx canvas context
 * @param point interaction point location
 */
export function drawThumbIndexGestureFeedback(
  ctx: CanvasRenderingContext2D,
  point: InteractionPoint
): void {
  // draw visual indicator for index fingertip (landmark 8)
  ctx.beginPath();
  ctx.arc(point.x, point.y, 10, 0, 2 * Math.PI);
  ctx.fillStyle = 'rgb(147, 112, 219)'; // solid medium purple for both hands
  ctx.fill();
}

/**
 * draws fingertip indicators for "ok" gesture
 * @param ctx canvas context
 * @param indexTip index fingertip point
 * @param thumbTip thumb fingertip point
 */
export function drawOkGestureFeedback(
  ctx: CanvasRenderingContext2D,
  indexTip: InteractionPoint,
  thumbTip: InteractionPoint
): void {
  // draw index fingertip (landmark 8)
  ctx.beginPath();
  ctx.arc(indexTip.x, indexTip.y, 6, 0, 2 * Math.PI);
  ctx.fillStyle = 'rgb(255, 140, 0)'; // solid dark orange
  ctx.fill();

  // draw thumb tip (landmark 4)
  ctx.beginPath();
  ctx.arc(thumbTip.x, thumbTip.y, 6, 0, 2 * Math.PI);
  ctx.fillStyle = 'rgb(255, 140, 0)'; // solid dark orange
  ctx.fill();
}

/**
 * draws a ripple effect animation at the click point
 * @param ctx canvas context
 * @param point interaction point where the click occurred
 * @param progress animation progress from 0 to 1
 */
export function drawRippleEffect(
  ctx: CanvasRenderingContext2D,
  point: InteractionPoint,
  progress: number
): void {
  // maximum radius the ripple will expand to
  const maxRadius = 40;

  // calculate current radius based on progress
  const radius = maxRadius * progress;

  // calculate opacity that fades out as the circle grows
  const opacity = Math.max(0, 1 - progress);

  // draw expanding circle
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, 2 * Math.PI);
  ctx.strokeStyle = `rgba(147, 112, 219, ${opacity})`; // purple color matching thumb_index
  ctx.lineWidth = 2;
  ctx.stroke();

  // add subtle fill
  ctx.fillStyle = `rgba(147, 112, 219, ${opacity * 0.3})`;
  ctx.fill();
}

/**
 * draws zoom visualization between two hands
 * @param ctx canvas context
 * @param point1 first hand position
 * @param point2 second hand position
 * @param centerPoint center between hands
 * @param dimensions canvas dimensions
 */
export function drawZoomFeedback(
  ctx: CanvasRenderingContext2D,
  point1: Point,
  point2: Point,
  centerPoint: Point,
  dimensions: CanvasDimensions
): void {
  // draw line between hands with gradient
  const gradient = ctx.createLinearGradient(
    point1.x,
    point1.y,
    point2.x,
    point2.y
  );
  gradient.addColorStop(0, 'rgba(50, 205, 50, 0.3)'); // limegreen
  gradient.addColorStop(0.5, 'rgba(50, 205, 50, 0.5)');
  gradient.addColorStop(1, 'rgba(50, 205, 50, 0.3)');

  ctx.beginPath();
  ctx.moveTo(point1.x, point1.y);
  ctx.lineTo(point2.x, point2.y);
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 1;
  ctx.stroke();

  // draw zoom center point (solid color without rings)
  ctx.beginPath();
  ctx.arc(dimensions.width - centerPoint.x, centerPoint.y, 10, 0, 2 * Math.PI);
  ctx.fillStyle = 'rgb(50, 205, 50)'; // solid lime green
  ctx.fill();
}
