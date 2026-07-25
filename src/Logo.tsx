import React, { CSSProperties } from "react";

interface IconProps {
  style?: CSSProperties;
  className?: string;
  onClick?: React.MouseEventHandler<SVGSVGElement>;
}

const Logo: React.FC<IconProps> = props => {
  return (
    <svg
      style={props.style}
      className={props.className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 80 80"
      onClick={props.onClick}
    >
      {/* Gauge bezel ring: clockwise outer arc from 7 o'clock to 5 o'clock,
          then counterclockwise inner arc back — forms the horseshoe */}
      <path d="M 24 73 A 32 32 0 1 1 56 73 L 50 62 A 20 20 0 1 0 30 62 Z" />
      {/* Needle pointing at ~10 o'clock (about 60% of scale) */}
      <path d="M 42 44 L 41 48 L 38 46 L 32 22 Z" />
      {/* Center pivot */}
      <circle cx="40" cy="45" r="3" />
    </svg>
  );
};

export default Logo;
