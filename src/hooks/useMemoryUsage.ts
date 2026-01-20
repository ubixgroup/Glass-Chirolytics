import { useState, useEffect } from 'react';
import { MemoryUsage } from '@/types/types';

// custom hook for tracking memory usage
export const useMemoryUsage = () => {
  // memory usage state
  const [memoryUsage, setMemoryUsage] = useState<MemoryUsage>({
    usedJSHeapSize: 0,
    totalJSHeapSize: 0,
  });

  // update memory usage
  useEffect(() => {
    const updateMemoryUsage = () => {
      if ('memory' in performance) {
        const memory = performance as unknown as {
          memory: {
            usedJSHeapSize: number;
            totalJSHeapSize: number;
          };
        };
        setMemoryUsage({
          usedJSHeapSize: memory.memory.usedJSHeapSize,
          totalJSHeapSize: memory.memory.totalJSHeapSize,
        });
      }
    };

    const interval = setInterval(updateMemoryUsage, 1000);
    updateMemoryUsage(); // initial update

    return () => clearInterval(interval);
  }, []);

  return memoryUsage;
};
