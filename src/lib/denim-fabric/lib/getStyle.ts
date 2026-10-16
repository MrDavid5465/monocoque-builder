// getStyle()'s style builder: the shared shell styles (splash, modal, links)
// plus typical-admin-fabric's form styles plus whatever the app's bar
// registers, under the names getStyle() has always returned (getStyle().error,
// getStyle().modalHeader, and with the top bar getStyle().navBar, ...).
//
// Each piece lives where it is used:
//   - shared shell styles: here;
//   - form styles (error, errors, hint, labelHorizontal, fieldHorizontal,
//     dangerButton): typical-admin-fabric/lib/formStyles.ts;
//   - a bar's styles: in its package, registered with registerBarStyles()
//     when the bar is imported. Its members are added to the BarStyle
//     interface (declaration merging), so they are typed only in an app that
//     has that bar.
import { FontWeights } from '@fluentui/react';
import type { IStyle, ITheme } from '@fluentui/react';
import { formStyles } from '../../typical-admin-fabric/lib/formStyles';
import type { FormStyles } from '../../typical-admin-fabric/lib/formStyles';

/** Styles any shell uses: the splash, a modal's header and body, links, a notice. */
export interface SharedStyle {
  splashScreen: IStyle;
  appLogo: IStyle;
  appHeader: IStyle;
  modalHeader: IStyle;
  modalBody: IStyle;
  link: IStyle;
  dropdownLink: IStyle;
  alert: IStyle;
  alertDismissed: IStyle;
}

/**
 * Members a bar package adds (e.g. the top bar's `navBar`). Empty here; a
 * bar declares its own with `declare module '../denim-fabric/lib/getStyle'`.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface BarStyle {}

export interface Style extends SharedStyle, FormStyles, BarStyle {}

/** Builds a set of named styles (an object of IStyle members) for a theme. */
type StyleBuilder = (theme: ITheme) => object;
const barStyles: StyleBuilder[] = [];

/** Adds a bar's styles to getStyle(). Called once by the bar's style module. */
export function registerBarStyles(build: StyleBuilder) {
  if (!barStyles.includes(build)) barStyles.push(build);
}

export const sharedStyles = (theme: ITheme): SharedStyle => ({
  link: {
    color: theme.semanticColors.link,
    textDecoration: 'none',
    selectors: {
      ':hover': {
        color: theme.semanticColors.linkHovered,
        textDecoration: 'underline',
      },
    },
  },
  dropdownLink: {
    color: theme.semanticColors.buttonText,
    textDecoration: 'none',
    selectors: {
      ':hover': {
        color: theme.semanticColors.buttonTextHovered,
      },
    },
  },
  modalHeader: {
    borderTop: `0.25em solid ${theme.palette.themePrimary}`,
    color: theme.palette.neutralPrimary,
    display: 'flex',
    fontSize: '1.5em',
    alignItems: 'center',
    fontWeight: FontWeights.semibold,
    padding: '0.924em 0.924em 1.078em 1.848em',
  },
  modalBody: { padding: '0 1.848em 1.848em 1.848em' },
  splashScreen: {
    textAlign: 'center',
    backgroundColor: theme.palette.themePrimary,
    color: theme.palette.white,
  },
  appLogo: {
    height: '20vh',
    paddingTop: '40vh',
    fill: theme.palette.white,
  },
  appHeader: {
    minHeight: '100vh',
    backgroundColor: theme.palette.themePrimary,
    alignItems: 'center',
    justifyContent: 'center',
    color: theme.palette.themeDarker,
    margin: 0,
  },
  alert: {
    borderTop: `0.25em solid ${theme.palette.themePrimary}`,
    background: theme.palette.white,
    padding: '2em',
    position: 'fixed',
    right: '1em',
    top: '-100%',
    transition: 'ease-in-out top 500ms',
    boxShadow: 'rgba(0, 0, 0, 0.133) 0em .22em .3em 0em, rgba(0, 0, 0, 0.11) 0em .05em .10em 0em',
    zIndex: 900,
  },
  alertDismissed: {
    top: '5em',
  },
});

/** Every getStyle() member for `theme`: shared, form and the registered bar's. */
const style = (theme: ITheme): Style =>
  Object.assign({}, sharedStyles(theme), formStyles(theme), ...barStyles.map(build => build(theme))) as Style;

export default style;
