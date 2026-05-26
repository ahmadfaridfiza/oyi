import { createGlobalStyle } from 'styled-components'
import { PancakeTheme } from '@pancakeswap/uikit'

declare module 'styled-components' {
  /* eslint-disable @typescript-eslint/no-empty-interface */
  export interface DefaultTheme extends PancakeTheme {}
}

const GlobalStyle = createGlobalStyle`
  * {
    font-family: 'Kanit', sans-serif;
  }

  html {
    min-height: 100%;
  }

  body {
    background-color: ${({ theme }) => theme.colors.background};
    background-image: ${({ theme }) =>
      theme.isDark
        ? 'radial-gradient(ellipse 80% 60% at 50% -20%, rgba(0, 240, 255, 0.04) 0%, transparent 60%), radial-gradient(ellipse 60% 50% at 80% 100%, rgba(139, 92, 246, 0.04) 0%, transparent 60%), radial-gradient(ellipse 50% 40% at 0% 80%, rgba(255, 59, 127, 0.03) 0%, transparent 60%)'
        : 'radial-gradient(ellipse 80% 60% at 50% -20%, rgba(0, 240, 255, 0.05) 0%, transparent 60%), radial-gradient(ellipse 60% 50% at 80% 100%, rgba(124, 58, 237, 0.04) 0%, transparent 60%), radial-gradient(ellipse 50% 40% at 0% 80%, rgba(255, 59, 127, 0.03) 0%, transparent 60%)'};
    background-attachment: fixed;
    min-height: 100vh;
    transition: background-color 0.3s ease, background-image 0.3s ease;

    img {
      height: auto;
      max-width: 100%;
    }

    &::before {
      content: '';
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 0;
      background-image: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%239C92AC' fill-opacity='0.03'%3E%3Ccircle cx='1' cy='1' r='1'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
    }
  }

  #__next {
    position: relative;
    z-index: 1;
  }
`

export default GlobalStyle
