import React from 'react';

// A bar describes its content area with CSS custom properties on the
// element its pages render in:
//   --denim-content-padding          padding on all four sides (the sidebar)
//   --denim-content-padding-inline   left/right padding, when it differs
//   --denim-content-padding-block    top/bottom padding, when it differs
//   --denim-content-height           the content area's height, when the
//                                    page box has no definite height (the
//                                    top bar's page grows with its content)
const PAD_INLINE = 'var(--denim-content-padding-inline, var(--denim-content-padding, 0px))';
const PAD_BLOCK = 'var(--denim-content-padding-block, var(--denim-content-padding, 0px))';

/**
 * Cancels the bar's content padding, so its children fill the whole content
 * area (edge to edge, full height). For canvases, maps and MasterDetail.
 * Outside a bar it is a plain full-height box.
 */
export const FullBleed: React.FC<{ children?: React.ReactNode; style?: React.CSSProperties; className?: string }> = ({
  children,
  style,
  className,
}) => (
  <div
    className={className}
    style={{
      margin: `calc(-1 * ${PAD_BLOCK}) calc(-1 * ${PAD_INLINE})`,
      height: `var(--denim-content-height, calc(100% + 2 * ${PAD_BLOCK}))`,
      boxSizing: 'border-box',
      position: 'relative',
      ...style,
    }}
  >
    {children}
  </div>
);

export default FullBleed;
