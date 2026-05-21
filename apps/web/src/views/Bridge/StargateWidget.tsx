import { Box, PancakeTheme } from '@pancakeswap/uikit'
import { useMemo } from 'react'
import { FEE_COLLECTOR, FEE_TENTH_BPS, PARTNER_ID } from './config'

const getWidgetTheme = (theme: PancakeTheme) => ({
  palette: {
    type: theme.isDark ? 'dark' : 'light',
    primary: {
      main: theme.colors.primary,
      contrastText: theme.colors.invertedContrast,
    },
    text: {
      primary: theme.colors.text,
      secondary: theme.colors.textSubtle,
      disabled: theme.colors.textDisabled,
    },
    divider: theme.colors.cardBorder,
    background: {
      paper: theme.colors.backgroundAlt,
      default: theme.colors.background,
    },
    action: {
      disabled: theme.colors.textDisabled,
      disabledBackground: theme.colors.disabled,
    },
  },
  typography: {
    fontFamily: "'Kanit', sans-serif",
  },
  shape: {
    borderRadius: 18,
  },
})

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
