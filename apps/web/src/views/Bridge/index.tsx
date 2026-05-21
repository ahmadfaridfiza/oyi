import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'
import { BigNumber } from '@ethersproject/bignumber'
import { MaxUint256 } from '@ethersproject/constants'
import { Contract } from '@ethersproject/contracts'
import { JsonRpcProvider } from '@ethersproject/providers'
import { formatUnits, parseUnits } from '@ethersproject/units'
import { ChainId, CurrencyAmount, JSBI, Native, Token } from '@pancakeswap/sdk'
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
import ConnectWalletButton from 'components/ConnectWalletButton'
import { ToastDescriptionWithTx } from 'components/Toast'
import { useCallWithGasPrice } from 'hooks/useCallWithGasPrice'
import { useEthersSigner } from 'hooks/useEthersSigner'
import { useSwitchNetwork } from 'hooks/useSwitchNetwork'
import useSWR from 'swr'
import { useAccount, useChainId } from 'wagmi'
import { useRouter } from 'next/router'
import Page from 'views/Page'
import ERC20_ABI from 'config/abi/erc20.json'
import {
  BRIDGE_CHAINS,
  BridgeToken,
  LIFI_NATIVE_TOKEN_ADDRESS,
  getBridgeChain,
  getBridgeTokens,
} from './config'

const Select = styled.select`
  width: 100%;
  height: 48px;
  border: 1px solid ${({ theme }) => theme.colors.inputSecondary};
  border-radius: 16px;
  background-color: ${({ theme }) => theme.colors.input};
  color: ${({ theme }) => theme.colors.text};
  font-size: 16px;
  padding: 0 16px;
  outline: none;
`

const FieldLabel = ({ children }: { children: ReactNode }) => (
  <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
    {children}
  </Text>
)

type BridgeQuote = {
  tool?: string
  toolDetails?: {
    name?: string
  }
  action?: {
    fromAmount?: string
  }
  estimate?: {
    toAmount?: string
    toAmountMin?: string
    executionDuration?: number
    feeCosts?: any[]
    gasCosts?: any[]
  }
  transactionRequest?: {
    to?: string
    data?: string
    value?: string
    gasLimit?: string
    gasPrice?: string
    maxFeePerGas?: string
    maxPriorityFeePerGas?: string
  }
}

const formatTokenAmount = (amount?: string, token?: BridgeToken) => {
  if (!amount || !token) return '-'
  try {
    const formatted = formatUnits(amount, token.decimals)
    const [whole, decimals = ''] = formatted.split('.')
    return decimals ? `${whole}.${decimals.slice(0, 6).replace(/0+$/, '')}` : whole
  } catch {
    return '-'
  }
}

const getBridgeCurrency = (token?: BridgeToken) => {
  if (!token) return undefined
  if (token.isNative) {
    try {
      return Native.onChain(token.chainId)
    } catch {
      return new Token(token.chainId, token.address, token.decimals, token.symbol, token.name)
    }
  }
  return new Token(token.chainId, token.address, token.decimals, token.symbol, token.name)
}

const getQuoteErrorMessage = async (response: Response) => {
  try {
    const body = await response.json()
    if (typeof body?.error === 'string') return body.error
    if (typeof body?.error?.message === 'string') return body.error.message
    if (typeof body?.message === 'string') return body.message
  } catch {
    return response.statusText
  }
  return response.statusText
}

const getBridgeReadProvider = (chainId: number) => {
  const chain = getBridgeChain(chainId)
  if (!chain?.rpcUrls?.[0]) {
    throw new Error(`RPC URL is not configured for chain ${chainId}`)
  }
  return new JsonRpcProvider(chain.rpcUrls[0], {
    chainId: chain.id,
    name: chain.name,
  })
}

const useBridgeCurrencyBalance = (account?: string, token?: BridgeToken) => {
  const currency = useMemo(() => getBridgeCurrency(token), [token])

  return useSWR(
    account && token && currency ? ['bridgeCurrencyBalance', account, token.chainId, token.address] : null,
    async () => {
      try {
        console.info('[Bridge] Fetching currency balance', {
          account,
          chainId: token.chainId,
          token: token.symbol,
          tokenAddress: token.address,
          isNative: Boolean(token.isNative),
        })

        const provider = getBridgeReadProvider(token.chainId)
        const rawBalance = token.isNative
          ? await provider.getBalance(account)
          : await new Contract(token.address, ERC20_ABI, provider).balanceOf(account)
        const currencyAmount = CurrencyAmount.fromRawAmount(currency, JSBI.BigInt(rawBalance.toString()))

        console.info('[Bridge] Currency balance fetched', {
          account,
          chainId: token.chainId,
          token: token.symbol,
          rawBalance: rawBalance.toString(),
          significantBalance: currencyAmount.toSignificant(6),
        })

        return {
          rawBalance,
          currencyAmount,
        }
      } catch (error) {
        console.error('[Bridge] Failed to fetch currency balance', {
          account,
          chainId: token.chainId,
          token: token.symbol,
          tokenAddress: token.address,
          error,
        })
        throw error
      }
    },
    {
      refreshInterval: 10000,
    },
  )
}

const Bridge = () => {
  const { t } = useTranslation()
  const router = useRouter()
  const { address: account } = useAccount()
  const connectedChainId = useChainId()
  const { switchNetworkAsync, isLoading: isSwitching } = useSwitchNetwork()
  const { callWithGasPrice } = useCallWithGasPrice()
  const { toastError, toastSuccess } = useToast()

  const [fromChainId, setFromChainId] = useState(137)
  const [toChainId, setToChainId] = useState(56)
  const [fromTokenAddress, setFromTokenAddress] = useState(getBridgeTokens(137)[0].address)
  const [toTokenAddress, setToTokenAddress] = useState(getBridgeTokens(56)[0].address)
  const [amount, setAmount] = useState('')
  const [quote, setQuote] = useState<BridgeQuote | null>(null)
  const [quoteError, setQuoteError] = useState('')
  const [isQuoting, setIsQuoting] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  const [isBridging, setIsBridging] = useState(false)
  const [txHash, setTxHash] = useState('')
  const { data: signer } = useEthersSigner({ chainId: fromChainId })

  const fromTokens = useMemo(() => getBridgeTokens(fromChainId), [fromChainId])
  const toTokens = useMemo(() => getBridgeTokens(toChainId), [toChainId])
  const fromToken = useMemo(
    () => fromTokens.find((token) => token.address === fromTokenAddress) ?? fromTokens[0],
    [fromTokenAddress, fromTokens],
  )
  const toToken = useMemo(
    () => toTokens.find((token) => token.address === toTokenAddress) ?? toTokens[0],
    [toTokenAddress, toTokens],
  )

  const parsedAmount = useMemo(() => {
    if (!amount || !fromToken) return null
    try {
      return parseUnits(amount, fromToken.decimals)
    } catch {
      return null
    }
  }, [amount, fromToken])

  const bridgeTokenContract = useMemo(() => {
    if (!fromToken || fromToken.isNative || connectedChainId !== fromChainId || !signer) return null
    try {
      return new Contract(fromToken.address, ERC20_ABI, signer)
    } catch {
      return null
    }
  }, [connectedChainId, fromChainId, fromToken, signer])
  const spender = quote?.transactionRequest?.to
  const shouldApprove = Boolean(account && fromToken && !fromToken.isNative && spender && parsedAmount)

  const { data: allowance, mutate: refreshAllowance } = useSWR(
    shouldApprove && bridgeTokenContract ? ['bridgeAllowance', account, fromToken.address, spender] : null,
    () => bridgeTokenContract.allowance(account, spender),
  )

  const { data: tokenBalance } = useBridgeCurrencyBalance(account, fromToken)

  const isApproved =
    !shouldApprove || !parsedAmount || (allowance ? BigNumber.from(allowance).gte(parsedAmount) : false)
  const isWrongNetwork = Boolean(account && connectedChainId !== fromChainId)
  const hasEnoughBalance = parsedAmount && tokenBalance ? tokenBalance.rawBalance.gte(parsedAmount) : false
  const canQuote = Boolean(account && fromToken && toToken && parsedAmount && parsedAmount.gt(0) && hasEnoughBalance)
  const canBridge = Boolean(account && signer && quote?.transactionRequest?.to && isApproved && !isWrongNetwork)

  const resetQuote = useCallback(() => {
    setQuote(null)
    setQuoteError('')
    setTxHash('')
  }, [])

  const requestSwitchNetwork = useCallback(
    async (chainId: number, reason: string) => {
      if (!account || connectedChainId === chainId || isSwitching) return

      try {
        console.info('[Bridge] Switching network with Wagmi', { chainId, reason })
        await switchNetworkAsync(chainId)
      } catch (error) {
        console.error('[Bridge] Failed to switch network with Wagmi', { chainId, reason, error })
        toastError(t('Error'), t('Unable to switch network. Please switch it manually in your wallet.'))
      }
    },
    [account, connectedChainId, isSwitching, switchNetworkAsync, t, toastError],
  )

  const handleFromChainChange = useCallback((nextChainId: number) => {
    const tokens = getBridgeTokens(nextChainId)
    setFromChainId(nextChainId)
    setFromTokenAddress(tokens[0]?.address ?? LIFI_NATIVE_TOKEN_ADDRESS)
    resetQuote()
    requestSwitchNetwork(nextChainId, 'from-chain-change')
  }, [requestSwitchNetwork, resetQuote])

  const handleToChainChange = useCallback((nextChainId: number) => {
    const tokens = getBridgeTokens(nextChainId)
    setToChainId(nextChainId)
    setToTokenAddress(tokens[0]?.address ?? LIFI_NATIVE_TOKEN_ADDRESS)
    resetQuote()
  }, [resetQuote])

  const handleGetQuote = useCallback(async () => {
    if (!account || !fromToken || !toToken || !parsedAmount || parsedAmount.lte(0)) return

    setIsQuoting(true)
    setQuote(null)
    setQuoteError('')
    setTxHash('')

    const params = new URLSearchParams({
      fromChain: String(fromChainId),
      toChain: String(toChainId),
      fromToken: fromToken.address,
      toToken: toToken.address,
      fromAmount: parsedAmount.toString(),
      fromAddress: account,
    })

    try {
      console.info('[Bridge] Fetching quote', {
        account,
        fromChainId,
        toChainId,
        fromToken: fromToken.symbol,
        toToken: toToken.symbol,
        fromAmount: parsedAmount.toString(),
      })
      const response = await fetch(`/api/bridge/quote?${params.toString()}`)
      if (!response.ok) {
        throw new Error(await getQuoteErrorMessage(response))
      }
      const nextQuote = (await response.json()) as BridgeQuote
      console.info('[Bridge] Quote fetched', {
        route: nextQuote.toolDetails?.name || nextQuote.tool,
        toAmount: nextQuote.estimate?.toAmount,
        spender: nextQuote.transactionRequest?.to,
      })
      setQuote(nextQuote)
    } catch (error) {
      console.error('[Bridge] Failed to fetch quote', error)
      setQuoteError(error instanceof Error ? error.message : t('Unable to get bridge quote.'))
    } finally {
      setIsQuoting(false)
    }
  }, [account, fromChainId, fromToken, parsedAmount, t, toChainId, toToken])

  const handleApprove = useCallback(async () => {
    if (!bridgeTokenContract || !spender) return

    setIsApproving(true)
    try {
      const tx = await callWithGasPrice(bridgeTokenContract, 'approve', [spender, MaxUint256])
      const receipt = await tx.wait()
      toastSuccess(t('Contract Enabled'), <ToastDescriptionWithTx txHash={receipt.transactionHash} />)
      refreshAllowance()
    } catch (error) {
      console.error(error)
      toastError(t('Error'), t('Unable to approve token. Please try again.'))
    } finally {
      setIsApproving(false)
    }
  }, [bridgeTokenContract, callWithGasPrice, refreshAllowance, spender, t, toastError, toastSuccess])

  const handleSwitchNetwork = useCallback(async () => {
    requestSwitchNetwork(fromChainId, 'bridge-button')
  }, [fromChainId, requestSwitchNetwork])

  useEffect(() => {
    const switchBackToPolygon = (nextUrl: string) => {
      if (nextUrl.startsWith('/bridge') || nextUrl.includes('/bridge?')) return
      requestSwitchNetwork(ChainId.BSC, 'leaving-bridge')
    }

    router.events.on('routeChangeStart', switchBackToPolygon)
    return () => {
      router.events.off('routeChangeStart', switchBackToPolygon)
    }
  }, [requestSwitchNetwork, router.events])

  const handleBridge = useCallback(async () => {
    const txRequest = quote?.transactionRequest
    if (!txRequest?.to || !signer) return

    setIsBridging(true)
    try {
      const tx = await signer.sendTransaction({
        to: txRequest.to,
        data: txRequest.data,
        value: txRequest.value ?? '0',
        gasLimit: txRequest.gasLimit,
        gasPrice: txRequest.gasPrice,
        maxFeePerGas: txRequest.maxFeePerGas,
        maxPriorityFeePerGas: txRequest.maxPriorityFeePerGas,
      })
      setTxHash(tx.hash)
      toastSuccess(t('Bridge transaction sent'), <ToastDescriptionWithTx txHash={tx.hash} />)
      await tx.wait()
    } catch (error) {
      console.error(error)
      toastError(t('Error'), t('Unable to send bridge transaction.'))
    } finally {
      setIsBridging(false)
    }
  }, [quote, signer, t, toastError, toastSuccess])

  return (
    <Page>
      <Box maxWidth="620px" mx="auto" width="100%">
        <Card>
          <CardBody>
            <Heading scale="xl" mb="8px">
              {t('Bridge Token')}
            </Heading>
            <Text color="textSubtle" mb="24px">
              {t('Bridge tokens across supported chains using LI.FI routes while keeping the transaction in your wallet.')}
            </Text>

            <Flex mb="16px" flexDirection={['column', null, 'row']} style={{ gap: '16px' }}>
              <Box width="100%" style={{ flex: 1 }}>
                <FieldLabel>{t('From Chain')}</FieldLabel>
                <Select value={fromChainId} onChange={(event) => handleFromChainChange(Number(event.target.value))}>
                  {BRIDGE_CHAINS.map((chain) => (
                    <option key={chain.id} value={chain.id}>
                      {chain.name}
                    </option>
                  ))}
                </Select>
              </Box>
              <Box width="100%" style={{ flex: 1 }}>
                <FieldLabel>{t('To Chain')}</FieldLabel>
                <Select value={toChainId} onChange={(event) => handleToChainChange(Number(event.target.value))}>
                  {BRIDGE_CHAINS.map((chain) => (
                    <option key={chain.id} value={chain.id}>
                      {chain.name}
                    </option>
                  ))}
                </Select>
              </Box>
            </Flex>

            <Flex mb="16px" flexDirection={['column', null, 'row']} style={{ gap: '16px' }}>
              <Box width="100%" style={{ flex: 1 }}>
                <Flex justifyContent="space-between" alignItems="center">
                  <FieldLabel>{t('From Token')}</FieldLabel>
                  {account && fromToken ? (
                    <Text color="textSubtle" fontSize="12px" mb="8px">
                      {t('Balance: %balance%', {
                        balance: tokenBalance?.currencyAmount?.toSignificant(6) ?? t('Loading'),
                      })}
                    </Text>
                  ) : null}
                </Flex>
                <Select
                  value={fromTokenAddress}
                  onChange={(event) => {
                    setFromTokenAddress(event.target.value)
                    resetQuote()
                  }}
                >
                  {fromTokens.map((token) => (
                    <option key={token.address} value={token.address}>
                      {token.symbol}
                    </option>
                  ))}
                </Select>
              </Box>
              <Box width="100%" style={{ flex: 1 }}>
                <FieldLabel>{t('To Token')}</FieldLabel>
                <Select
                  value={toTokenAddress}
                  onChange={(event) => {
                    setToTokenAddress(event.target.value)
                    resetQuote()
                  }}
                >
                  {toTokens.map((token) => (
                    <option key={token.address} value={token.address}>
                      {token.symbol}
                    </option>
                  ))}
                </Select>
              </Box>
            </Flex>

            <Box mb="20px">
              <FieldLabel>{t('Amount')}</FieldLabel>
              <Input
                inputMode="decimal"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value)
                  resetQuote()
                }}
                placeholder="0.0"
              />
            </Box>

            {quote ? (
              <Box mb="20px" p="16px" borderRadius="16px" bg="background">
                <Flex justifyContent="space-between" mb="8px">
                  <Text color="textSubtle">{t('Estimated Receive')}</Text>
                  <Text bold>
                    {formatTokenAmount(quote.estimate?.toAmount, toToken)} {toToken?.symbol}
                  </Text>
                </Flex>
                <Flex justifyContent="space-between" mb="8px">
                  <Text color="textSubtle">{t('Minimum Receive')}</Text>
                  <Text>{formatTokenAmount(quote.estimate?.toAmountMin, toToken)}</Text>
                </Flex>
                <Flex justifyContent="space-between" mb="8px">
                  <Text color="textSubtle">{t('Route')}</Text>
                  <Text>{quote.toolDetails?.name || quote.tool || '-'}</Text>
                </Flex>
                <Flex justifyContent="space-between">
                  <Text color="textSubtle">{t('From')}</Text>
                  <Text>
                    {getBridgeChain(fromChainId)?.shortName} {t('to')} {getBridgeChain(toChainId)?.shortName}
                  </Text>
                </Flex>
              </Box>
            ) : null}

            {quoteError ? (
              <Message variant="danger" mb="20px">
                <MessageText>{quoteError}</MessageText>
              </Message>
            ) : null}

            {isWrongNetwork ? (
              <Message variant="warning" mb="20px">
                <MessageText>
                  {t('Please switch your wallet to %chain% before approving or bridging.', {
                    chain: getBridgeChain(fromChainId)?.name ?? fromChainId,
                  })}
                </MessageText>
              </Message>
            ) : null}

            {!account ? (
              <ConnectWalletButton width="100%" />
            ) : isWrongNetwork ? (
              <Button
                width="100%"
                onClick={handleSwitchNetwork}
                disabled={isSwitching}
                endIcon={isSwitching ? <AutoRenewIcon spin color="currentColor" /> : undefined}
              >
                {t('Switch Network')}
              </Button>
            ) : parsedAmount && parsedAmount.gt(0) && tokenBalance && !hasEnoughBalance ? (
              <Button width="100%" disabled>
                {t('Insufficient %symbol% Balance', { symbol: fromToken?.symbol })}
              </Button>
            ) : !quote ? (
              <Button
                width="100%"
                onClick={handleGetQuote}
                disabled={!canQuote || isQuoting}
                endIcon={isQuoting ? <AutoRenewIcon spin color="currentColor" /> : undefined}
              >
                {t('Get Quote')}
              </Button>
            ) : !isApproved ? (
              <Button
                width="100%"
                onClick={handleApprove}
                disabled={isApproving}
                endIcon={isApproving ? <AutoRenewIcon spin color="currentColor" /> : undefined}
              >
                {t('Enable %symbol%', { symbol: fromToken?.symbol })}
              </Button>
            ) : (
              <Button
                width="100%"
                onClick={handleBridge}
                disabled={!canBridge || isBridging}
                endIcon={isBridging ? <AutoRenewIcon spin color="currentColor" /> : undefined}
              >
                {t('Bridge Token')}
              </Button>
            )}

            {txHash ? (
              <Message variant="success" mt="20px">
                <MessageText>{t('Bridge transaction submitted. Follow the transaction in your wallet.')}</MessageText>
              </Message>
            ) : null}
          </CardBody>
        </Card>
      </Box>
    </Page>
  )
}

export default Bridge
