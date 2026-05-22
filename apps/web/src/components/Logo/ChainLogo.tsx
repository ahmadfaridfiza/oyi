import Image from 'next/image'
import { HelpIcon } from '@pancakeswap/uikit'
import { isChainSupported } from 'utils/wagmi'
import { memo, useEffect, useState } from 'react'

export const ChainLogo = memo(
  ({ chainId, width = 24, height = 24 }: { chainId: number; width?: number; height?: number }) => {
    const [hasImageError, setHasImageError] = useState(false)

    useEffect(() => {
      setHasImageError(false)
    }, [chainId])

    if (isChainSupported(chainId) && !hasImageError) {
      return (
        <Image
          alt={`chain-${chainId}`}
          style={{ maxHeight: `${height}px` }}
          src={`/images/chains/${chainId}.png`}
          width={width}
          height={height}
          unoptimized
          onError={() => setHasImageError(true)}
        />
      )
    }

    return <HelpIcon width={width} height={height} />
  },
)
