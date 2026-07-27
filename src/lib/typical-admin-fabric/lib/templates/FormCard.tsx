import React from 'react';
import { Stack, getTheme } from '@fluentui/react';

interface Props {
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

// Ported from the original davidallanscott.ca app's ServerCard (in
// manageLocations/Show) — that component's own domain-specific content
// doesn't apply here, but the generic "card" look it wrapped things in (a
// themed accent line across the top + a soft two-layer shadow, no
// background/border of its own) is reusable wherever something needs a
// card shell, so it's split out as its own atom here rather than redefined
// per call site — same rationale, and same plain-inline-styles convention,
// as ThumbnailCard, its sibling in this folder.
const FormCard: React.FC<Props> = ({ children, style }) => {
  const theme = getTheme();
  return (
    <Stack
      style={{
        borderTop: `0.25em solid ${theme.palette.themePrimary}`,
        padding: '0.77em',
        boxShadow:
          'rgba(0, 0, 0, 0.133) 0em 0.22em 0.3em 0em, rgba(0, 0, 0, 0.11) 0em 0.05em 0.10em 0em',
        ...style,
      }}
    >
      {children}
    </Stack>
  );
};

export default FormCard;
