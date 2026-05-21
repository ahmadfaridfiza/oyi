import Script from 'next/script'
import { useEffect, useState } from 'react'
import styled, { useTheme } from 'styled-components'
import { Box, Flex, Text } from '@pancakeswap/uikit'
import { STARGATE_JS } from './config'
import StargateWidget from './StargateWidget'

const Page = styled.div`
  display: flex;
  justify-content: center;
  min-height: calc(100vh - 56px);
  align-items: center;
  flex-direction: column;
  background: ${({ theme }) => theme.colors.gradientBubblegum};
  padding: 24px 0;

  ${({ theme }) => theme.mediaQueries.sm} {
    display: grid;
    place-content: center;
  }
`

declare global {
  interface Window {
    stargate?: any
  }
}

const PoweredBy = () => {
  const { isDark } = useTheme()
  return (
    <Flex py="10px" alignItems="center" justifyContent="center">
      <Text small color="textSubtle" mr="8px">
        Powered By
      </Text>
      <a href="https://stargate.finance" target="_blank" rel="noreferrer noopener">
        <img
          width={78}
          height={20}
          src="/stargate.png"
          alt="Powered By Stargate"
          style={{
            filter: isDark ? 'invert(1)' : 'unset',
          }}
        />
      </a>
    </Flex>
  )
}

const Bridge = () => {
  const theme = useTheme()
  const [show, setShow] = useState(false)

  useEffect(() => {
    customElements.whenDefined('stargate-widget').then(() => {
      setTimeout(() => {
        if (window.stargate) {
          window.stargate.setDstChainId(102)
        }
      }, 600)
      setShow(true)
    })
  }, [])

  return (
    <Page>
      <Script crossOrigin="anonymous" src={STARGATE_JS.src} integrity={STARGATE_JS.integrity} />
      <Flex
        flexDirection="column"
        width={['100%', null, '420px']}
        bg="backgroundAlt"
        borderRadius={[0, null, 24]}
        alignItems="center"
        height="100%"
      >
        <StargateWidget theme={theme} />
        {show && (
          <Box display={['block', null, 'none']}>
            <PoweredBy />
          </Box>
        )}
      </Flex>
      {show && (
        <Box display={['none', null, 'block']}>
          <PoweredBy />
        </Box>
      )}
    </Page>
  )
}

export default Bridge
