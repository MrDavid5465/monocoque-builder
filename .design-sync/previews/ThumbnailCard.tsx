import * as React from 'react';
import { ThumbnailCard } from 'denim';

// Card with a title row and an image body. `fit` is the variant axis that
// most changes appearance: 'cover' crops to fill, 'contain' letterboxes and
// never crops (used where content near the thumbnail's edges must survive).

// Inline SVG data URIs keep the previews self-contained — no network fetch in
// the headless render.
const track =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200">
       <rect width="320" height="200" fill="#1b3a5c"/>
       <path d="M40 150 C 90 40, 230 40, 280 150" stroke="#f2c14e" stroke-width="10" fill="none"/>
       <circle cx="40" cy="150" r="9" fill="#e8503a"/>
     </svg>`,
  );

export const WithThumbnail = () => (
  <ThumbnailCard title="Silverstone — Grand Prix" thumbnailUrl={track} width={260} />
);

// The fit axis is only legible when the image's aspect ratio fights the box,
// so these two share one deliberately wide image: cover crops it, contain
// letterboxes it.
export const FitCover = () => (
  <ThumbnailCard title="Cover — crops to fill" thumbnailUrl={wide} fit="cover" width={260} />
);

export const FitContain = () => (
  <ThumbnailCard title="Contain — never crops" thumbnailUrl={wide} fit="contain" width={260} />
);

const wide =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="120">
       <rect width="640" height="120" fill="#123"/>
       <rect y="80" width="640" height="40" fill="#3e3e42"/>
       <circle cx="70" cy="60" r="34" fill="#f2c14e"/>
       <circle cx="570" cy="60" r="34" fill="#e8503a"/>
     </svg>`,
  );

export const WithActionsAndPrefix = () => (
  <ThumbnailCard
    title="Porsche 963"
    titlePrefix={
      <span
        style={{
          background: '#0078d4',
          color: '#fff',
          borderRadius: 3,
          padding: '1px 6px',
          fontSize: 11,
          marginRight: 6,
        }}
      >
        LMDh
      </span>
    }
    actions={<span style={{ opacity: 0.6, fontSize: 12 }}>412 laps</span>}
    thumbnailUrl={track}
    width={260}
  />
);

export const TextOnly = () => (
  <ThumbnailCard title="No thumbnail available" width={260}>
    <div style={{ padding: 16, opacity: 0.65, fontSize: 13 }}>
      Children replace the image body entirely.
    </div>
  </ThumbnailCard>
);
