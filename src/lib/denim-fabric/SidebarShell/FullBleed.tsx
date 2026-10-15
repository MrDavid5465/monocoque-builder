import React from 'react';

/**
 * Cancels the shell's content padding, so its children fill the whole
 * content area (edge to edge, full height). For canvases, maps and
 * MasterDetail. Outside a shell that sets --denim-content-padding it is a
 * plain full-height box.
 */
export const FullBleed: React.FC<{ children?: React.ReactNode; style?: React.CSSProperties; className?: string }> = ({
  children,
  style,
  className,
}) => (
  <div
    className={className}
    style={{
      margin: 'calc(-1 * var(--denim-content-padding, 0px))',
      height: 'calc(100% + 2 * var(--denim-content-padding, 0px))',
      boxSizing: 'border-box',
      position: 'relative',
      ...style,
    }}
  >
    {children}
  </div>
);

export default FullBleed;
