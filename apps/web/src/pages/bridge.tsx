import Bridge from '../views/Bridge'
import { BRIDGE_CHAINS } from '../config/constants/bridgeChains'

const BridgePage = () => {
  return <Bridge />
}

BridgePage.chains = BRIDGE_CHAINS.map((chain) => chain.id)

export default BridgePage
