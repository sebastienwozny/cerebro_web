import { useEffect, useState } from "react";

export interface WindowSize {
  w: number;
  h: number;
}

export function useWindowSize(): WindowSize {
  const [size, setSize] = useState<WindowSize>({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}
