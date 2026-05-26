import { vars } from "@pancakeswap/ui/css/vars.css";
import { darkColors, lightColors } from "../../theme/colors";
import { CardTheme } from "./types";

export const light: CardTheme = {
  background: lightColors.backgroundAlt,
  boxShadow: vars.shadows.level1,
  boxShadowActive: vars.shadows.active,
  boxShadowSuccess: vars.shadows.success,
  boxShadowWarning: vars.shadows.warning,
  cardHeaderBackground: {
    default: lightColors.gradientCardHeader,
    blue: lightColors.gradientBlue,
    bubblegum: lightColors.gradientBubblegum,
    violet: lightColors.gradientViolet,
  },
  dropShadow: "drop-shadow(0px 4px 12px rgba(26, 26, 46, 0.08))",
};

export const dark: CardTheme = {
  background: darkColors.backgroundAlt,
  boxShadow: "0px 4px 32px rgba(0, 0, 0, 0.25), inset 0px 1px 0px rgba(255, 255, 255, 0.05)",
  boxShadowActive: vars.shadows.active,
  boxShadowSuccess: vars.shadows.success,
  boxShadowWarning: vars.shadows.warning,
  cardHeaderBackground: {
    default: darkColors.gradientCardHeader,
    blue: darkColors.gradientBlue,
    bubblegum: darkColors.gradientBubblegum,
    violet: darkColors.gradientViolet,
  },
  dropShadow: "drop-shadow(0px 8px 32px rgba(0, 0, 0, 0.3))",
};
