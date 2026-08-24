import React from 'react';
import { Stack, getTheme } from '@fluentui/react';

interface ThumbnailCardProps {
  width?: number;
  thumbnailHeight?: number;
  // Rendered before the truncated title text, e.g. a colored type badge.
  titlePrefix?: React.ReactNode;
  title: string;
  // Header-right content, typically a row of IconButtons.
  actions?: React.ReactNode;
  // Convenience: renders a background image, fit per `fit` below. Ignored if children is set.
  thumbnailUrl?: string;
  // 'cover' (default, unchanged for every existing caller) crops to fill the
  // box — fine for a generic photo where nothing near the edges matters.
  // 'contain' never crops, letterboxing instead — use this where the
  // thumbnail can have precisely-positioned content near its own edges that
  // must never be cut off (e.g. DashboardsAdmin's dashboard thumbnails,
  // where cover was cropping out a top-left clock and a bottom-right button
  // whenever a dashboard's own aspect ratio didn't match this card's fixed
  // width/thumbnailHeight box — confirmed live, not hypothetical).
  fit?: 'cover' | 'contain';
  // Background shown behind children / the placeholder, when thumbnailUrl isn't set.
  emptyBackground?: string;
  // Centered content shown when there's neither a thumbnailUrl nor children.
  placeholder?: React.ReactNode;
  onThumbnailClick?: () => void;
  // Custom thumbnail content (e.g. a live canvas preview) — takes priority over thumbnailUrl.
  children?: React.ReactNode;
}

// Shared card shell for the "box, header row with title + actions, thumbnail
// area below" pattern repeated across dashboard/car/template cards.
// Consolidating it means a fix or restyle here reaches every card that uses
// it, instead of drifting out of sync between copies.
const ThumbnailCard: React.FC<ThumbnailCardProps> = ({
  width = 280,
  thumbnailHeight = 175,
  titlePrefix,
  title,
  actions,
  thumbnailUrl,
  emptyBackground,
  placeholder,
  onThumbnailClick,
  children,
  fit = 'cover',
}) => {
  const theme = getTheme();
  const hasContent = !!children || !!thumbnailUrl;

  return (
    <Stack
      style={{
        width,
        overflow: 'hidden',
        // Same accent-line + shadow signature as FormCard, its sibling in
        // this folder — square corners to match, not rounded.
        borderTop: `0.25em solid ${theme.palette.themePrimary}`,
        boxShadow:
          'rgba(0, 0, 0, 0.133) 0em 0.22em 0.3em 0em, rgba(0, 0, 0, 0.11) 0em 0.05em 0.10em 0em',
      }}
    >
      <Stack
        horizontal
        horizontalAlign="space-between"
        verticalAlign="center"
        style={{ padding: '0.5em 0.75em' }}
      >
        <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 7 }} style={{ minWidth: 0, flex: 1 }}>
          {titlePrefix}
          <span
            style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title={title}
          >
            {title}
          </span>
        </Stack>
        {actions && (
          <Stack horizontal tokens={{ childrenGap: 4 }} verticalAlign="center">
            {actions}
          </Stack>
        )}
      </Stack>

      <div
        onClick={onThumbnailClick}
        style={{
          width: '100%',
          height: thumbnailHeight,
          position: 'relative',
          overflow: 'hidden',
          background: thumbnailUrl
            ? `url(${thumbnailUrl}) center/${fit}${fit === 'contain' ? ' no-repeat' : ''}`
            : (emptyBackground ?? theme.palette.neutralLighter),
          cursor: onThumbnailClick ? 'pointer' : undefined,
          display: hasContent ? undefined : 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {children}
        {!hasContent && placeholder && (
          <span style={{ opacity: 0.5, fontSize: '0.85em' }}>{placeholder}</span>
        )}
      </div>
    </Stack>
  );
};

export default ThumbnailCard;
