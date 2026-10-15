// import { IStyle } from '@uifabric/styling';
import { IStyle, ITheme, FontWeights } from "@fluentui/react";

export interface Style {
  content: IStyle;
  sm: IStyle;
  md: IStyle;
  lg: IStyle;
  xLg: IStyle;
  xxLg: IStyle;
  xxxLg: IStyle;
  hiddenSm: IStyle;
  hiddenMd: IStyle;
  hiddenMdDown: IStyle;
  hiddenMdUp: IStyle;
  hiddenLg: IStyle;
  hiddenLgDown: IStyle;
  hiddenLgUp: IStyle;
  hiddenXl: IStyle;
  hiddenXlDown: IStyle;
  hiddenXlUp: IStyle;
  hiddenXxl: IStyle;
  hiddenXxlDown: IStyle;
  hiddenXxlUp: IStyle;
  hiddenXxxl: IStyle;
  labelHorizontal: IStyle;
  fieldHorizontal: IStyle;
  appNavLink: IStyle;
  appNavLinkActive: IStyle;
  headerIconButton: IStyle;
  waffle: IStyle;
  headerLinkActive: IStyle;
  headerLink: IStyle;
  headerLinkContainer: IStyle;
  iconButtonStyle: IStyle;
  dangerButton: IStyle;
  errors: IStyle;
  error: IStyle;
  hint: IStyle;
  link: IStyle;
  dropdownLink: IStyle;
  modalHeader: IStyle;
  modalBody: IStyle;
  splashScreen: IStyle;
  appLogo: IStyle;
  appHeader: IStyle;
  navBar: IStyle;
  alert: IStyle;
  alertDismissed: IStyle;
}

const style = (theme: ITheme) =>
  ({
    content: {
      position: "relative",
      top: "3.85em",
      paddingRight: "1em",
      paddingLeft: "1em",
      width: "100%",
      marginRight: "auto",
      marginLeft: "auto",
      minHeight: "calc(100vh - 3.85em)"
    },
    sm: {
      width: "100%",
      selectors: {
        "@media (min-width: 36.883em)": {
          maxWidth: "36.883em"
        }
      }
    },
    md: {
      width: "100%",
      selectors: {
        "@media (min-width: 36.883em)": {
          maxWidth: "36.883em"
        },
        "@media (min-width: 49.203em)": {
          maxWidth: "49.203em"
        }
      }
    },
    lg: {
      width: "100%",
      selectors: {
        "@media (min-width: 36.883em)": {
          maxWidth: "36.883em"
        },
        "@media (min-width: 49.203em)": {
          maxWidth: "49.203em"
        },
        "@media (min-width: 78.771em)": {
          maxWidth: "78.771em"
        }
      }
    },
    xLg: {
      width: "100%",
      selectors: {
        "@media (min-width: 36.883em)": {
          maxWidth: "36.883em"
        },
        "@media (min-width: 49.203em)": {
          maxWidth: "49.203em"
        },
        "@media (min-width: 78.771em)": {
          maxWidth: "78.771em"
        },
        "@media (min-width: 105.105em)": {
          maxWidth: "105.105em"
        }
      }
    },
    xxLg: {
      width: "100%",
      selectors: {
        "@media (min-width: 36.883em)": {
          maxWidth: "36.883em"
        },
        "@media (min-width: 49.203em)": {
          maxWidth: "49.203em"
        },
        "@media (min-width: 78.771em)": {
          maxWidth: "78.771em"
        },
        "@media (min-width: 105.105em)": {
          maxWidth: "105.105em"
        }
      }
    },
    xxxLg: {
      width: "100%"
    },
    hiddenSm: {
      selectors: {
        "@media (max-width: 36.883em)": {
          display: "none"
        }
      }
    },
    hiddenMd: {
      selectors: {
        "@media (min-width: 36.96em) and (max-width: 49.203em)": {
          display: "none"
        }
      }
    },
    hiddenMdDown: {
      selectors: {
        "@media (max-width: 49.28em)": {
          display: "none"
        }
      }
    },
    hiddenMdUp: {
      selectors: {
        "@media (min-width: 36.883em)": {
          display: "none"
        }
      }
    },
    hiddenLg: {
      selectors: {
        "@media (min-width: 49.28em) and (max-width: 78.771em)": {
          display: "none"
        }
      }
    },
    hiddenLgDown: {
      selectors: {
        "@media (max-width: 78.848em)": {
          display: "none"
        }
      }
    },
    hiddenLgUp: {
      selectors: {
        "@media (min-width: 49.203em)": {
          display: "none"
        }
      }
    },
    hiddenXl: {
      selectors: {
        "@media (min-width: 78.848em) and (max-width: 105.105em)": {
          display: "none"
        }
      }
    },
    hiddenXlDown: {
      selectors: {
        "@media (max-width: 105.182em)": {
          display: "none"
        }
      }
    },
    hiddenXlUp: {
      selectors: {
        "@media (min-width: 78.771em)": {
          display: "none"
        }
      }
    },
    hiddenXxl: {
      selectors: {
        "@media (min-width: 105.182em) and (max-width: 147.763em)": {
          display: "none"
        }
      }
    },
    hiddenXxlDown: {
      selectors: {
        "@media (max-width: 147.84em)": {
          display: "none"
        }
      }
    },
    hiddenXxlUp: {
      selectors: {
        "@media (min-width: 105.105em)": {
          display: "none"
        }
      }
    },
    hiddenXxxl: {
      selectors: {
        "@media (min-width: 147.763em)": {
          display: "none"
        }
      }
    },
    labelHorizontal: {
      paddingRight: "0.77em"
    },
    fieldHorizontal: {
      minWidth: "23.1em"
    },
    appNavLink: {
      position: "fixed",
      left: 0,
      paddingLeft: "2.156em",
      width: "208.016",
      textAlign: "left",
      overflow: "hidden",
      color: theme.semanticColors.actionLink,
      textDecoration: "none",
      selectors: {
        ":hover": {
          color: theme.semanticColors.link
        }
      }
    },
    appNavLinkActive: {
      background: theme.palette.neutralLight,
      borderLeft: `0.231em solid ${theme.palette.themePrimary}`,
      selectors: {
        ":hover": {
          background: theme.palette.neutralLighter
        }
      }
    },
    headerIconButton: {
      color: theme.palette.themeLighter,
      backgroundColor: theme.semanticColors.primaryButtonBackground,
      height: "3.85em",
      width: "3.85em",
      padding: 0,
      borderRight: `solid ${theme.palette.themeTertiary} 0.077em`,
      borderRadius: 0,
      selectors: {
        ":hover": {
          color: theme.semanticColors.primaryButtonTextHovered,
          backgroundColor: theme.semanticColors.primaryButtonBackgroundHovered
        },
        ":active": {
          color: theme.semanticColors.primaryButtonTextPressed,
          backgroundColor: theme.semanticColors.primaryButtonBackgroundPressed
        }
      }
    },
    waffle: {
      fontSize: "2em"
    },
    dangerButton: {
      background: theme.isInverted ? theme.palette.redDark : theme.palette.red,
      color: theme.isInverted
        ? theme.semanticColors.buttonText
        : theme.semanticColors.primaryButtonText,
      selectors: {
        ":hover": {
          background: theme.isInverted
            ? theme.palette.redDark
            : theme.palette.red,
          color: theme.isInverted
            ? theme.semanticColors.buttonTextHovered
            : theme.semanticColors.primaryButtonBackgroundHovered
        }
      }
    },
    link: {
      color: theme.semanticColors.link,
      textDecoration: "none",
      selectors: {
        ":hover": {
          color: theme.semanticColors.linkHovered,
          textDecoration: "underline"
        }
      }
    },
    dropdownLink: {
      color: theme.semanticColors.buttonText,
      textDecoration: "none",
      selectors: {
        ":hover": {
          color: theme.semanticColors.buttonTextHovered
        }
      }
    },
    headerLinkActive: {
      borderTop: `0.308em solid ${theme.palette.themePrimary}`,
      borderBottom: `0.308em solid ${theme.palette.themeTertiary}`
    },
    headerLink: {
      color: theme.palette.themeLighter,
      fontSize: "1.3em",
      textDecoration: "none"
    },
    headerLinkContainer: {
      display: "inline-block",
      height: "3.85em",
      padding: ".77em",
      borderTop: `0.308em solid ${theme.palette.themePrimary}`,
      borderBottom: `0.308em solid ${theme.palette.themePrimary}`,
      selectors: {
        ":hover": {
          backgroundColor: theme.semanticColors.primaryButtonBackgroundHovered
        }
      }
    },
    iconButtonStyle: {
      color: theme.semanticColors.primaryButtonText,
      backgroundColor: theme.semanticColors.primaryButtonBackground,
      height: "3.85em",
      width: "3.85em",
      padding: 0,
      selectors: {
        ":hover": {
          color: theme.semanticColors.primaryButtonTextHovered,
          backgroundColor: theme.semanticColors.primaryButtonBackgroundHovered
        },
        ":active": {
          color: theme.semanticColors.primaryButtonTextHovered,
          backgroundColor: theme.semanticColors.primaryButtonBackgroundPressed
        }
      }
    },
    errors: {
      minHeight: "1.32em",
      fontSize: "0.8em",
      marginBottom: "0.5em"
    },
    error: { color: theme.semanticColors.errorText },
    hint: { color: theme.palette.themePrimary },
    modalHeader: {
      borderTop: `0.25em solid ${theme.palette.themePrimary}`,
      color: theme.palette.neutralPrimary,
      display: "flex",
      fontSize: "1.5em",
      alignItems: "center",
      fontWeight: parseInt(FontWeights.semibold.toString()),
      padding: "0.924em 0.924em 1.078em 1.848em"
    },
    modalBody: { padding: "0 1.848em 1.848em 1.848em" },
    splashScreen: {
      textAlign: "center",
      backgroundColor: theme.palette.themePrimary,
      color: theme.palette.white
    },
    appLogo: {
      height: "20vh",
      paddingTop: "40vh",
      fill: theme.palette.white
    },
    appHeader: {
      minHeight: "100vh",
      backgroundColor: theme.palette.themePrimary,
      alignItems: "center",
      justifyContent: "center",
      color: theme.palette.themeDarker,
      margin: 0
    },
    navBar: {
      position: "fixed",

      right: 0,
      top: 0
    },
    alert: {
      borderTop: `0.25em solid ${theme.palette.themePrimary}`,
      background: theme.palette.white,
      padding: "2em",
      position: "fixed",
      right: "1em",
      top: "-100%",
      transition: "ease-in-out top 500ms",
      boxShadow:
        "rgba(0, 0, 0, 0.133) 0em .22em .3em 0em, rgba(0, 0, 0, 0.11) 0em .05em .10em 0em",
      zIndex: 900
    },
    alertDismissed: {
      top: "5em"
    }
  } as Style);

export default style;
