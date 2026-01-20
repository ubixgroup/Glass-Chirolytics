import React, { useRef, useState, useCallback, useEffect } from 'react';
import { GestureData } from '@/types/types';
import {
  setupCanvas,
  processVideoFrame,
  shouldProcessFrame,
} from '@/utils/canvasUtils';
import {
  handleOne as handleSvgOne,
  handleGrabbing as handleSvgGrabbing,
  handleThumbIndex as handleSvgThumbIndex,
  handleOk as handleSvgOk,
  handleFist as handleSvgFist,
  handleNone as handleSvgNone,
  GetCurrentTransformFn,
} from '@/utils/interactionHandlers';
import {
  handleOne as handleSvgOneRemote,
  handleGrabbing as handleSvgGrabbingRemote,
  handleThumbIndex as handleSvgThumbIndexRemote,
  handleOk as handleSvgOkRemote,
  handleFist as handleSvgFistRemote,
} from '@/utils/remoteInteractionHandlers';
import { InteractionEventHandler } from '@/types/interactionTypes';
import DebugDashboard from '@/components/canvasui/DebugDashboard';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useGestureRecognizer } from '@/hooks/useGestureRecognizer';
import { useWebcamFeed } from '@/hooks/useWebcamFeed';
import { useMemoryUsage } from '@/hooks/useMemoryUsage';
import Senate from '@/components/yjs-vis/Senate';
import TravelTask from '@/components/yjs-vis/TravelTask';
import Movies from '@/components/yjs-vis/Movies';
import DoMi from '@/components/yjs-vis/DoMi';
import Sankey from '@/components/yjs-vis/Sankey';
import Splom from '@/components/yjs-vis/Splom';
import SysDes from '@/components/yjs-vis/SysDes';
import { YjsProvider } from '@/context/YjsContext';
import getWebsocketUrl from '@/utils/websocketUtils';
import { drawHandLandmarks } from '@/utils/drawingUtils';
import { RemoteGestureData } from '@/hooks/useWebSocket';

// get the dynamic websocket url with connection type parameter
const baseUrl = getWebsocketUrl();
const videoUrl = new URL(baseUrl);
videoUrl.searchParams.set('type', 'video');
const WS_URL = videoUrl.toString();

// define the type for visualization selection
type VisualizationType =
  | 'senate'
  | 'traveltask'
  | 'movies'
  | 'domi'
  | 'sankey'
  | 'splom'
  | 'sysdes';

// main display component that:
// - manages webcam feed
// - handles gesture recognition
// - processes video frames
// - manages canvas overlay
// - handles interactions
// - displays debug information
const Display: React.FC = () => {
  // refs for video and canvas management
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const remoteCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastFrameTimeRef = useRef<number>(Date.now());
  const overlayRef = useRef<HTMLDivElement>(null);
  const rtcConnectedRef = useRef<boolean>(false);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const gestureBuffer = useRef<RemoteGestureData[]>([]);
  const lastRenderTime = useRef<number>(0);

  // ref for getting current transform from active visualization
  const getCurrentTransformRef = useRef<GetCurrentTransformFn | null>(null);

  // state for selected camera device
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');

  // state for feed toggle when remote feed is available
  const [showLocalFeed, setShowLocalFeed] = useState<boolean>(false);

  // state for selected visualization
  const [currentVisualization, setCurrentVisualization] =
    useState<VisualizationType>('traveltask');

  // gesture state management
  const [leftGestureData, setLeftGestureData] = useState<GestureData | null>(
    null
  );
  const [rightGestureData, setRightGestureData] = useState<GestureData | null>(
    null
  );

  // canvas dimensions
  const canvasWidth = 1280;
  const canvasHeight = 720;
  const MAX_GESTURE_BUFFER_SIZE = 300; // approx 5 seconds of data at 60fps

  // debug visibility state
  const [showDebug, setShowDebug] = useState<boolean>(false);

  // get gesture recognizer instances. one is for the local hands and the other is for the remote hands
  const gestureRecognizer = useGestureRecognizer();

  // start webcam feed
  const { isVideoFeedStarted, startWebcam } = useWebcamFeed(
    localVideoRef,
    selectedDeviceId
  );

  // websocket connection state - now only used for video feed
  const {
    isConnected,
    connectionError,
    currentUser,
    connectedUsers,
    rtcConnected,
    rtcConnectionState,
    remoteStream,
    currentPing,
    pingHistory,
    sendRtcData,
    remoteGestureData,
  } = useWebSocket(WS_URL, selectedDeviceId);

  // get memory usage data
  const memoryUsage = useMemoryUsage();

  // handle camera selection
  const handleCameraSelect = useCallback((deviceId: string) => {
    setSelectedDeviceId(deviceId);
  }, []);

  // start local webcam feed
  useEffect(() => {
    startWebcam();
  }, [startWebcam]);

  // handle remote stream
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // add an effect to update the refs when rtcConnected changes
  useEffect(() => {
    rtcConnectedRef.current = rtcConnected;
  }, [rtcConnected]);

  useEffect(() => {
    remoteStreamRef.current = remoteStream;
  }, [remoteStream]);

  // main webcam processing effect for both local and remote feeds
  useEffect(() => {
    // combined webcam processing loop for both local and remote feeds
    const processWebcams = () => {
      // process local webcam feed first
      if (localVideoRef.current && gestureRecognizer && canvasRef.current) {
        // check frame rate for local feed
        if (shouldProcessFrame(lastFrameTimeRef.current)) {
          lastFrameTimeRef.current = Date.now();

          // get canvas context for local feed
          const canvasElement = canvasRef.current;
          const canvasCtx = canvasElement.getContext('2d');

          if (canvasCtx) {
            // setup canvas and process frame
            const dimensions = { width: canvasWidth, height: canvasHeight };
            setupCanvas(canvasCtx, canvasElement, dimensions);

            // process local video frame and get results
            const results = processVideoFrame(
              canvasCtx,
              localVideoRef.current,
              gestureRecognizer,
              dimensions,
              {
                setLeftGestureData,
                setRightGestureData,
              }
            );

            if (results) {
              // send gesture data over webrtc with a timestamp
              sendRtcData({
                type: 'gesture',
                data: { gesture: results, timestamp: Date.now() },
              });

              if (results.landmarks && results.handedness) {
                // get overlay rect for coordinate conversion
                const rect =
                  overlayRef.current?.getBoundingClientRect() || new DOMRect();

                // this function sends events to the overlay
                const handleInteraction: InteractionEventHandler = (event) => {
                  // dispatch custom event that bubbles up through the overlay
                  if (overlayRef.current) {
                    const customEvent = new CustomEvent('interaction', {
                      bubbles: true,
                      composed: true,
                      detail: event,
                    });
                    // find the current visualization element
                    const visElement = overlayRef.current.firstElementChild;
                    if (visElement) {
                      visElement.dispatchEvent(customEvent);
                    }
                  }
                };

                // process "one" gesture for hovering
                handleSvgOne(
                  canvasCtx,
                  results,
                  rect,
                  dimensions,
                  handleInteraction
                );

                // process "grabbing" gesture for area hovering
                handleSvgGrabbing(
                  canvasCtx,
                  results,
                  rect,
                  dimensions,
                  handleInteraction
                );

                // process "thumb_index" gesture for selection
                handleSvgThumbIndex(
                  canvasCtx,
                  results,
                  rect,
                  dimensions,
                  handleInteraction
                );

                // process "ok" gesture for dragging elements
                handleSvgOk(
                  canvasCtx,
                  results,
                  rect,
                  dimensions,
                  handleInteraction
                );

                // process "fist" gesture for zooming and panning
                handleSvgFist(
                  canvasCtx,
                  results,
                  rect,
                  dimensions,
                  handleInteraction,
                  false, // drawOnly
                  getCurrentTransformRef.current || undefined // pass current transform function
                );

                // process "none" gesture for cleanup
                handleSvgNone(
                  canvasCtx,
                  results,
                  rect,
                  dimensions,
                  handleInteraction
                );
              }
            }
            canvasCtx.restore();
          }
        }
      }

      // continue the animation loop
      requestAnimationFrame(processWebcams);
    };

    // start the combined processing loop
    processWebcams();
  }, [gestureRecognizer, sendRtcData]);

  // effect to add remote gestures to buffer and manage its size
  useEffect(() => {
    if (remoteGestureData) {
      gestureBuffer.current.push(remoteGestureData);

      // enforce a max buffer size to prevent memory leaks if rendering stalls
      if (gestureBuffer.current.length > MAX_GESTURE_BUFFER_SIZE) {
        gestureBuffer.current.splice(
          0,
          gestureBuffer.current.length - MAX_GESTURE_BUFFER_SIZE
        );
      }
    }
  }, [remoteGestureData]);

  // effect to draw remote hands from webrtc data
  useEffect(() => {
    // if not connected, clear the buffer and canvas, then stop.
    if (!rtcConnected) {
      gestureBuffer.current = [];
      if (remoteCanvasRef.current) {
        const canvasCtx = remoteCanvasRef.current.getContext('2d');
        if (canvasCtx) {
          canvasCtx.clearRect(
            0,
            0,
            remoteCanvasRef.current.width,
            remoteCanvasRef.current.height
          );
        }
      }
      return;
    }

    let animationFrameId: number;

    const renderLoop = () => {
      if (!remoteCanvasRef.current || gestureBuffer.current.length === 0) {
        animationFrameId = requestAnimationFrame(renderLoop);
        return;
      }

      const canvasElement = remoteCanvasRef.current;
      const canvasCtx = canvasElement.getContext('2d');
      if (!canvasCtx) {
        animationFrameId = requestAnimationFrame(renderLoop);
        return;
      }

      // latency adjustment (e.g., 50ms) to sync with video stream
      const renderDelay = 50;
      const now = Date.now();

      // find the gesture data that is closest to the delayed time
      let dataToRender: RemoteGestureData | null = null;
      let bestMatchIndex = -1;

      for (let i = gestureBuffer.current.length - 1; i >= 0; i--) {
        const data = gestureBuffer.current[i];
        if (now - data.timestamp >= renderDelay) {
          dataToRender = data;
          bestMatchIndex = i;
          break;
        }
      }

      // clear buffer of old data that has been processed.
      if (bestMatchIndex > -1) {
        gestureBuffer.current.splice(0, bestMatchIndex + 1);
      }

      if (dataToRender) {
        lastRenderTime.current = now;

        // setup canvas and process frame
        const dimensions = { width: canvasWidth, height: canvasHeight };
        setupCanvas(canvasCtx, canvasElement, dimensions);

        // draw the landmarks
        drawHandLandmarks(canvasCtx, dataToRender.gesture, true);

        // get overlay rect for coordinate conversion
        const rect =
          overlayRef.current?.getBoundingClientRect() || new DOMRect();

        // process "one" gesture for hovering
        handleSvgOneRemote(canvasCtx, dataToRender.gesture, rect, dimensions);

        // process "grabbing" gesture for area hovering
        handleSvgGrabbingRemote(
          canvasCtx,
          dataToRender.gesture,
          rect,
          dimensions
        );

        // process "thumb_index" gesture for selection
        handleSvgThumbIndexRemote(
          canvasCtx,
          dataToRender.gesture,
          rect,
          dimensions
        );

        // process "ok" gesture for element dragging
        handleSvgOkRemote(canvasCtx, dataToRender.gesture, rect, dimensions);

        // process "fist" gesture for zooming and panning
        handleSvgFistRemote(canvasCtx, dataToRender.gesture, rect, dimensions);

        canvasCtx.restore();
      }

      animationFrameId = requestAnimationFrame(renderLoop);
    };

    animationFrameId = requestAnimationFrame(renderLoop);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [rtcConnected]);

  return (
    <div
      style={{
        position: 'absolute',
        width: canvasWidth,
        height: canvasHeight,
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      }}
    >
      {/* 
        z-index layering structure:
        - video feed layer: zIndex: 1 (bottom layer - background video)
        - remote hands canvas: zIndex: 3 (behind visualization)
        - visualization layer: zIndex: 4 (middle layer - the interactive content)
        - local hands canvas: zIndex: 5 (above visualization - so local hands appear on top)
      */}

      {!isVideoFeedStarted && <p>Loading video feed...</p>}

      {/* YjsProvider wraps the visualization for syncing */}
      <YjsProvider>
        {/* visualization layer */}
        <div
          ref={overlayRef}
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 4,
            width: '100%',
            height: '100%',
          }}
        >
          {/* conditionally render selected visualization */}
          {currentVisualization === 'senate' && (
            <Senate getCurrentTransformRef={getCurrentTransformRef} />
          )}
          {currentVisualization === 'traveltask' && (
            <TravelTask getCurrentTransformRef={getCurrentTransformRef} />
          )}
          {currentVisualization === 'movies' && (
            <Movies getCurrentTransformRef={getCurrentTransformRef} />
          )}
          {currentVisualization === 'domi' && (
            <DoMi getCurrentTransformRef={getCurrentTransformRef} />
          )}
          {currentVisualization === 'sankey' && (
            <Sankey getCurrentTransformRef={getCurrentTransformRef} />
          )}
          {currentVisualization === 'splom' && (
            <Splom getCurrentTransformRef={getCurrentTransformRef} />
          )}
          {currentVisualization === 'sysdes' && (
            <SysDes getCurrentTransformRef={getCurrentTransformRef} />
          )}
        </div>
      </YjsProvider>

      {/* canvas for local hand tracking visualization - above visualization */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          zIndex: 5,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      />

      {/* canvas for remote hand tracking visualization - behind visualization */}
      <canvas
        ref={remoteCanvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          zIndex: 3,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      />

      {/* local video element for gesture processing - always hidden */}
      <video
        ref={localVideoRef}
        id='local-webcam'
        style={{ display: 'none' }}
        playsInline
        muted
      />

      {/* video feed layer - at the bottom */}
      <div
        style={{
          position: 'absolute',
          width: '100%',
          height: '100%',
          zIndex: 1,
        }}
      >
        {/* local video element for display */}
        <video
          ref={localVideoRef}
          style={{
            display: 'block',
            position: 'absolute',
            width: '100%',
            height: '100%',
            objectFit: 'fill',
            visibility:
              !rtcConnectedRef.current || !remoteStream || showLocalFeed
                ? 'visible'
                : 'hidden',
            transform: 'scaleX(-1)', // mirror the feed
            filter: 'grayscale(100%)', // convert to grayscale
          }}
          playsInline
          muted
        />

        {/* remote video element for display */}
        <video
          ref={remoteVideoRef}
          id='remote-webcam'
          style={{
            display: 'block',
            position: 'absolute',
            width: '100%',
            height: '100%',
            objectFit: 'fill',
            visibility:
              rtcConnectedRef.current && remoteStream && !showLocalFeed
                ? 'visible'
                : 'hidden',
            transform: 'scaleX(-1)', // mirror the feed
            filter: 'grayscale(100%)', // convert to grayscale
          }}
          playsInline
          autoPlay
        />
      </div>

      {/* debug dashboard */}
      <DebugDashboard
        memoryUsage={memoryUsage}
        leftGestureData={leftGestureData}
        rightGestureData={rightGestureData}
        isConnected={isConnected}
        connectionError={connectionError}
        currentUser={currentUser}
        connectedUsers={connectedUsers}
        rtcConnected={rtcConnected}
        rtcConnectionState={rtcConnectionState}
        showDebug={showDebug}
        onToggleDebug={() => setShowDebug(!showDebug)}
        onCameraSelect={handleCameraSelect}
        showLocalFeed={showLocalFeed}
        onToggleFeed={() => setShowLocalFeed(!showLocalFeed)}
        currentPing={currentPing}
        pingHistory={pingHistory}
        selectedVisualization={currentVisualization}
        onVisualizationSelect={(vis) => setCurrentVisualization(vis)}
      />
    </div>
  );
};

export default Display;
