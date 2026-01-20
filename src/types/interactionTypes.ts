// interaction event types for the gesture-based interface
export type InteractionPoint = {
  x: number;
  y: number;
  clientX: number;
  clientY: number;
};

// base event type for all interaction events
export type BaseInteractionEvent = {
  timestamp: number;
  sourceType: 'gesture' | 'pointer';
  handedness?: 'left' | 'right'; // optional since pointer events may not have handedness
};

// specific event types
export type PointerOverEvent = BaseInteractionEvent & {
  type: 'pointerover';
  point: InteractionPoint;
  element?: Element;
};

export type PointerOutEvent = BaseInteractionEvent & {
  type: 'pointerout';
  point: InteractionPoint;
  element?: Element;
};

export type PointerSelectEvent = BaseInteractionEvent & {
  type: 'pointerselect';
  point: InteractionPoint;
  element?: Element;
};

export type PointerDownEvent = BaseInteractionEvent & {
  type: 'pointerdown';
  point: InteractionPoint;
  element: Element;
};

export type PointerMoveEvent = BaseInteractionEvent & {
  type: 'pointermove';
  point: InteractionPoint;
  element: Element;
};

export type PointerUpEvent = BaseInteractionEvent & {
  type: 'pointerup';
  point: InteractionPoint;
  element: Element;
};

// this is more like a zoom AND drag event
export type ZoomEvent = BaseInteractionEvent & {
  type: 'zoom';
  transform: {
    scale: number;
    x: number;
    y: number;
  };
};

// exclusively a drag event
export type DragEvent = BaseInteractionEvent & {
  type: 'drag';
  transform: {
    x: number;
    y: number;
  };
};

export type CreateStickyBrushEvent = BaseInteractionEvent & {
  type: 'createStickyBrush';
  brush: {
    center: { x: number; y: number };
    radius: number;
  };
};

// union type of all possible interaction events
export type InteractionEvent =
  | PointerOverEvent
  | PointerOutEvent
  | PointerSelectEvent
  | PointerDownEvent
  | PointerMoveEvent
  | PointerUpEvent
  | ZoomEvent
  | DragEvent
  | CreateStickyBrushEvent;

// event handler types
export type InteractionEventHandler = (event: InteractionEvent) => void;

// props interface for interactive components
export interface InteractiveComponentProps {
  onInteraction?: InteractionEventHandler;
}
