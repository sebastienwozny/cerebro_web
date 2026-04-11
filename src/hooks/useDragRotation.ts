import { useCallback, useRef, useState } from "react";

const MAX_ROTATION = 2;

export function useDragRotation(onRotationChange?: (rotation: number) => void) {
  const [dragRotation, setDragRotation] = useState(0);
  const springRef = useRef({ current: 0, velocity: 0, target: 0, stiffness: 1750, damping: 50 });
  const springRafRef = useRef<number>(0);
  const onChangeRef = useRef(onRotationChange);
  onChangeRef.current = onRotationChange;

  const startSpring = useCallback(() => {
    if (springRafRef.current) return;
    const tick = () => {
      const s = springRef.current;
      const dt = 1 / 60;
      const force = s.stiffness * (s.target - s.current) - s.damping * s.velocity;
      s.velocity += force * dt;
      s.current += s.velocity * dt;
      setDragRotation(s.current);
      onChangeRef.current?.(s.current);
      if (Math.abs(s.current - s.target) > 0.001 || Math.abs(s.velocity) > 0.01) {
        springRafRef.current = requestAnimationFrame(tick);
      } else {
        s.current = s.target;
        setDragRotation(s.target);
        onChangeRef.current?.(s.target);
        springRafRef.current = 0;
      }
    };
    springRafRef.current = requestAnimationFrame(tick);
  }, []);

  const applyDragVelocity = useCallback(
    (vxPerSec: number) => {
      const target = Math.max(-MAX_ROTATION, Math.min(MAX_ROTATION, (vxPerSec / 800) * MAX_ROTATION));
      springRef.current.stiffness = 200;
      springRef.current.damping = 12;
      springRef.current.target = target;
      startSpring();
    },
    [startSpring]
  );

  const releaseSpring = useCallback(() => {
    springRef.current.stiffness = 80;
    springRef.current.damping = 6;
    springRef.current.target = 0;
    startSpring();
  }, [startSpring]);

  return { dragRotation, applyDragVelocity, releaseSpring };
}
