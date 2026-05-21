import { arbitrum, mainnet, optimism, polygon, avalanche, fantom } from 'wagmi/chains'

const VERSION = '0.0.33'
const SHA384 = 'RDYGBMTG+YS5OF8Kavau0Xdyq6j7e/5bFMF55lYu3Oz3gthIOqQSSJkcz96n6knF'
export const PARTNER_ID = 0x0002
export const FEE_COLLECTOR = '0xc6F09C01b4C213932907D1CC56144f301DeaD153'
export const FEE_TENTH_BPS = '10'

export const STARGATE_JS = {
  src: `https://unpkg.com/@layerzerolabs/stargate-ui@${VERSION}/element.js`,
  integrity: `sha384-${SHA384}`,
}

export const CHAINS_STARGATE = [mainnet, arbitrum, optimism, polygon, avalanche, fantom]
