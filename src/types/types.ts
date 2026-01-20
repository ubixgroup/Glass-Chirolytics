import { GestureRecognizer } from '@mediapipe/tasks-vision';

// point and circle types (from mathUtils)
export type Point = {
  x: number;
  y: number;
};

export type Circle = {
  center: Point;
  radius: number;
};

// component props types
export type GestureData = {
  categoryName: string;
  confidence: number;
};

// gesture output props (from GestureOutput)
export type GestureOutputProps = {
  leftGestureData: GestureData | null;
  rightGestureData: GestureData | null;
};

export type CanvasProps = {
  gestureRecognizer: GestureRecognizer; // Replace 'any' with proper GestureRecognizer type when available
  videoRef: React.RefObject<HTMLVideoElement>;
  onCameraSelect?: (deviceId: string) => void;
};

export type CanvasDimensions = {
  width: number;
  height: number;
};

// type for available visualizations
export type Visualization = 'graph';

// type for memory usage data (for useMemoryUsage.ts)
export type MemoryUsage = {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
};

// type for media devices (for useCameraDevices.ts)
export type MediaDeviceInfo = {
  deviceId: string;
  kind: string;
  label: string;
  groupId: string;
};
