import React from 'react';
import { Link } from 'react-router-dom';
import { Stack } from '@fluentui/react';
import { getStyle } from '../lib';

interface Props {
  to: string;
  children: React.ReactNode;
  className?: string;
  active?: boolean;
}

/** A link in the top bar, underlined in the theme colour when active. */
export const HeaderLink: React.FC<Props> = ({ to, children, className = '', active }) => {
  const style = getStyle();
  return (
    <Link to={to} aria-current={active ? 'page' : undefined}>
      <Stack
        verticalAlign={'center'}
        className={`${style.headerLinkContainer} ${active ? style.headerLinkActive : ''}`}
      >
        <span className={`${style.headerLink} ${className}`}>{children}</span>
      </Stack>
    </Link>
  );
};

export default HeaderLink;
