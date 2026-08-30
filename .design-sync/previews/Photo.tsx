import * as React from 'react';
import { Photo } from 'denim';

// Image picker/cropper: a drop-target tile with a preview and the original
// alongside it, plus crop/download/remove actions.
//
// NOTE on the `image` prop — it is a **raw base64 payload, not a data URI**.
// The component prepends `data:image/png;base64,` itself, so passing a full
// data URI double-prefixes it and renders a broken image.
//
// The crop view and the empty drop tile aren't previewable: both are driven
// by internal state set during a real file drop/selection, not by props, so
// there are no cells for them.

const trackPhoto =
  'iVBORw0KGgoAAAANSUhEUgAAANwAAAClCAIAAAC4FQTfAAADG0lEQVR42u3a124QBBiG4e9qoAiIiIhIB20ppZSWUkoppZQWkL1kyJIlQ5YsQY0jrriiEBWiYBQJSkSNV+JNeOwZiQf+B8+f5wr+vIdfJjSOQSmZ0DgOpWRi0xooJROb10IpaWhZB6Vk0tz1UEomtW6AUvJE20YoJZPbN0EpmTxvM5SSKR1boZRMnb8NSsnUzu1QSp5csANKybSunVBKpi3cBaXkqe7dUEqmL9oDpWR6z14oJU/37oNSMmPxfiglM/oOQCl5ZslBKCUz+w9BKZm59DCUkmcHjkApmbXsKJSSWYPHoJQ8t/w4lJLZQyeglMxecRJKyfPDp6CUzFl5GkrJnJEzUEoaV52FUtI0eg5KSdPq81BKmscuQClpGb8IpaRlzSUoJXPXXoZS0rruCpSS1heuQilpW38NSkn7hutQSto3vgGlZN6mN6GUdGx+C0pJx5a3oZTM3/oOlJLObe9CKenc/h6UkgU73odS0rXzAyglXS9+CKVk4a6PoJR07/4YSkn3nk+glCza+ymUkp6XPoNS0rPvcyglvfu/gFLSe+BLKCWLD34FpaTv0A0oJX0v34RSsuTw11BK+o98A6Wk/+i3UEqWHrsFpWTg+G0oJQOvfAelZNmJ76GUDJ68A6Vk8NRdKCXLT/8ApWTo1R+hlAyd+QlKyYqz96CUDJ/7GUrJ8Pn7UEpWXngApWTktV+glIxc/BVKyapLD6GUjF7+DUrJ6JVHUEpWX/0dSsnY639AKRm79ieUkvHrf0EpudfQ8Jiam9vgv3jM0kSJKBGlKBEliLKAv/99HiJKUYoSUYpSlKIUpShFKUpRilKUohQlohSlKBGlKEUpSlGKUpSIUpSIElGKElGCKBEliBJRihJRIkpRIkoQpUGGKEUpSlGKUpSiFKUoRSlKUYpSlKIUpShFKUpRIkpRihJRilKUohQlokSUokSUIEpECaJElKJElIhSlIgSUYoSURpkIEpRihJRilKUohSlKEUpSlGKUpSiFCWiFKUoRSlKUYpSlKIUpSgRpSgRJaIUJaIEUSJKECWiFCX/U5T/AJEIPUwUSpx0AAAAAElFTkSuQmCC';

// Single cell by design: the visible tile is a fixed 196x236 inside
// PlaceHolder, and previewDimensions only sizes a hidden canvas — so there is
// no prop that produces a second, visibly different still.
export const WithImage = () => <Photo image={trackPhoto} />;
