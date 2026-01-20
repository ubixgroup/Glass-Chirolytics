import { useState, useEffect } from 'react';
import { MediaDeviceInfo } from '@/types/types';

export const useCameraDevices = () => {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [error, setError] = useState<string>('');

  // get list of available camera devices
  const getCameraDevices = async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ video: true }); // request permission
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(
        (device) => device.kind === 'videoinput'
      );
      setDevices(videoDevices);

      // select first device by default if none selected
      if (!selectedDevice && videoDevices.length > 0) {
        setSelectedDevice(videoDevices[0].deviceId);
      }
    } catch (err) {
      setError('failed to get camera devices');
      console.error('error getting camera devices:', err);
    }
  };

  // listen for device changes
  useEffect(() => {
    getCameraDevices();

    navigator.mediaDevices.addEventListener('devicechange', getCameraDevices);
    return () => {
      navigator.mediaDevices.removeEventListener(
        'devicechange',
        getCameraDevices
      );
    };
  }, []);

  return {
    devices,
    selectedDevice,
    setSelectedDevice,
    error,
  };
};
