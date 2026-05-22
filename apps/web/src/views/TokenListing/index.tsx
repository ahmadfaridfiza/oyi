import { useCallback, useMemo, useState } from 'react'
import { BigNumber } from '@ethersproject/bignumber'
import { parseUnits } from '@ethersproject/units'
import { useTranslation } from '@pancakeswap/localization'
import {
  AutoRenewIcon,
  Box,
  Button,
  Card,
  CardBody,
  Flex,
  Heading,
  Input,
  Message,
  MessageText,
  Text,
  useToast,
} from '@pancakeswap/uikit'
import { bscTokens } from '@pancakeswap/tokens'
import ConnectWalletButton from 'components/ConnectWalletButton'
import { ToastDescriptionWithTx } from 'components/Toast'
import { useActiveChainId } from 'hooks/useActiveChainId'
import { useCallWithGasPrice } from 'hooks/useCallWithGasPrice'
import { useTokenContract } from 'hooks/useContract'
import { useSwitchNetwork } from 'hooks/useSwitchNetwork'
import { useAccount } from 'wagmi'
import { mutate } from 'swr'
import Page from 'views/Page'
import { TOKEN_LISTING_CHAIN_ID, TOKEN_LISTING_FEE } from 'config/constants/tokenListing'

const LISTING_FEE = parseUnits(TOKEN_LISTING_FEE, 18)

type LiquidityCheck = {
  chainId: number
  address: string
  name: string
  symbol: string
  decimals: number
  liquidityUSD: number
  hasEnoughLiquidity: boolean
  minLiquidityUSD: number
  pairAddress?: string
  referenceToken?: string
  listingFee: string
  feeReceiver: string
  feeToken: string
}

const readLogoFile = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = reject
    reader.readAsDataURL(file)
  })

const TokenListing = () => {
  const { t } = useTranslation()
  const { address: account } = useAccount()
  const { chainId } = useActiveChainId()
  const { callWithGasPrice } = useCallWithGasPrice()
  const { switchNetworkAsync, isLoading: isSwitchingNetwork } = useSwitchNetwork()
  const { toastError, toastSuccess } = useToast()

  const plaxToken = bscTokens.cake
  const plaxContract = useTokenContract(plaxToken.address)

  const [tokenAddress, setTokenAddress] = useState('')
  const [logoDataUrl, setLogoDataUrl] = useState('')
  const [logoName, setLogoName] = useState('')
  const [liquidityCheck, setLiquidityCheck] = useState<LiquidityCheck | null>(null)
  const [isChecking, setIsChecking] = useState(false)
  const [isListing, setIsListing] = useState(false)

  const isWrongNetwork = chainId !== TOKEN_LISTING_CHAIN_ID
  const canCheck = Boolean(tokenAddress && !isChecking)
  const canList = Boolean(liquidityCheck?.hasEnoughLiquidity && logoDataUrl && account && !isListing)

  const formattedLiquidity = useMemo(() => {
    if (!liquidityCheck) return '-'
    return `$${Number(liquidityCheck.liquidityUSD).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  }, [liquidityCheck])

  const handleLogoChange = useCallback(async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setLogoDataUrl('')
      setLogoName('')
      return
    }

    if (file.size > 700_000) {
      setLogoDataUrl('')
      setLogoName('')
      return
    }

    setLogoDataUrl(await readLogoFile(file))
    setLogoName(file.name)
  }, [])

  const handleCheckLiquidity = useCallback(async () => {
    setIsChecking(true)
    setLiquidityCheck(null)

    try {
      const response = await fetch(`/api/token-listing/check?address=${encodeURIComponent(tokenAddress.trim())}`)
      const body = await response.json()

      if (!response.ok) {
        throw new Error(body?.error ?? 'Unable to check liquidity')
      }

      setLiquidityCheck(body)
    } catch (error) {
      toastError(t('Error'), error instanceof Error ? error.message : t('Unable to check liquidity'))
    } finally {
      setIsChecking(false)
    }
  }, [t, toastError, tokenAddress])

  const handleListToken = useCallback(async () => {
    if (!liquidityCheck || !plaxContract) return

    setIsListing(true)
    try {
      const tx = await callWithGasPrice(plaxContract, 'transfer', [liquidityCheck.feeReceiver, LISTING_FEE])
      const receipt = await tx.wait()

      const response = await fetch('/api/token-listing/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          address: liquidityCheck.address,
          txHash: receipt.transactionHash,
          logoDataUrl,
        }),
      })
      const body = await response.json()

      if (!response.ok) {
        throw new Error(body?.error ?? 'Unable to list token')
      }

      await mutate('tokenListingList')
      toastSuccess(
        t('Token listed'),
        <ToastDescriptionWithTx txHash={receipt.transactionHash}>
          {t('%symbol% is now available in the Swap token list.', { symbol: liquidityCheck.symbol })}
        </ToastDescriptionWithTx>,
      )
    } catch (error) {
      toastError(t('Error'), error instanceof Error ? error.message : t('Unable to list token'))
    } finally {
      setIsListing(false)
    }
  }, [callWithGasPrice, liquidityCheck, logoDataUrl, plaxContract, t, toastError, toastSuccess])

  return (
    <Page>
      <Box maxWidth="640px" mx="auto" width="100%">
        <Card>
          <CardBody>
            <Heading scale="lg" mb="8px">
              {t('Token Listing')}
            </Heading>
            <Text color="textSubtle" mb="24px">
              {t('List a Polygon token in Swap after liquidity is verified and a %fee% PLAX fee is paid.', {
                fee: TOKEN_LISTING_FEE,
              })}
            </Text>

            <Box mb="16px">
              <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
                {t('Contract Address')}
              </Text>
              <Input
                value={tokenAddress}
                onChange={(event) => setTokenAddress(event.target.value)}
                placeholder="0x..."
                disabled={isChecking || isListing}
              />
            </Box>

            <Box mb="16px">
              <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
                {t('Logo')}
              </Text>
              <Input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleLogoChange} />
              <Text color="textSubtle" fontSize="12px" mt="6px">
                {logoName || t('PNG, JPG, or WEBP. Maximum 700 KB.')}
              </Text>
            </Box>

            <Button width="100%" mb="16px" onClick={handleCheckLiquidity} disabled={!canCheck || isListing}>
              {isChecking ? <AutoRenewIcon spin color="currentColor" mr="8px" /> : null}
              {t('Check Liquidity')}
            </Button>

            {liquidityCheck ? (
              <Message variant={liquidityCheck.hasEnoughLiquidity ? 'success' : 'danger'} mb="16px">
                <MessageText>
                  {liquidityCheck.hasEnoughLiquidity
                    ? t('Liquidity verified: %liquidity%', { liquidity: formattedLiquidity })
                    : t('Liquidity not enough. Minimum liquidity is $%amount%. Current liquidity is %liquidity%.', {
                        amount: liquidityCheck.minLiquidityUSD,
                        liquidity: formattedLiquidity,
                      })}
                </MessageText>
              </Message>
            ) : null}

            {liquidityCheck ? (
              <Box mb="16px">
                <Flex justifyContent="space-between" mb="8px">
                  <Text color="textSubtle">{t('Token')}</Text>
                  <Text bold>
                    {liquidityCheck.symbol} - {liquidityCheck.name}
                  </Text>
                </Flex>
                <Flex justifyContent="space-between" mb="8px">
                  <Text color="textSubtle">{t('Liquidity Pair')}</Text>
                  <Text bold>{liquidityCheck.referenceToken ?? '-'}</Text>
                </Flex>
                <Flex justifyContent="space-between">
                  <Text color="textSubtle">{t('Listing Fee')}</Text>
                  <Text bold>{t('%fee% PLAX', { fee: TOKEN_LISTING_FEE })}</Text>
                </Flex>
              </Box>
            ) : null}

            {!account ? (
              <ConnectWalletButton width="100%" />
            ) : (
              <Button
                width="100%"
                disabled={!canList || isSwitchingNetwork}
                onClick={() => (isWrongNetwork ? switchNetworkAsync(TOKEN_LISTING_CHAIN_ID) : handleListToken())}
              >
                {isListing || isSwitchingNetwork ? <AutoRenewIcon spin color="currentColor" mr="8px" /> : null}
                {isWrongNetwork
                  ? t('Switch to Polygon')
                  : BigNumber.from(liquidityCheck?.listingFee ?? 0).gt(0)
                  ? t('Pay %fee% PLAX & List Token', { fee: TOKEN_LISTING_FEE })
                  : t('List Token')}
              </Button>
            )}

            {account && isWrongNetwork ? (
              <Text color="failure" mt="12px" textAlign="center">
                {t('Token listing is available on Polygon only.')}
              </Text>
            ) : null}
          </CardBody>
        </Card>
      </Box>
    </Page>
  )
}

export default TokenListing
