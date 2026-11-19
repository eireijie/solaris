import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "../../lib/hooks";

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Tween between successive values of `target` using `lerp(from, to, t)`.
 * Returns the current interpolated value (re-renders each animation frame while
 * tweening). Respects prefers-reduced-motion.
 */
export function useTween<T>(target: T, lerp: (from: T, to: T, t: number) => T, duration = 600): T {
  const reduced = usePrefersReducedMotion();
  const [value, setValue] = useState(target);
  const current = useRef(target);
  const raf = useRef(0);

  useEffect(() => {
    if (reduced || duration <= 0) {
      current.current = target;
      setValue(target);
      return;
    }
    const from = current.current;
    const start = performance.now();
    cancelAnimationFrame(raf.current);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const v = t >= 1 ? target : lerp(from, target, easeOutCubic(t));
      current.current = v;
      setValue(v);
      if (t < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, reduced, duration]);

  return value;
}

export const lerpNum = (a: number, b: number, t: number) => a + (b - a) * t;
