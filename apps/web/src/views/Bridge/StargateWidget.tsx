import { Box, PancakeTheme } from '@pancakeswap/uikit'
import { darkColors, lightColors } from '@pancakeswap/ui/tokens/colors'
import { useMemo } from 'react'
import { FEE_COLLECTOR, FEE_TENTH_BPS, PARTNER_ID } from './config'

const getWidgetTheme = (theme: PancakeTheme) => {
  const colors = theme.isDark ? darkColors : lightColors

  return {
    palette: {
      type: theme.isDark ? 'dark' : 'light',
      primary: {
        main: colors.primary,
        contrastText: colors.invertedContrast,
      },
      info: {
        main: colors.primary,
        light: colors.invertedContrast,
      },
      success: {
        main: colors.success,
      },
      error: {
        main: colors.failure,
      },
      warning: {
        main: colors.warning,
      },
      text: {
        primary: colors.text,
        secondary: colors.textSubtle,
        disabled: colors.textDisabled,
      },
      divider: colors.cardBorder,
      background: {
        paper: colors.backgroundAlt,
        default: colors.background,
      },
      action: {
        disabled: colors.textDisabled,
        disabledBackground: colors.disabled,
      },
    },
    typography: {
      fontFamily: "'Kanit', sans-serif",
    },
    shape: {
      borderRadius: 18,
    },
  }
}

const StargateWidget = ({ theme }: { theme: PancakeTheme }) => {
  const widgetTheme = useMemo(() => JSON.stringify(getWidgetTheme(theme)), [theme])

  return (
    <Box width="100%">
      <style jsx global>{`
        .MuiScopedCssBaseline-root {
          background-color: transparent !important;
        }
        .StgHeader {
          border-bottom: 1px solid ${theme.colors.cardBorder} !important;
        }
        .StgHeader .MuiTypography-subtitle1 {
          visibility: hidden;
        }
        .StgHeader .MuiTypography-subtitle1::after {
          font-family: 'Kanit', sans-serif;
          visibility: visible;
          position: absolute;
          content: 'Bridge Token';
        }
        .MuiScopedCssBaseline-root .StgMaxButton {
          border-color: ${theme.colors.primary} !important;
          background-color: transparent;
        }
        .MuiFormLabel-root.Mui-focused {
          color: ${theme.colors.text} !important;
        }
      `}</style>
      {/* @ts-ignore */}
      <stargate-widget partnerId={PARTNER_ID} feeCollector={FEE_COLLECTOR} theme={widgetTheme} tenthBps={FEE_TENTH_BPS} />
    </Box>
  )
}

export default StargateWidget
