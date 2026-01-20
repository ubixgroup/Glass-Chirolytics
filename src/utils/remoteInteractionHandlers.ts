import { Point } from '@/types/types';
import { minEnclosingCircle, getLandmarkPosition } from '@/utils/mathUtils';
import {
  NormalizedLandmark,
  GestureRecognizerResult,
} from '@mediapipe/tasks-vision';
import { CanvasDimensions } from '@/types/types';
import { InteractionPoint } from '@/types/interactionTypes';
import {
  drawOneGestureFeedback,
  drawGrabbingGestureFeedback,
  drawThumbIndexGestureFeedback,
  drawOkGestureFeedback,
  drawZoomFeedback,
  drawFistGestureFeedback,
  drawRippleEffect,
} from '@/utils/drawingUtils';

// converts a mediapipe landmark to our interaction point format
// this handles the coordinate space conversion from normalized (0-1) to pixel space
// and calculates both canvas and client coordinates
function landmarkToInteractionPoint(
  landmark: NormalizedLandmark,
  dimensions: CanvasDimensions,
  rect: DOMRect
): InteractionPoint {
  const canvasX = landmark.x * dimensions.width;
  const canvasY = landmark.y * dimensions.height;
  return {
    x: canvasX,
    y: canvasY,
    clientX: rect.left + (dimensions.width - canvasX),
    clientY: rect.top + canvasY,
  };
}

// ripple effect animation state for remote hands
interface RemoteRippleState {
  active: boolean;
  point: InteractionPoint | null;
  startTime: number;
  progress: number;
}

// ripple state tracking per remote hand
const remoteRippleState: {
  left: RemoteRippleState;
  right: RemoteRippleState;
} = {
  left: {
    active: false,
    point: null,
    startTime: 0,
    progress: 0,
  },
  right: {
    active: false,
    point: null,
    startTime: 0,
    progress: 0,
  },
};

// duration of ripple animation in milliseconds
const RIPPLE_ANIMATION_DURATION = 500;

// state machine for tracking clicks (thumb_index to one gesture) - matching local implementation
type RemoteGestureState = 'idle' | 'potential_click';
interface RemoteGestureClickState {
  state: RemoteGestureState;
  startTime: number;
}

// click gesture state tracking per remote hand - matching local implementation
const remoteGestureClickState: {
  left: RemoteGestureClickState;
  right: RemoteGestureClickState;
} = {
  left: {
    state: 'idle',
    startTime: 0,
  },
  right: {
    state: 'idle',
    startTime: 0,
  },
};

// time constraint for the click gesture (thumb_index → one) in milliseconds - matching local implementation
const CLICK_GESTURE_TIME_CONSTRAINT = 500;

// state for tracking remote fist gesture dwell time per hand
const remoteFistDwellState = {
  left: {
    startTime: 0,
    active: false,
    dwellComplete: false,
  },
  right: {
    startTime: 0,
    active: false,
    dwellComplete: false,
  },
};

// dwell time in milliseconds (matching local implementation)
const FIST_DWELL_TIME = 500;

// state for grabbing gesture dwell time to create sticky brushes
const remoteGrabbingDwellState = {
  left: {
    startTime: 0,
    active: false,
    dwellComplete: false,
    position: null as Point | null,
    radius: 0,
  },
  right: {
    startTime: 0,
    active: false,
    dwellComplete: false,
    position: null as Point | null,
    radius: 0,
  },
};

// dwell time and thresholds for sticky brush creation
const GRABBING_DWELL_TIME = 2000; // 1 second
const GRABBING_POSITION_THRESHOLD = 30; // pixels
const GRABBING_RADIUS_THRESHOLD = 20; // pixels

// helper function to draw a move tool indicator (four cardinal arrows)
function drawMoveToolIndicator(
  ctx: CanvasRenderingContext2D,
  point: InteractionPoint
): void {
  const arrowLength = 14;
  const arrowWidth = 6;
  const centerOffset = 8; // offset from center point

  // draw arrows in four directions
  // up arrow
  ctx.beginPath();
  ctx.moveTo(point.x, point.y - centerOffset);
  ctx.lineTo(point.x, point.y - centerOffset - arrowLength);
  ctx.lineTo(
    point.x - arrowWidth,
    point.y - centerOffset - arrowLength + arrowWidth
  );
  ctx.moveTo(point.x, point.y - centerOffset - arrowLength);
  ctx.lineTo(
    point.x + arrowWidth,
    point.y - centerOffset - arrowLength + arrowWidth
  );
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 2;
  ctx.stroke();

  // down arrow
  ctx.beginPath();
  ctx.moveTo(point.x, point.y + centerOffset);
  ctx.lineTo(point.x, point.y + centerOffset + arrowLength);
  ctx.lineTo(
    point.x - arrowWidth,
    point.y + centerOffset + arrowLength - arrowWidth
  );
  ctx.moveTo(point.x, point.y + centerOffset + arrowLength);
  ctx.lineTo(
    point.x + arrowWidth,
    point.y + centerOffset + arrowLength - arrowWidth
  );
  ctx.stroke();

  // left arrow
  ctx.beginPath();
  ctx.moveTo(point.x - centerOffset, point.y);
  ctx.lineTo(point.x - centerOffset - arrowLength, point.y);
  ctx.lineTo(
    point.x - centerOffset - arrowLength + arrowWidth,
    point.y - arrowWidth
  );
  ctx.moveTo(point.x - centerOffset - arrowLength, point.y);
  ctx.lineTo(
    point.x - centerOffset - arrowLength + arrowWidth,
    point.y + arrowWidth
  );
  ctx.stroke();

  // right arrow
  ctx.beginPath();
  ctx.moveTo(point.x + centerOffset, point.y);
  ctx.lineTo(point.x + centerOffset + arrowLength, point.y);
  ctx.lineTo(
    point.x + centerOffset + arrowLength - arrowWidth,
    point.y - arrowWidth
  );
  ctx.moveTo(point.x + centerOffset + arrowLength, point.y);
  ctx.lineTo(
    point.x + centerOffset + arrowLength - arrowWidth,
    point.y + arrowWidth
  );
  ctx.stroke();
}

// helper function to draw a zoom tool indicator with arrows aligned with the hand positions
function drawZoomToolIndicator(
  ctx: CanvasRenderingContext2D,
  center: InteractionPoint,
  point1: Point,
  point2: Point
): void {
  const arrowLength = 14;
  const arrowWidth = 6;

  // Calculate the direction vector from center to each hand
  const dir1 = {
    x: point1.x - center.x,
    y: point1.y - center.y,
  };

  const dir2 = {
    x: point2.x - center.x,
    y: point2.y - center.y,
  };

  // Normalize the direction vectors
  const length1 = Math.sqrt(dir1.x * dir1.x + dir1.y * dir1.y);
  const length2 = Math.sqrt(dir2.x * dir2.x + dir2.y * dir2.y);

  if (length1 > 0 && length2 > 0) {
    const normalizedDir1 = {
      x: dir1.x / length1,
      y: dir1.y / length1,
    };

    const normalizedDir2 = {
      x: dir2.x / length2,
      y: dir2.y / length2,
    };

    // Calculate start points for arrows (slightly offset from center)
    const startOffset = 8; // Same as centerOffset in other functions

    const start1 = {
      x: center.x + normalizedDir1.x * startOffset,
      y: center.y + normalizedDir1.y * startOffset,
    };

    const start2 = {
      x: center.x + normalizedDir2.x * startOffset,
      y: center.y + normalizedDir2.y * startOffset,
    };

    // Calculate end points for arrows
    const end1 = {
      x: start1.x + normalizedDir1.x * arrowLength,
      y: start1.y + normalizedDir1.y * arrowLength,
    };

    const end2 = {
      x: start2.x + normalizedDir2.x * arrowLength,
      y: start2.y + normalizedDir2.y * arrowLength,
    };

    // Calculate arrow head points for first arrow
    // Perpendicular to direction vector
    const perpDir1 = {
      x: -normalizedDir1.y,
      y: normalizedDir1.x,
    };

    const arrow1Point1 = {
      x: end1.x - normalizedDir1.x * arrowWidth + perpDir1.x * arrowWidth,
      y: end1.y - normalizedDir1.y * arrowWidth + perpDir1.y * arrowWidth,
    };

    const arrow1Point2 = {
      x: end1.x - normalizedDir1.x * arrowWidth - perpDir1.x * arrowWidth,
      y: end1.y - normalizedDir1.y * arrowWidth - perpDir1.y * arrowWidth,
    };

    // Calculate arrow head points for second arrow
    const perpDir2 = {
      x: -normalizedDir2.y,
      y: normalizedDir2.x,
    };

    const arrow2Point1 = {
      x: end2.x - normalizedDir2.x * arrowWidth + perpDir2.x * arrowWidth,
      y: end2.y - normalizedDir2.y * arrowWidth + perpDir2.y * arrowWidth,
    };

    const arrow2Point2 = {
      x: end2.x - normalizedDir2.x * arrowWidth - perpDir2.x * arrowWidth,
      y: end2.y - normalizedDir2.y * arrowWidth - perpDir2.y * arrowWidth,
    };

    // Draw first arrow
    ctx.beginPath();
    ctx.moveTo(start1.x, start1.y);
    ctx.lineTo(end1.x, end1.y);
    ctx.lineTo(arrow1Point1.x, arrow1Point1.y);
    ctx.moveTo(end1.x, end1.y);
    ctx.lineTo(arrow1Point2.x, arrow1Point2.y);
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw second arrow
    ctx.beginPath();
    ctx.moveTo(start2.x, start2.y);
    ctx.lineTo(end2.x, end2.y);
    ctx.lineTo(arrow2Point1.x, arrow2Point1.y);
    ctx.moveTo(end2.x, end2.y);
    ctx.lineTo(arrow2Point2.x, arrow2Point2.y);
    ctx.stroke();
  }
}

// remote handler for "one" gesture - purely visual with no event dispatching
export function handleOne(
  ctx: CanvasRenderingContext2D,
  results: GestureRecognizerResult,
  rect: DOMRect,
  dimensions: CanvasDimensions
): void {
  if (
    !results.landmarks?.length ||
    !results.handedness?.length ||
    !results.gestures?.length
  ) {
    return;
  }

  const now = Date.now();

  // process each hand
  results.handedness.forEach((hand, index) => {
    const handLabel = hand[0].displayName.toLowerCase() as 'left' | 'right';
    const gesture = results.gestures![index][0].categoryName;

    // Check and update ripple animation if active
    const handRippleState = remoteRippleState[handLabel];
    if (handRippleState.active && handRippleState.point) {
      const rippleElapsed = now - handRippleState.startTime;
      handRippleState.progress = Math.min(
        1,
        rippleElapsed / RIPPLE_ANIMATION_DURATION
      );

      // Draw the ripple effect
      drawRippleEffect(ctx, handRippleState.point, handRippleState.progress);

      // Deactivate ripple when animation completes
      if (handRippleState.progress >= 1) {
        handRippleState.active = false;
        handRippleState.point = null;
      }
    }

    // only process if gesture is "one"
    if (gesture !== 'one') return;

    const landmarks = results.landmarks![index];

    // get index fingertip position
    const indexTip = landmarks[8];
    const point = landmarkToInteractionPoint(indexTip, dimensions, rect);

    // draw visual feedback using the drawing utility - this is all we do for remote
    drawOneGestureFeedback(ctx, point);
  });
}

// remote handler for "grabbing" gesture - purely visual with no event dispatching
export function handleGrabbing(
  ctx: CanvasRenderingContext2D,
  results: GestureRecognizerResult,
  rect: DOMRect,
  dimensions: CanvasDimensions,
  stickyBrushesEnabled = false
): void {
  if (
    !results.landmarks?.length ||
    !results.handedness?.length ||
    !results.gestures?.length
  ) {
    return;
  }

  const currentTime = Date.now();

  // Check for active ripple animations and draw them
  for (const handLabel of ['left', 'right'] as const) {
    const handRippleState = remoteRippleState[handLabel];
    if (handRippleState.active && handRippleState.point) {
      const rippleElapsed = currentTime - handRippleState.startTime;
      handRippleState.progress = Math.min(
        1,
        rippleElapsed / RIPPLE_ANIMATION_DURATION
      );

      // Draw the ripple effect
      drawRippleEffect(ctx, handRippleState.point, handRippleState.progress);

      // Deactivate ripple when animation completes
      if (handRippleState.progress >= 1) {
        handRippleState.active = false;
        handRippleState.point = null;
      }
    }
  }

  // process each hand
  results.handedness.forEach((hand, index) => {
    const handLabel = hand[0].displayName.toLowerCase() as 'left' | 'right';
    const gesture = results.gestures![index][0].categoryName;
    const dwellState = remoteGrabbingDwellState[handLabel];

    // only process if gesture is "grabbing"
    if (gesture !== 'grabbing') {
      // if the gesture is no longer grabbing, reset dwell state
      if (dwellState.active) {
        dwellState.active = false;
        dwellState.dwellComplete = false;
      }
      return;
    }

    const landmarks = results.landmarks![index];

    // get all fingertip positions (thumb and all fingers)
    const tipIndices = [4, 8, 12, 16, 20];
    const tipPoints: Point[] = tipIndices.map((i) => ({
      x: landmarks[i].x * dimensions.width,
      y: landmarks[i].y * dimensions.height,
    }));

    // calculate the minimum circle that encloses all fingertips
    const circle = minEnclosingCircle(tipPoints);

    if (circle && circle.radius > 0) {
      // draw visual feedback for the hover area - this is all we do for remote
      drawGrabbingGestureFeedback(ctx, circle);

      // handle dwell logic for sticky brush creation (purely visual in remote handler)
      if (!stickyBrushesEnabled) {
        // when disabled, ensure dwell state does not persist and skip progress ring
        if (dwellState.active || dwellState.dwellComplete) {
          dwellState.active = false;
          dwellState.dwellComplete = false;
        }
      } else {
        if (!dwellState.active) {
          // start dwell timer
          dwellState.active = true;
          dwellState.startTime = currentTime;
          dwellState.position = { ...circle.center };
          dwellState.radius = circle.radius;
          dwellState.dwellComplete = false;
        } else {
          // check if brush is steady
          const positionChanged =
            Math.abs(circle.center.x - (dwellState.position?.x ?? 0)) >
              GRABBING_POSITION_THRESHOLD ||
            Math.abs(circle.center.y - (dwellState.position?.y ?? 0)) >
              GRABBING_POSITION_THRESHOLD;
          const radiusChanged =
            Math.abs(circle.radius - dwellState.radius) >
            GRABBING_RADIUS_THRESHOLD;

          if (positionChanged || radiusChanged) {
            // brush moved, reset timer
            dwellState.startTime = currentTime;
            dwellState.position = { ...circle.center };
            dwellState.radius = circle.radius;
            dwellState.dwellComplete = false;
          } else if (!dwellState.dwellComplete) {
            // brush is steady, check dwell time
            const elapsedTime = currentTime - dwellState.startTime;
            if (elapsedTime >= GRABBING_DWELL_TIME) {
              // dwell complete, for remote we just mark it as complete
              dwellState.dwellComplete = true; // prevent multiple creations
            } else {
              // draw dwell progress indicator
              const progress = elapsedTime / GRABBING_DWELL_TIME;
              ctx.beginPath();
              ctx.arc(
                circle.center.x,
                circle.center.y,
                circle.radius + 8,
                -Math.PI / 2,
                -Math.PI / 2 + progress * 2 * Math.PI
              );
              ctx.strokeStyle = 'rgba(255, 213, 128, 0.9)'; // amber color
              ctx.lineWidth = 4;
              ctx.stroke();
            }
          }
        }
      }
    }
  });
}

// remote handler for "thumb_index" gesture - purely visual with no event dispatching
export function handleThumbIndex(
  ctx: CanvasRenderingContext2D,
  results: GestureRecognizerResult,
  rect: DOMRect,
  dimensions: CanvasDimensions
): void {
  if (
    !results.landmarks?.length ||
    !results.handedness?.length ||
    !results.gestures?.length
  ) {
    return;
  }

  const now = Date.now();

  // process each hand
  results.handedness.forEach((hand, index) => {
    const handLabel = hand[0].displayName.toLowerCase() as 'left' | 'right';
    const gesture = results.gestures![index][0].categoryName;
    const clickState = remoteGestureClickState[handLabel];

    // Check and update ripple animation if active
    const handRippleState = remoteRippleState[handLabel];
    if (handRippleState.active && handRippleState.point) {
      const rippleElapsed = now - handRippleState.startTime;
      handRippleState.progress = Math.min(
        1,
        rippleElapsed / RIPPLE_ANIMATION_DURATION
      );

      // Draw the ripple effect
      drawRippleEffect(ctx, handRippleState.point, handRippleState.progress);

      // Deactivate ripple when animation completes
      if (handRippleState.progress >= 1) {
        handRippleState.active = false;
        handRippleState.point = null;
      }
    }

    const landmarks = results.landmarks![index];
    const indexTip = landmarks[8];
    const point = landmarkToInteractionPoint(indexTip, dimensions, rect);

    if (gesture === 'thumb_index') {
      // draw visual indicator using the drawing utility
      drawThumbIndexGestureFeedback(ctx, point);

      // handle gesture state tracking - matching local implementation
      // if we're in idle state and see thumb_index, start potential click
      if (clickState.state === 'idle') {
        clickState.state = 'potential_click';
        clickState.startTime = now;
      }
    } else if (gesture === 'one') {
      // if we were in potential click state and now see "one", complete the click gesture
      if (clickState.state === 'potential_click') {
        const elapsedTime = now - clickState.startTime;

        // check if the transition happened within the time constraint
        if (elapsedTime <= CLICK_GESTURE_TIME_CONSTRAINT) {
          // start ripple animation at the click point (current position) - matching local behavior
          handRippleState.active = true;
          handRippleState.point = { ...point }; // use current position for ripple
          handRippleState.startTime = now;
          handRippleState.progress = 0;
        }

        // reset click state after handling
        clickState.state = 'idle';
      }
    } else {
      // for any other gesture, check if we need to expire a potential click
      if (clickState.state === 'potential_click') {
        const elapsedTime = now - clickState.startTime;

        // if we exceeded the time constraint, reset the click state
        if (elapsedTime > CLICK_GESTURE_TIME_CONSTRAINT) {
          clickState.state = 'idle';
        }
      }
    }
  });
}

// remote handler for "ok" gesture - purely visual with no event dispatching
export function handleOk(
  ctx: CanvasRenderingContext2D,
  results: GestureRecognizerResult,
  rect: DOMRect,
  dimensions: CanvasDimensions
): void {
  if (
    !results.landmarks?.length ||
    !results.handedness?.length ||
    !results.gestures?.length
  ) {
    return;
  }

  const currentTime = Date.now();

  // Check for active ripple animations and draw them
  for (const handLabel of ['left', 'right'] as const) {
    const handRippleState = remoteRippleState[handLabel];
    if (handRippleState.active && handRippleState.point) {
      const rippleElapsed = currentTime - handRippleState.startTime;
      handRippleState.progress = Math.min(
        1,
        rippleElapsed / RIPPLE_ANIMATION_DURATION
      );

      // Draw the ripple effect
      drawRippleEffect(ctx, handRippleState.point, handRippleState.progress);

      // Deactivate ripple when animation completes
      if (handRippleState.progress >= 1) {
        handRippleState.active = false;
        handRippleState.point = null;
      }
    }
  }

  // Draw orange points for any hand doing "ok" gesture
  results.handedness.forEach((hand, index) => {
    const gesture = results.gestures![index][0].categoryName;
    if (gesture === 'ok') {
      const landmarks = results.landmarks![index];

      // Get fingertip positions
      const indexTip = landmarkToInteractionPoint(
        landmarks[8],
        dimensions,
        rect
      );
      const thumbTip = landmarkToInteractionPoint(
        landmarks[4],
        dimensions,
        rect
      );

      // Draw visual feedback only
      drawOkGestureFeedback(ctx, indexTip, thumbTip);
    }
  });
}

// remote handler for "fist" gesture - purely visual with no event dispatching
export function handleFist(
  ctx: CanvasRenderingContext2D,
  results: GestureRecognizerResult,
  rect: DOMRect,
  dimensions: CanvasDimensions
): void {
  if (
    !results.landmarks?.length ||
    !results.handedness?.length ||
    !results.gestures?.length
  ) {
    // Reset dwell states when no hands are detected
    remoteFistDwellState.left.active = false;
    remoteFistDwellState.left.dwellComplete = false;
    remoteFistDwellState.right.active = false;
    remoteFistDwellState.right.dwellComplete = false;
    return;
  }

  const currentTime = Date.now();

  // Check for active ripple animations and draw them
  for (const handLabel of ['left', 'right'] as const) {
    const handRippleState = remoteRippleState[handLabel];
    if (handRippleState.active && handRippleState.point) {
      const rippleElapsed = currentTime - handRippleState.startTime;
      handRippleState.progress = Math.min(
        1,
        rippleElapsed / RIPPLE_ANIMATION_DURATION
      );

      // Draw the ripple effect
      drawRippleEffect(ctx, handRippleState.point, handRippleState.progress);

      // Deactivate ripple when animation completes
      if (handRippleState.progress >= 1) {
        handRippleState.active = false;
        handRippleState.point = null;
      }
    }
  }

  // Track hands that are not making fist gesture to reset their dwell state
  results.handedness.forEach((hand, idx) => {
    const handedness = hand[0].displayName.toLowerCase() as 'left' | 'right';
    const gesture = results.gestures![idx][0].categoryName;

    // If hand is not making fist gesture, reset its dwell state
    if (gesture !== 'fist' && remoteFistDwellState[handedness].active) {
      remoteFistDwellState[handedness].active = false;
      remoteFistDwellState[handedness].dwellComplete = false;
    }
  });

  // Find hands with active fist gestures
  const fistHandsInfo = results.handedness
    .map((hand, idx) => ({
      index: idx,
      handedness: hand[0].displayName.toLowerCase() as 'left' | 'right',
      gesture: results.gestures![idx][0].categoryName,
    }))
    .filter((hand) => hand.gesture === 'fist');

  // Get hands that have completed the dwell time
  const activeFistHandIndices = fistHandsInfo
    .filter((hand) => remoteFistDwellState[hand.handedness].dwellComplete)
    .map((hand) => hand.index);

  // Draw fist gesture visualizations with dwell time indicators
  results.handedness.forEach((hand, index) => {
    const handedness = hand[0].displayName.toLowerCase() as 'left' | 'right';
    const gesture = results.gestures![index][0].categoryName;

    if (gesture === 'fist') {
      const dwellState = remoteFistDwellState[handedness];

      // Start timer if this is a new fist gesture
      if (!dwellState.active) {
        dwellState.startTime = currentTime;
        dwellState.active = true;
        dwellState.dwellComplete = false;
      }
      // Check if dwell time is complete
      else if (!dwellState.dwellComplete) {
        const elapsedTime = currentTime - dwellState.startTime;
        if (elapsedTime >= FIST_DWELL_TIME) {
          dwellState.dwellComplete = true;
        }
      }

      // Draw feedback for this fist
      const landmarks = results.landmarks![index];
      const palmCenter = landmarkToInteractionPoint(
        landmarks[0],
        dimensions,
        rect
      );

      // Draw dwell progress indicator along with fist feedback
      if (dwellState.active && !dwellState.dwellComplete) {
        // Calculate progress as a value between 0 and 1
        const progress = Math.min(
          1,
          (currentTime - dwellState.startTime) / FIST_DWELL_TIME
        );

        // For in-progress dwell, draw a partial circle that fills up
        const radius = 12; // Same radius as in drawFistGestureFeedback

        // First draw the outline circle
        ctx.beginPath();
        ctx.arc(palmCenter.x, palmCenter.y, radius, 0, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(50, 205, 50, 0.8)'; // Green outline
        ctx.lineWidth = 2;
        ctx.stroke();

        // Then draw the progress as a filled sector
        ctx.beginPath();
        ctx.moveTo(palmCenter.x, palmCenter.y);
        ctx.arc(
          palmCenter.x,
          palmCenter.y,
          radius,
          -Math.PI / 2, // start at 12 o'clock position
          -Math.PI / 2 + progress * 2 * Math.PI, // end based on progress
          false // draw clockwise
        );
        ctx.fillStyle = 'rgba(50, 205, 50, 0.6)'; // Lighter green fill
        ctx.fill();

        // Draw the outer ring
        ctx.beginPath();
        ctx.arc(palmCenter.x, palmCenter.y, radius + 4, 0, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(50, 205, 50, 0.3)';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (dwellState.dwellComplete) {
        // When dwell is complete, use the normal feedback which is a solid circle
        drawFistGestureFeedback(ctx, palmCenter);

        // If in zoom mode (two active fists), we'll draw the zoom indicator at the center point later
        // Only draw move indicator for single hand panning
        if (activeFistHandIndices.length === 1) {
          drawMoveToolIndicator(ctx, palmCenter);
        }
      } else {
        // Shouldn't reach here, but just in case, draw basic feedback
        drawFistGestureFeedback(ctx, palmCenter);
      }
    }
  });

  // If we have two hands with active "fist" gesture, draw a zoom feedback
  if (activeFistHandIndices.length === 2) {
    const hand1 = results.landmarks![activeFistHandIndices[0]];
    const hand2 = results.landmarks![activeFistHandIndices[1]];

    // get center of palm positions for both hands
    const point1 = getLandmarkPosition(
      hand1[0], // palm center
      dimensions.width,
      dimensions.height
    );
    const point2 = getLandmarkPosition(
      hand2[0], // palm center
      dimensions.width,
      dimensions.height
    );

    // calculate center point between hands
    const center = {
      x: dimensions.width - (point1.x + point2.x) / 2,
      y: (point1.y + point2.y) / 2,
    };

    // Create interaction point for the zoom center
    const zoomCenter: InteractionPoint = {
      x: (point1.x + point2.x) / 2,
      y: (point1.y + point2.y) / 2,
      clientX: 0, // not needed for drawing
      clientY: 0, // not needed for drawing
    };

    // Draw the zoom tool indicator at the center point
    drawZoomToolIndicator(ctx, zoomCenter, point1, point2);

    // Draw zoom feedback (lines connecting hands)
    drawZoomFeedback(ctx, point1, point2, center, dimensions);
  }
}
