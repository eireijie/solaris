import { useEffect, useRef } from "react";

/** Calls `cb` once when the element comes within `margin` of the viewport. */
export function useNearView<T extends HTMLElement>(cb: () => void, margin = "600px") {
  const ref = useRef<T>(null);
  const cbRef = useRef(cb);
  cbRef.current = cb;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      cbRef.current();
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          cbRef.current();
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [margin]);
  return ref;
}
