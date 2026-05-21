import { arbitrum, mainnet, optimism, polygon, avalanche, fantom } from 'wagmi/chains'

const VERSION = '0.0.33'
const SHA384 = '021ubXIhzewAwp2U/18P+WBqyCb6BviBfQGTvZOpHQi3h5fiNknvYAwiz9mS04Th'
export const PARTNER_ID = 0x0002
export const FEE_COLLECTOR = '0xc6F09C01b4C213932907D1CC56144f301DeaD153'
export const FEE_TENTH_BPS = '0'

export const STARGATE_JS = {
  src: `https://unpkg.com/@layerzerolabs/stargate-ui@${VERSION}/element.js`,
  integrity: `sha384-${SHA384}`,
}

export const CHAINS_STARGATE = [mainnet, arbitrum, optimism, polygon, avalanche, fantom]
