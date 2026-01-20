import { useState, useEffect } from 'react';
import { GestureRecognizer, FilesetResolver } from '@mediapipe/tasks-vision';

// paths to required assets for mediapipe gesture recognition
const MODEL_ASSET_PATH = './src/assets/models/gc.task';
const WASM_PATH = 'node_modules/@mediapipe/tasks-vision/wasm';

// custom hook for initializing and managing the mediapipe gesture recognizer
// returns the gesture recognizer instance once it's ready
export const useGestureRecognizer = () => {
  // state to hold the gesture recognizer instance
  const [gestureRecognizer, setGestureRecognizer] =
    useState<GestureRecognizer | null>(null);

  // initialize the gesture recognizer on component mount
  useEffect(() => {
    const loadGestureRecognizer = async () => {
      try {
        // load mediapipe vision tasks assets from local node_modules
        const vision = await FilesetResolver.forVisionTasks(WASM_PATH);

        // create and configure the gesture recognizer
        const recognizer = await GestureRecognizer.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_ASSET_PATH,
            delegate: 'GPU', // use gpu acceleration when available
          },
          runningMode: 'VIDEO', // configure for video stream processing
          numHands: 2, // track up to two hands simultaneously
        });

        // store the initialized recognizer in state
        setGestureRecognizer(recognizer);
        console.log('gesture recognizer loaded successfully!');
      } catch (error) {
        console.error('error loading gesture recognizer:', error);
      }
    };

    loadGestureRecognizer();
  }, []);

  return gestureRecognizer;
};
