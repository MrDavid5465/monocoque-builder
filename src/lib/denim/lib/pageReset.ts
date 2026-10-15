// The shell is meant to fill the page, but browsers give <body> an 8px
// margin by default, which leaves a gap around any chrome. Every app that
// used denim had to add its own reset; doing it here, once, makes it work out
// of the box. Plain CSS (no UI kit), inserted first in <head> so an app's own
// stylesheet still overrides it.
const RESET_ID = 'denim-page-reset';
const RESET_CSS = 'html, body, #root { margin: 0; padding: 0; width: 100%; min-height: 100%; }';

export function applyPageReset(): void {
  if (typeof document === 'undefined' || document.getElementById(RESET_ID)) return;
  const style = document.createElement('style');
  style.id = RESET_ID;
  style.textContent = RESET_CSS;
  document.head.insertBefore(style, document.head.firstChild);
}
