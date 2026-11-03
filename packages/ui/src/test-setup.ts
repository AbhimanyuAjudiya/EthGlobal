import { afterEach } from 'vitest';

// Component tests opt into jsdom with a `@vitest-environment jsdom` docblock; token tests stay in node.
if (typeof document !== 'undefined') {
  const { cleanup } = await import('@testing-library/react');
  afterEach(cleanup);
  // jsdom has no 2D canvas; components must fall back to the CSS latex panel when getContext is null.
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
}
