/**
 * The size of the box a scene is drawn in: the whole composition by default, or a judge-video pane
 * (PhoneInset, EvidencePane), so slates and screens scale to where they actually sit.
 */
import { createContext, useContext, type ReactNode } from 'react';
import { useVideoConfig } from 'remotion';

interface PaneSize {
  width: number;
  height: number;
}

const PaneContext = createContext<PaneSize | null>(null);

export function usePaneSize(): PaneSize {
  const config = useVideoConfig();
  return useContext(PaneContext) ?? { width: config.width, height: config.height };
}

export function Pane({
  x,
  y,
  width,
  height,
  children,
}: PaneSize & { x: number; y: number; children: ReactNode }) {
  return (
    <PaneContext.Provider value={{ width, height }}>
      <div style={{ position: 'absolute', left: x, top: y, width, height, overflow: 'hidden' }}>
        {children}
      </div>
    </PaneContext.Provider>
  );
}
