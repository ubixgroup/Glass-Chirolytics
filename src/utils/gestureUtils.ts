import { GestureData } from '@/types/types';
import { GestureRecognizerResult } from '@mediapipe/tasks-vision';

// local type thats just a pair of gesture data results
type ProcessedGestures = {
  leftGestureData: GestureData | null;
  rightGestureData: GestureData | null;
};

/**
 * processes mediapipe gesture recognition results and extracts gesture data for each hand (for GestureOutput.tsx)
 * @param results mediapipe gesture recognition results
 * @returns object containing processed gesture data for left and right hands
 */
export function processGestureData(
  results: GestureRecognizerResult
): ProcessedGestures {
  let leftGesture = null;
  let rightGesture = null;

  if (results.gestures && results.gestures.length > 0 && results.handedness) {
    for (let i = 0; i < results.gestures.length; i++) {
      const gesture = results.gestures[i][0];
      const handLabel = results.handedness[i][0].displayName.toLowerCase();
      if (handLabel === 'left' && !leftGesture) {
        leftGesture = gesture;
      } else if (handLabel === 'right' && !rightGesture) {
        rightGesture = gesture;
      }
    }
  }

  return {
    leftGestureData: leftGesture
      ? {
          categoryName: leftGesture.categoryName,
          confidence: leftGesture.score,
        }
      : null,
    rightGestureData: rightGesture
      ? {
          categoryName: rightGesture.categoryName,
          confidence: rightGesture.score,
        }
      : null,
  };
}
