import { Point } from '@/types/types';
import { minEnclosingCircle, getLandmarkPosition } from '@/utils/mathUtils';
import {
  NormalizedLandmark,
  GestureRecognizerResult,
} from '@mediapipe/tasks-vision';
import { CanvasDimensions } from '@/types/types';
import {
  InteractionEventHandler,
  InteractionPoint,
  CreateStickyBrushEvent,
} from '@/types/interactionTypes';
import {
  drawOneGestureFeedback,
  drawGrabbingGestureFeedback,
  drawThumbIndexGestureFeedback,
  drawOkGestureFeedback,
  drawZoomFeedback,
  drawFistGestureFeedback,
  drawRippleEffect,
} from '@/utils/drawingUtils';
import { QuadTree, QuadTreeBounds } from '@/utils/quadtree';

// quadtree state management
const quadTreeState = {
  left: null as QuadTree | null,
  right: null as QuadTree | null,
  lastUpdateTime: 0,
  updateIntervalMs: 100, // rebuild quadtree every 100ms to handle dynamic content
};

// function to get element bounds in client coordinates
function getElementBounds(element: Element): QuadTreeBounds {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

// function to build quadtree from current dom elements
function buildQuadTree(): QuadTree {
  // use much larger viewport bounds to account for all possible map transforms
  // this ensures elements don't get excluded when the map is panned/zoomed
  // the original issue was that elements at the edges could be outside the fixed
  // (0, 0, 1280, 720) bounds due to map transformations
  const viewportBounds: QuadTreeBounds = {
    x: -5000, // expand bounds significantly to handle all transforms
    y: -5000,
    width: 10000 + 1280, // original width + buffer
    height: 10000 + 720, // original height + buffer
  };
  const quadTree = new QuadTree(viewportBounds);

  // find all interactable elements in the current viewport
  const allElements = document.querySelectorAll('*');

  for (const element of allElements) {
    if (isInteractableElement(element)) {
      const bounds = getElementBounds(element);

      // only add elements that are visible and have non-zero bounds
      if (bounds.width > 0 && bounds.height > 0) {
        quadTree.insert({ element, bounds });
      }
    }
  }

  return quadTree;
}

// function to get or update quadtree for a hand
function getQuadTree(handLabel: 'left' | 'right'): QuadTree {
  const now = Date.now();
  const shouldUpdate =
    !quadTreeState[handLabel] ||
    now - quadTreeState.lastUpdateTime > quadTreeState.updateIntervalMs;

  if (shouldUpdate) {
    quadTreeState[handLabel] = buildQuadTree();
    quadTreeState.lastUpdateTime = now;
  }

  return quadTreeState[handLabel]!;
}

// function to clear quadtree state (useful for cleanup)
function clearQuadTreeState(): void {
  quadTreeState.left = null;
  quadTreeState.right = null;
  quadTreeState.lastUpdateTime = 0;
}

// type for getting current transform from the active visualization
export type GetCurrentTransformFn = () => {
  scale: number;
  x: number;
  y: number;
};

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

// state for tracking hover elements for each hand
let lastHoveredElementRight: Element | null = null;
let lastHoveredElementLeft: Element | null = null;

// state for tracking the last selected element in fine select mode per hand
const lastSelectedElementByHand: {
  left: Element | null;
  right: Element | null;
} = {
  left: null,
  right: null,
};

// state for tracking currently hovered elements for circle hover
const hoveredElementsByHand = {
  left: new Set<Element>(),
  right: new Set<Element>(),
};

// ripple effect animation state
interface RippleState {
  active: boolean;
  point: InteractionPoint | null;
  startTime: number;
  progress: number;
}

// ripple state tracking per hand
const rippleState: {
  left: RippleState;
  right: RippleState;
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
const RIPPLE_ANIMATION_DURATION = 400;

// state machine for tracking clicks (thumb_index to one gesture)
type GestureState = 'idle' | 'potential_click';
interface GestureClickState {
  state: GestureState;
  startTime: number;
}

// click gesture state tracking per hand
const gestureClickState: {
  left: GestureClickState;
  right: GestureClickState;
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

// time constraint for the click gesture (thumb_index → one) in milliseconds
const CLICK_GESTURE_TIME_CONSTRAINT = 500;

// transform state management - now uses current transform from visualization
let currentTransform = {
  scale: 1,
  x: 0,
  y: 0,
};

const zoomState = {
  startCenter: null as Point | null,
  lastDistance: null as number | null,
  fixedPoint: null as Point | null,
};

// state for tracking drag operations per hand
const fineSelectDragState = {
  left: {
    element: null as Element | null,
    active: false,
    startX: 0,
    startY: 0,
    gestureStartedInsideBox: false,
  },
  right: {
    element: null as Element | null,
    active: false,
    startX: 0,
    startY: 0,
    gestureStartedInsideBox: false,
  },
};

// track when transitioning from two hands to one hand to prevent jumps
let wasZooming = false;
let lastZoomCenter: Point | null = null;
let lastHandCount = 0; // track the number of hands with gesture
let initialDragPosition: Point | null = null; // track initial position for smooth transition
let transitionInProgress = false; // track if we're in the middle of a transition

// state for tracking fist gesture dwell time per hand
const fistDwellState = {
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

// dwell time in milliseconds before fist gesture can be used for navigation
const FIST_DWELL_TIME = 500;

// state for grabbing gesture dwell time to create sticky brushes
const grabbingDwellState = {
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

// helper function to check if element is interactable
// elements are interactable if they have the 'interactable' class
function isInteractableElement(element: Element | null): boolean {
  if (!element) return false;

  // simple check: element is interactable if it has the 'interactable' class
  return element.classList.contains('interactable');
}

// helper function to check if element is draggable
// elements are draggable if they have both 'interactable' and 'draggable' classes
function isDraggableElement(element: Element | null): boolean {
  if (!element) return false;

  // element must be both interactable and draggable
  return (
    element.classList.contains('interactable') &&
    element.classList.contains('draggable')
  );
}

// handles "one" gesture (replaces neutral mode)
// uses index finger (landmark 8) as pointer for hover interactions
export function handleOne(
  ctx: CanvasRenderingContext2D,
  results: GestureRecognizerResult,
  rect: DOMRect,
  dimensions: CanvasDimensions,
  onInteraction: InteractionEventHandler,
  drawOnly = false
): void {
  if (
    !results.landmarks?.length ||
    !results.handedness?.length ||
    !results.gestures?.length
  ) {
    return;
  }

  // process each hand
  results.handedness.forEach((hand, index) => {
    const handLabel = hand[0].displayName.toLowerCase() as 'left' | 'right';
    const gesture = results.gestures![index][0].categoryName;
    const clickState = gestureClickState[handLabel];
    const now = Date.now();

    // Check and update ripple animation if active
    const handRippleState = rippleState[handLabel];
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

    // only process hovering if gesture is "one"
    if (gesture !== 'one') {
      // for any other gesture, check if we need to expire a potential click
      if (!drawOnly && clickState.state === 'potential_click') {
        const elapsedTime = now - clickState.startTime;

        // if we exceeded the time constraint, reset the click state
        if (elapsedTime > CLICK_GESTURE_TIME_CONSTRAINT) {
          clickState.state = 'idle';
        }
      }
      return;
    }

    const landmarks = results.landmarks![index];

    // get index fingertip position
    const indexTip = landmarks[8];
    const point = landmarkToInteractionPoint(indexTip, dimensions, rect);

    // if we were in potential click state and now see "one", complete the click gesture
    if (!drawOnly && clickState.state === 'potential_click') {
      const elapsedTime = now - clickState.startTime;

      // check if the transition happened within the time constraint
      if (elapsedTime <= CLICK_GESTURE_TIME_CONSTRAINT) {
        // Get the element at the current position
        const element = document.elementFromPoint(point.clientX, point.clientY);

        // Complete the click regardless of whether we're over the same element
        if (element && isInteractableElement(element)) {
          onInteraction({
            type: 'pointerselect',
            point: point, // use current index finger position instead of stored point
            timestamp: now,
            sourceType: 'gesture',
            handedness: handLabel,
            element: element,
          });
        }
        // Start ripple animation at the click point (current position)
        handRippleState.active = true;
        handRippleState.point = { ...point }; // use current position for ripple
        handRippleState.startTime = now;
        handRippleState.progress = 0;
      }

      // reset click state after handling
      clickState.state = 'idle';
    }

    // handle hover state based on hand if not in drawOnly mode
    if (!drawOnly) {
      // get element at current position
      const currentElement = document.elementFromPoint(
        point.clientX,
        point.clientY
      );

      if (handLabel === 'right') {
        // handle right hand hover
        if (currentElement !== lastHoveredElementRight && currentElement) {
          // send pointerout to previous element
          if (lastHoveredElementRight) {
            onInteraction({
              type: 'pointerout',
              point,
              timestamp: Date.now(),
              sourceType: 'gesture',
              handedness: 'right',
              element: lastHoveredElementRight,
            });
          }

          // send pointerover to new element
          if (isInteractableElement(currentElement)) {
            onInteraction({
              type: 'pointerover',
              point,
              timestamp: Date.now(),
              sourceType: 'gesture',
              handedness: 'right',
              element: currentElement,
            });
          }

          // update right hand hover state
          lastHoveredElementRight = currentElement;
        }
      } else {
        // handle left hand hover
        if (currentElement !== lastHoveredElementLeft && currentElement) {
          // send pointerout to previous element
          if (lastHoveredElementLeft) {
            onInteraction({
              type: 'pointerout',
              point,
              timestamp: Date.now(),
              sourceType: 'gesture',
              handedness: 'left',
              element: lastHoveredElementLeft,
            });
          }

          // send pointerover to new element
          if (isInteractableElement(currentElement)) {
            onInteraction({
              type: 'pointerover',
              point,
              timestamp: Date.now(),
              sourceType: 'gesture',
              handedness: 'left',
              element: currentElement,
            });
          }

          // update left hand hover state
          lastHoveredElementLeft = currentElement;
        }
      }
    }

    // draw visual feedback using the drawing utility
    drawOneGestureFeedback(ctx, point);
  });
}

// handles "grabbing" gesture using quadtree for efficient spatial queries
export function handleGrabbing(
  ctx: CanvasRenderingContext2D,
  results: GestureRecognizerResult,
  rect: DOMRect,
  dimensions: CanvasDimensions,
  onInteraction: InteractionEventHandler,
  drawOnly = false,
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

  // process each hand
  results.handedness.forEach((hand, index) => {
    const handLabel = hand[0].displayName.toLowerCase() as 'left' | 'right';
    const gesture = results.gestures![index][0].categoryName;
    const dwellState = grabbingDwellState[handLabel];

    // only process if gesture is "grabbing"
    if (gesture !== 'grabbing') {
      // if the gesture is no longer grabbing, clear all hover states for this hand
      // and reset dwell state
      if (dwellState.active) {
        dwellState.active = false;
        dwellState.dwellComplete = false;
      }

      if (!drawOnly) {
        const currentlyHovered = hoveredElementsByHand[handLabel];
        if (currentlyHovered.size > 0) {
          // send pointerout for each element
          Array.from(currentlyHovered).forEach((element) => {
            if (isInteractableElement(element)) {
              // use the center of the element as the pointer position
              const elementRect = element.getBoundingClientRect();
              const point: InteractionPoint = {
                x: 0,
                y: 0,
                clientX: elementRect.left + elementRect.width / 2,
                clientY: elementRect.top + elementRect.height / 2,
              };

              onInteraction({
                type: 'pointerout',
                point,
                timestamp: Date.now(),
                sourceType: 'gesture',
                handedness: handLabel,
                element, // explicitly pass the element to ensure proper cleanup
              });
            }
          });
          currentlyHovered.clear();
        }
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
      // draw visual feedback for the hover area
      drawGrabbingGestureFeedback(ctx, circle);

      // handle dwell logic for sticky brush creation (skipped when sticky brushes disabled)
      if (!drawOnly) {
        if (!stickyBrushesEnabled) {
          // when disabled, ensure dwell state does not persist
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
                // dwell complete, create sticky brush
                const clientCenter: Point = {
                  x: rect.left + (dimensions.width - circle.center.x),
                  y: rect.top + circle.center.y,
                };

                onInteraction({
                  type: 'createStickyBrush',
                  brush: {
                    center: clientCenter,
                    radius: circle.radius,
                  },
                  timestamp: currentTime,
                  sourceType: 'gesture',
                  handedness: handLabel,
                } as CreateStickyBrushEvent);

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

      if (!drawOnly) {
        // use quadtree to efficiently find elements in the circle
        const quadTree = getQuadTree(handLabel);

        // convert canvas coordinates to client coordinates for quadtree query
        const clientCenter: Point = {
          x: rect.left + (dimensions.width - circle.center.x),
          y: rect.top + circle.center.y,
        };

        // query quadtree for elements intersecting the circle
        const potentialElements = quadTree.queryCircle(
          clientCenter,
          circle.radius
        );

        // check if gesture is over a panel area to prevent bleed-through
        const panelElements = document.querySelectorAll('svg.interactable');
        let isOverPanel = false;
        let panelSvg: Element | null = null;

        for (const panel of panelElements) {
          const panelRect = panel.getBoundingClientRect();
          if (
            clientCenter.x >= panelRect.left &&
            clientCenter.x <= panelRect.right &&
            clientCenter.y >= panelRect.top &&
            clientCenter.y <= panelRect.bottom
          ) {
            isOverPanel = true;
            panelSvg = panel;
            break;
          }
        }

        // filter to only interactable elements and create final set
        const elementsInCircle = new Set<Element>();

        for (const element of potentialElements) {
          if (isInteractableElement(element)) {
            // if gesture is over a panel, only include elements that are within that panel
            if (isOverPanel && panelSvg) {
              const isElementInPanel = panelSvg.contains(element);
              if (!isElementInPanel) {
                continue; // skip elements outside the panel when gesture is over panel
              }
            }

            // do a final precise check to ensure element actually intersects the circle
            const elementRect = element.getBoundingClientRect();

            // find the closest point on the rectangle to the center of the circle
            const closestX = Math.max(
              elementRect.left,
              Math.min(clientCenter.x, elementRect.right)
            );
            const closestY = Math.max(
              elementRect.top,
              Math.min(clientCenter.y, elementRect.bottom)
            );

            // calculate the squared distance between the closest point and the circle's center
            const distanceX = clientCenter.x - closestX;
            const distanceY = clientCenter.y - closestY;
            const distanceSquared =
              distanceX * distanceX + distanceY * distanceY;

            // if the distance is less than the circle's radius squared, they intersect
            if (distanceSquared <= circle.radius * circle.radius) {
              elementsInCircle.add(element);
            }
          }
        }

        // get arrays of elements to start and end hovering
        const currentlyHovered = hoveredElementsByHand[handLabel];
        const elementsToStartHovering = Array.from(elementsInCircle).filter(
          (element) => !currentlyHovered.has(element)
        );
        const elementsToStopHovering = Array.from(currentlyHovered).filter(
          (element) => !elementsInCircle.has(element)
        );

        // send hover events (using pointerover/pointerout for simplicity)
        if (elementsToStartHovering.length > 0) {
          // Only dispatch if there are interactable elements
          const interactableElements = elementsToStartHovering.filter(
            isInteractableElement
          );
          if (interactableElements.length > 0) {
            // send pointerover for each element instead of coarsehoverstart
            interactableElements.forEach((element) => {
              // use the center of the element as the pointer position
              const elementRect = element.getBoundingClientRect();
              const point: InteractionPoint = {
                x: circle.center.x, // use circle center for x
                y: circle.center.y, // use circle center for y
                clientX: elementRect.left + elementRect.width / 2,
                clientY: elementRect.top + elementRect.height / 2,
              };

              onInteraction({
                type: 'pointerover',
                point,
                timestamp: Date.now(),
                sourceType: 'gesture',
                handedness: handLabel,
                element, // explicitly pass the element for better tracking
              });
            });
          }
        }

        if (elementsToStopHovering.length > 0) {
          // Only dispatch if there are interactable elements
          const interactableElements = elementsToStopHovering.filter(
            isInteractableElement
          );
          if (interactableElements.length > 0) {
            // send pointerout for each element instead of coarsehoverend
            interactableElements.forEach((element) => {
              // use the center of the element as the pointer position
              const elementRect = element.getBoundingClientRect();
              const point: InteractionPoint = {
                x: circle.center.x, // use circle center for x
                y: circle.center.y, // use circle center for y
                clientX: elementRect.left + elementRect.width / 2,
                clientY: elementRect.top + elementRect.height / 2,
              };

              onInteraction({
                type: 'pointerout',
                point,
                timestamp: Date.now(),
                sourceType: 'gesture',
                handedness: handLabel,
                element, // explicitly pass the element to ensure proper cleanup
              });
            });
          }
        }

        // update hover state with only interactable elements
        hoveredElementsByHand[handLabel] = new Set(
          Array.from(elementsInCircle).filter(isInteractableElement)
        );
      }
    } else if (!drawOnly) {
      const currentlyHovered = hoveredElementsByHand[handLabel];
      if (currentlyHovered.size > 0) {
        // send pointerout for each element instead of coarsehoverend
        Array.from(currentlyHovered).forEach((element) => {
          if (isInteractableElement(element)) {
            // use the center of the element as the pointer position
            const elementRect = element.getBoundingClientRect();
            const point: InteractionPoint = {
              x: 0, // we don't have circle data here, so use default
              y: 0,
              clientX: elementRect.left + elementRect.width / 2,
              clientY: elementRect.top + elementRect.height / 2,
            };

            onInteraction({
              type: 'pointerout',
              point,
              timestamp: Date.now(),
              sourceType: 'gesture',
              handedness: handLabel,
              element, // explicitly pass the element to ensure proper cleanup
            });
          }
        });
        currentlyHovered.clear();
      }
    }
  });
}

// handles thumb_index gesture for precise selection, tracking selection per hand
export function handleThumbIndex(
  ctx: CanvasRenderingContext2D,
  results: GestureRecognizerResult,
  rect: DOMRect,
  dimensions: CanvasDimensions,
  onInteraction: InteractionEventHandler,
  drawOnly = false
): void {
  if (
    !results.landmarks?.length ||
    !results.handedness?.length ||
    !results.gestures?.length
  ) {
    // clear selection state if no hands are detected
    if (!drawOnly) {
      lastSelectedElementByHand.left = null;
      lastSelectedElementByHand.right = null;
    }
    return;
  }

  // process each hand
  results.handedness.forEach((hand, index) => {
    const handLabel = hand[0].displayName.toLowerCase() as 'left' | 'right';
    const gesture = results.gestures![index][0].categoryName;
    const clickState = gestureClickState[handLabel];
    const now = Date.now();

    // Check and update ripple animation if active
    const handRippleState = rippleState[handLabel];
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

      // handle gesture state tracking if not in drawOnly mode
      if (!drawOnly) {
        // if we're in idle state and see thumb_index, start potential click
        if (clickState.state === 'idle') {
          clickState.state = 'potential_click';
          clickState.startTime = now;
        }

        // handle hover state based on hand (same logic as handleOne)
        // get element at current position
        const currentElement = document.elementFromPoint(
          point.clientX,
          point.clientY
        );

        if (handLabel === 'right') {
          // handle right hand hover
          if (currentElement !== lastHoveredElementRight && currentElement) {
            // send pointerout to previous element
            if (lastHoveredElementRight) {
              onInteraction({
                type: 'pointerout',
                point,
                timestamp: Date.now(),
                sourceType: 'gesture',
                handedness: 'right',
                element: lastHoveredElementRight,
              });
            }

            // send pointerover to new element
            if (isInteractableElement(currentElement)) {
              onInteraction({
                type: 'pointerover',
                point,
                timestamp: Date.now(),
                sourceType: 'gesture',
                handedness: 'right',
                element: currentElement,
              });
            }

            // update right hand hover state
            lastHoveredElementRight = currentElement;
          }
        } else {
          // handle left hand hover
          if (currentElement !== lastHoveredElementLeft && currentElement) {
            // send pointerout to previous element
            if (lastHoveredElementLeft) {
              onInteraction({
                type: 'pointerout',
                point,
                timestamp: Date.now(),
                sourceType: 'gesture',
                handedness: 'left',
                element: lastHoveredElementLeft,
              });
            }

            // send pointerover to new element
            if (isInteractableElement(currentElement)) {
              onInteraction({
                type: 'pointerover',
                point,
                timestamp: Date.now(),
                sourceType: 'gesture',
                handedness: 'left',
                element: currentElement,
              });
            }

            // update left hand hover state
            lastHoveredElementLeft = currentElement;
          }
        }
      }
    } else if (gesture === 'one') {
      // if we were in potential click state and now see "one", complete the click gesture
      if (!drawOnly && clickState.state === 'potential_click') {
        const elapsedTime = now - clickState.startTime;

        // check if the transition happened within the time constraint
        if (elapsedTime <= CLICK_GESTURE_TIME_CONSTRAINT) {
          // Get the element at the current position
          const element = document.elementFromPoint(
            point.clientX,
            point.clientY
          );

          // Complete the click regardless of whether we're over the same element
          if (element && isInteractableElement(element)) {
            onInteraction({
              type: 'pointerselect',
              point: point, // use current index finger position instead of stored point
              timestamp: now,
              sourceType: 'gesture',
              handedness: handLabel,
              element: element,
            });

            // Start ripple animation at the click point (current position)
            handRippleState.active = true;
            handRippleState.point = { ...point }; // use current position for ripple
            handRippleState.startTime = now;
            handRippleState.progress = 0;
          }
        }

        // reset click state after handling
        clickState.state = 'idle';
      } else {
        // for any other gesture, check if we need to expire a potential click
        if (!drawOnly && clickState.state === 'potential_click') {
          const elapsedTime = now - clickState.startTime;

          // if we exceeded the time constraint, reset the click state
          if (elapsedTime > CLICK_GESTURE_TIME_CONSTRAINT) {
            clickState.state = 'idle';
          }
        }
      }
    } else {
      // for any other gesture, check if we need to expire a potential click
      if (!drawOnly && clickState.state === 'potential_click') {
        const elapsedTime = now - clickState.startTime;

        // if we exceeded the time constraint, reset the click state
        if (elapsedTime > CLICK_GESTURE_TIME_CONSTRAINT) {
          clickState.state = 'idle';
        }
      }
    }
  });
}

/**
 * handles 'ok' gesture for dragging elements
 * uses the 'ok' hand gesture to grab and manipulate individual elements
 */
export function handleOk(
  ctx: CanvasRenderingContext2D,
  results: GestureRecognizerResult,
  rect: DOMRect,
  dimensions: CanvasDimensions,
  onInteraction: InteractionEventHandler,
  drawOnly = false
): void {
  if (
    !results.landmarks?.length ||
    !results.handedness?.length ||
    !results.gestures?.length
  ) {
    // reset all states when no hands are detected (only if not in drawOnly mode)
    if (!drawOnly) {
      for (const handLabel of ['left', 'right'] as const) {
        const dragState = fineSelectDragState[handLabel];
        if (dragState.active && dragState.element) {
          onInteraction({
            type: 'pointerup',
            point: {
              x: 0,
              y: 0,
              clientX: 0,
              clientY: 0,
            },
            element: dragState.element,
            timestamp: Date.now(),
            sourceType: 'gesture',
            handedness: handLabel,
          });
          dragState.active = false;
          dragState.element = null;
        }
      }
    }
    return;
  }

  // draw orange points for any hand doing "ok" gesture
  results.handedness.forEach((hand, index) => {
    const gesture = results.gestures![index][0].categoryName;
    if (gesture === 'ok') {
      const landmarks = results.landmarks![index];

      // get fingertip positions
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

      // use drawing utility for fingertips
      drawOkGestureFeedback(ctx, indexTip, thumbTip);
    }
  });

  // skip all interaction logic if in drawOnly mode
  if (drawOnly) return;

  // get current hand states
  const currentHands = results.handedness.map((hand, idx) => ({
    handedness: hand[0].displayName.toLowerCase() as 'left' | 'right',
    gesture: results.gestures![idx][0].categoryName,
    landmarks: results.landmarks![idx],
  }));

  // process each hand with 'ok' gesture for element dragging
  currentHands.forEach((hand) => {
    if (hand.gesture === 'ok') {
      const handLabel = hand.handedness;

      // handle element dragging with 'ok' gesture
      handleSingleHandDragInside(
        hand.landmarks,
        dimensions,
        rect,
        handLabel,
        onInteraction
      );
    } else {
      // if not making 'ok' gesture, reset drag state for this hand
      const handLabel = hand.handedness;
      const dragState = fineSelectDragState[handLabel];

      if (dragState.active && dragState.element) {
        // send pointerup to end the drag when gesture ends
        onInteraction({
          type: 'pointerup',
          point: { x: 0, y: 0, clientX: 0, clientY: 0 },
          element: dragState.element,
          timestamp: Date.now(),
          sourceType: 'gesture',
          handedness: handLabel,
        });
        dragState.active = false;
        dragState.element = null;
      }
    }
  });
}

/**
 * handles 'fist' gesture for panning and zooming
 * single fist: pans the visualization
 * two fists: zooms the visualization
 * requires 500ms dwell time before gesture becomes active
 */
export function handleFist(
  ctx: CanvasRenderingContext2D,
  results: GestureRecognizerResult,
  rect: DOMRect,
  dimensions: CanvasDimensions,
  onInteraction: InteractionEventHandler,
  drawOnly = false,
  getCurrentTransform?: GetCurrentTransformFn
): void {
  if (
    !results.landmarks?.length ||
    !results.handedness?.length ||
    !results.gestures?.length
  ) {
    // reset states when no hands are detected
    if (!drawOnly) {
      if (!wasZooming) {
        resetZoomState();
      }

      lastHandCount = 0;

      // Reset dwell states
      fistDwellState.left.active = false;
      fistDwellState.left.dwellComplete = false;
      fistDwellState.right.active = false;
      fistDwellState.right.dwellComplete = false;
    }
    return;
  }

  // get current transform from the active visualization if available
  if (getCurrentTransform && !drawOnly) {
    const visualizationTransform = getCurrentTransform();
    currentTransform = {
      scale: visualizationTransform.scale,
      x: visualizationTransform.x,
      y: visualizationTransform.y,
    };
  }

  const currentTime = Date.now();

  // get current hands making fist gesture
  const fistHands = results.handedness
    .map((hand, idx) => ({
      index: idx,
      handedness: hand[0].displayName.toLowerCase() as 'left' | 'right',
      gesture: results.gestures![idx][0].categoryName,
      landmarks: results.landmarks![idx],
    }))
    .filter((hand) => hand.gesture === 'fist');

  // Track hands that are not making fist gesture to reset their dwell state
  results.handedness.forEach((hand, idx) => {
    const handedness = hand[0].displayName.toLowerCase() as 'left' | 'right';
    const gesture = results.gestures![idx][0].categoryName;

    // If hand is not making fist gesture, reset its dwell state
    if (gesture !== 'fist' && fistDwellState[handedness].active) {
      fistDwellState[handedness].active = false;
      fistDwellState[handedness].dwellComplete = false;
    }
  });

  // skip if no fist gestures detected
  if (fistHands.length === 0) {
    if (!drawOnly) {
      resetZoomState();
      wasZooming = false;
      lastZoomCenter = null;
      initialDragPosition = null;
      transitionInProgress = false;
      lastHandCount = 0;
    }
    return;
  }

  // Get hands that have completed the dwell time
  const activeFistHands = fistHands.filter(
    (hand) => fistDwellState[hand.handedness].dwellComplete
  );

  // Check dwell time and update states for each fist hand
  fistHands.forEach((hand) => {
    const handedness = hand.handedness;
    const dwellState = fistDwellState[handedness];

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
    const palmCenter = landmarkToInteractionPoint(
      hand.landmarks[0],
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
      if (activeFistHands.length === 1) {
        drawMoveToolIndicator(ctx, palmCenter);
      }
    } else {
      // Shouldn't reach here, but just in case, draw basic feedback
      drawFistGestureFeedback(ctx, palmCenter);
    }
  });

  // Skip interaction logic if no hands have completed dwell time
  if (activeFistHands.length === 0) {
    return;
  }

  // If we have two active fists, calculate and draw the zoom center indicator
  if (activeFistHands.length === 2) {
    activeFistHands.sort((a, b) => a.handedness.localeCompare(b.handedness));
    const handLandmarks = activeFistHands.map(
      (hand) => results.landmarks![hand.index]
    );

    // Calculate the center point between the two hands
    const point1 = getLandmarkPosition(
      handLandmarks[0][0], // palm center of first hand
      dimensions.width,
      dimensions.height
    );
    const point2 = getLandmarkPosition(
      handLandmarks[1][0], // palm center of second hand
      dimensions.width,
      dimensions.height
    );

    // Calculate the zoom center point
    const zoomCenter: InteractionPoint = {
      x: (point1.x + point2.x) / 2,
      y: (point1.y + point2.y) / 2,
      clientX: 0, // not needed for drawing
      clientY: 0, // not needed for drawing
    };

    // Draw the zoom tool indicator at the center point with arrows aligned with hand positions
    drawZoomToolIndicator(ctx, zoomCenter, point1, point2);
  }

  // The rest of the function remains unchanged, but we now use activeFistHands
  // instead of fistHands to only consider hands that have completed the dwell time

  // check for transition from two hands to one hand
  if (lastHandCount === 2 && activeFistHands.length === 1) {
    wasZooming = true;
    transitionInProgress = true;
    if (!lastZoomCenter && zoomState.startCenter) {
      lastZoomCenter = { ...zoomState.startCenter };
    }
    initialDragPosition = null;
  }

  lastHandCount = activeFistHands.length;

  // handle two-handed fist gesture (zooming)
  if (activeFistHands.length === 2) {
    activeFistHands.sort((a, b) => a.handedness.localeCompare(b.handedness));
    const handLandmarks = activeFistHands.map(
      (hand) => results.landmarks![hand.index]
    );

    handleTwoHandedZoom(
      ctx,
      handLandmarks,
      dimensions,
      onInteraction,
      drawOnly
    );
  }
  // handle single-handed fist gesture (panning)
  else if (activeFistHands.length === 1) {
    const hand = activeFistHands[0];
    const landmarks = results.landmarks![hand.index];

    handleSingleHandedDrag(landmarks, dimensions, onInteraction);
  }
}

// handles two-handed zoom operation
function handleTwoHandedZoom(
  ctx: CanvasRenderingContext2D,
  hands: NormalizedLandmark[][],
  dimensions: CanvasDimensions,
  onInteraction: InteractionEventHandler,
  drawOnly = false
): void {
  // mark that we are zooming to help with transition to dragging
  if (!drawOnly) {
    wasZooming = true;
    initialDragPosition = null; // reset initial drag position when zooming
    transitionInProgress = false; // not in transition while actively zooming
  }

  // get index fingertip positions for both hands
  const point1 = getLandmarkPosition(
    hands[0][0],
    dimensions.width,
    dimensions.height
  );
  const point2 = getLandmarkPosition(
    hands[1][0],
    dimensions.width,
    dimensions.height
  );

  // calculate distance between hands
  const currentDistance = Math.sqrt(
    Math.pow(point2.x - point1.x, 2) + Math.pow(point2.y - point1.y, 2)
  );

  // calculate center point between hands
  const center = {
    x: dimensions.width - (point1.x + point2.x) / 2,
    y: (point1.y + point2.y) / 2,
  };

  // store initial zoom center if this is the start of a zoom
  if (!drawOnly && !zoomState.lastDistance) {
    zoomState.startCenter = center;
    zoomState.fixedPoint = {
      x: (center.x - currentTransform.x) / currentTransform.scale,
      y: (center.y - currentTransform.y) / currentTransform.scale,
    };
  }

  // always update lastZoomCenter with the current center
  // this ensures we have the most recent position for transition to drag
  if (!drawOnly) {
    lastZoomCenter = { ...center };
  }

  // Draw zoom feedback using the drawing utility
  drawZoomFeedback(ctx, point1, point2, center, dimensions);

  // calculate and dispatch zoom transform - only if not in drawOnly mode
  if (!drawOnly && zoomState.lastDistance) {
    const scale = currentDistance / zoomState.lastDistance;
    const newScale = Math.max(0.4, Math.min(4, currentTransform.scale * scale));

    if (zoomState.fixedPoint) {
      const fp = zoomState.fixedPoint;
      currentTransform = {
        scale: newScale,
        x: center.x - fp.x * newScale,
        y: center.y - fp.y * newScale,
      };
    }

    onInteraction({
      type: 'zoom',
      transform: currentTransform,
      timestamp: Date.now(),
      sourceType: 'gesture',
    });
  }

  if (!drawOnly) {
    zoomState.lastDistance = currentDistance;
  }
}

// handles single-handed drag operation
function handleSingleHandedDrag(
  hand: NormalizedLandmark[],
  dimensions: CanvasDimensions,
  onInteraction: InteractionEventHandler
): void {
  const currentPosition = getLandmarkPosition(
    hand[0],
    dimensions.width,
    dimensions.height
  );

  // if transitioning from zoom to drag, use the last zoom center as reference point
  if (wasZooming && lastZoomCenter && !initialDragPosition) {
    // store the initial position of the hand for the drag operation
    initialDragPosition = { ...currentPosition };
    transitionInProgress = true; // mark that we're in transition

    // on the first frame after transition, don't apply any movement
    // just send the current transform to maintain continuity
    onInteraction({
      type: 'drag',
      transform: currentTransform,
      timestamp: Date.now(),
      sourceType: 'gesture',
    });

    // set the start center for next frame's movement calculation
    zoomState.startCenter = { ...currentPosition };
    return;
  }

  if (zoomState.startCenter) {
    const movementX = currentPosition.x - zoomState.startCenter.x;
    const movementY = currentPosition.y - zoomState.startCenter.y;

    // update transform relative to current position
    currentTransform = {
      ...currentTransform,
      x: currentTransform.x - movementX,
      y: currentTransform.y + movementY,
    };

    onInteraction({
      type: 'drag',
      transform: currentTransform,
      timestamp: Date.now(),
      sourceType: 'gesture',
    });
  }

  // update start center for next frame
  zoomState.startCenter = currentPosition;

  // clear the zooming flags after we've successfully started dragging
  // only end the transition after a few frames of successful dragging
  if (wasZooming && initialDragPosition && transitionInProgress) {
    // after a few frames, consider the transition complete
    if (
      Math.abs(currentPosition.x - initialDragPosition.x) > 5 ||
      Math.abs(currentPosition.y - initialDragPosition.y) > 5
    ) {
      wasZooming = false;
      lastZoomCenter = null;
      transitionInProgress = false;
    }
  }

  // don't reset lastDistance and fixedPoint when in the middle of a transition
  if (!wasZooming) {
    zoomState.lastDistance = null;
    zoomState.fixedPoint = null;
  }
}

// resets zoom state
function resetZoomState(): void {
  // store the last zoom center when resetting zoom state
  // this helps with smooth transitions from zoom to drag
  if (zoomState.startCenter) {
    lastZoomCenter = { ...zoomState.startCenter };
  }
  zoomState.startCenter = null;
  zoomState.lastDistance = null;
  zoomState.fixedPoint = null;
  initialDragPosition = null; // reset initial drag position when resetting zoom state
  transitionInProgress = false; // reset transition flag
}

// helper function to handle dragging elements inside the visualization
function handleSingleHandDragInside(
  landmarks: NormalizedLandmark[],
  dimensions: CanvasDimensions,
  rect: DOMRect,
  handLabel: 'left' | 'right',
  onInteraction: InteractionEventHandler
): void {
  const indexTip = landmarks[4];
  const point = landmarkToInteractionPoint(indexTip, dimensions, rect);
  const dragState = fineSelectDragState[handLabel];

  // get element at current position
  const element = dragState.active
    ? dragState.element
    : document.elementFromPoint(point.clientX, point.clientY);

  if (element && isDraggableElement(element)) {
    // start drag if not already dragging
    if (!dragState.active) {
      dragState.active = true;
      dragState.element = element;
      dragState.startX = point.clientX;
      dragState.startY = point.clientY;
      onInteraction({
        type: 'pointerdown',
        point,
        element,
        timestamp: Date.now(),
        sourceType: 'gesture',
        handedness: handLabel,
      });
    }
    // continue drag if already dragging
    else if (dragState.element) {
      onInteraction({
        type: 'pointermove',
        point,
        element: dragState.element,
        timestamp: Date.now(),
        sourceType: 'gesture',
        handedness: handLabel,
      });
    }
  }
}

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

/**
 * handles 'none' gesture or undetected hands for cleanup.
 * this function is responsible for sending 'pointerout' events to elements
 * that were previously hovered by 'one' (via lastHoveredElementLeft/Right)
 * or 'grabbing' (via hoveredElementsByHand) gestures when a hand
 * is no longer actively gesturing or is not detected.
 * it does not draw any visual feedback.
 */
export function handleNone(
  ctx: CanvasRenderingContext2D, // unused in this handler, kept for signature consistency
  results: GestureRecognizerResult,
  rect: DOMRect, // unused in this handler, kept for signature consistency
  dimensions: CanvasDimensions, // unused in this handler, kept for signature consistency
  onInteraction: InteractionEventHandler,
  drawOnly = false
): void {
  if (drawOnly) {
    return;
  }

  // clear quadtree state when no gestures are detected to free memory
  clearQuadTreeState();

  const handsToClean: Array<'left' | 'right'> = ['left', 'right'];

  // determine current gestures (or lack thereof) for each hand from the results
  const handGestures: { left?: string; right?: string } = {};
  if (results.handedness && results.gestures) {
    results.handedness.forEach((hand, index) => {
      // ensure gestures array is valid for this index
      if (
        results.gestures &&
        results.gestures[index] &&
        results.gestures[index][0]
      ) {
        const handLabel = hand[0].displayName.toLowerCase() as 'left' | 'right';
        const gesture = results.gestures[index][0].categoryName.toLowerCase();
        handGestures[handLabel] = gesture;
      }
    });
  }

  handsToClean.forEach((handLabel) => {
    const currentGesture = handGestures[handLabel]; // will be undefined if hand not in results or results.gestures is missing data

    let needsCleanup = false;
    // cleanup if gesture is 'none', empty, or hand is not detected (currentgesture is undefined)
    if (
      currentGesture === '' ||
      currentGesture === 'none' ||
      currentGesture === undefined
    ) {
      needsCleanup = true;
    }

    if (needsCleanup) {
      // cleanup for 'one' gesture hover state (single pointer hover)
      const lastHoveredOne =
        handLabel === 'left' ? lastHoveredElementLeft : lastHoveredElementRight;
      if (lastHoveredOne && isInteractableElement(lastHoveredOne)) {
        const elementRect = lastHoveredOne.getBoundingClientRect();
        const point: InteractionPoint = {
          x: 0, // canvas x coordinate, not critical for pointerout
          y: 0, // canvas y coordinate, not critical for pointerout
          clientX: elementRect.left + elementRect.width / 2, // client x based on element center
          clientY: elementRect.top + elementRect.height / 2, // client y based on element center
        };
        onInteraction({
          type: 'pointerout',
          point,
          timestamp: Date.now(),
          sourceType: 'gesture',
          handedness: handLabel,
          element: lastHoveredOne,
        });
        // reset the hover state for this hand
        if (handLabel === 'left') {
          lastHoveredElementLeft = null;
        } else {
          lastHoveredElementRight = null;
        }
      }

      // cleanup for 'grabbing' gesture hover state (area hover)
      const currentlyHoveredGrabbing = hoveredElementsByHand[handLabel];
      if (currentlyHoveredGrabbing.size > 0) {
        Array.from(currentlyHoveredGrabbing).forEach((element) => {
          if (isInteractableElement(element)) {
            const elementRect = element.getBoundingClientRect();
            const point: InteractionPoint = {
              x: 0, // canvas x coordinate
              y: 0, // canvas y coordinate
              clientX: elementRect.left + elementRect.width / 2, // client x based on element center
              clientY: elementRect.top + elementRect.height / 2, // client y based on element center
            };
            onInteraction({
              type: 'pointerout',
              point,
              timestamp: Date.now(),
              sourceType: 'gesture',
              handedness: handLabel,
              element,
            });
          }
        });
        // clear all hovered elements for this hand's grabbing gesture
        currentlyHoveredGrabbing.clear();
      }
    }
  });
}
