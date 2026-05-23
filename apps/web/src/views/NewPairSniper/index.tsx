import { useCallback, useMemo, useState } from 'react'
import { BigNumber } from '@ethersproject/bignumber'
import { Contract as EthersContract } from '@ethersproject/contracts'
import type { Contract } from '@ethersproject/contracts'
import { MaxUint256 } from '@ethersproject/constants'
import { formatUnits, parseUnits } from '@ethersproject/units'
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
import { useNewPairSniperContract, useTokenContract } from 'hooks/useContract'
import useSWR from 'swr'
import { isAddress } from 'utils'
import { getNewPairSniperAddress } from 'utils/addressHelpers'
import { useAccount } from 'wagmi'
import Page from 'views/Page'

type NewPairSniperView = 'create' | 'my-bots'
type BotFilter = 'active' | 'inactive'

type BotInfo = {
  id: BigNumber
  owner: string
  router: string
  factory: string
  quoteToken: string
  targetToken: string
  pair: string
  buyToken: string
  buyAmount: BigNumber
  remainingBuyAmount: BigNumber
  acquiredAmount: BigNumber
  proceedsToken: string
  proceedsAmount: BigNumber
  stopLossBps: number
  takeProfitBps: number
  slippageBps: number
  minLiquidityUsd: BigNumber
  status: number
  buyWithNative: boolean
  createdAt: BigNumber
  detectedAt: BigNumber
  boughtAt: BigNumber
  soldAt: BigNumber
}

type WithdrawTokenPayload = {
  token: string
  amount: BigNumber
}

type TokenMetadata = {
  name: string
  symbol: string
  decimals: number
}

const BOT_FEE = parseUnits('1', 18)
const NATIVE_BUY_TOKEN = 'native'
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const POLYGON_CHAIN_ID = 137
const WRAPPED_POL = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'
const DEFAULT_SLIPPAGE = '20'
const DEFAULT_MIN_LIQUIDITY = '100'
const ERC20_METADATA_ABI = ['function name() view returns (string)', 'function symbol() view returns (string)', 'function decimals() view returns (uint8)']

const toBps = (value: string) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.round(parsed * 100)
}

const isInactiveBot = (bot: BotInfo) =>
  (bot.status === 2 || bot.status === 4) && bot.remainingBuyAmount.eq(0) && bot.acquiredAmount.eq(0) && bot.proceedsAmount.eq(0)

const statusLabel = (bot: BotInfo) => {
  if (isInactiveBot(bot)) return 'Inactive'
  if (bot.status === 1) return bot.targetToken === ZERO_ADDRESS ? 'Scanning' : 'Active'
  if (bot.status === 2) return 'Paused'
  if (bot.status === 3) return 'Bought'
  if (bot.status === 4) return 'Sold'
  return 'Unknown'
}

const formatHistoryDate = (timestamp?: BigNumber) => {
  if (!timestamp || timestamp.eq(0)) return '-'
  return new Date(timestamp.toNumber() * 1000).toLocaleString()
}

const NewPairSniperTabs: React.FC<{ activeView: NewPairSniperView }> = ({ activeView }) => {
  const { t } = useTranslation()
  const links = [
    { href: '/dex-new-pair-sniper', label: t('Create Scanner Bot'), view: 'create' },
    { href: '/dex-new-pair-sniper/my-bots', label: t('My Scanner Bots'), view: 'my-bots' },
  ]

  return (
    <Flex mb="24px" style={{ gap: '8px', flexWrap: 'wrap' }}>
      {links.map((link) => (
        <Button key={link.href} as="a" href={link.href} scale="sm" variant={activeView === link.view ? 'primary' : 'secondary'}>
          {link.label}
        </Button>
      ))}
    </Flex>
  )
}

const useTokenMetadata = (contract: Contract, tokenAddress: string) => {
  return useSWR(contract && tokenAddress !== ZERO_ADDRESS ? ['newPairSniperTokenMetadata', contract.address, tokenAddress] : null, async () => {
    const tokenContract = new EthersContract(tokenAddress, ERC20_METADATA_ABI, contract.provider)
    const [name, symbol, decimals] = await Promise.all([
      tokenContract.name().catch(() => ''),
      tokenContract.symbol().catch(() => 'TOKEN'),
      tokenContract.decimals().catch(() => 18),
    ])
    return { name, symbol, decimals: Number(decimals) } as TokenMetadata
  })
}

const BotRow: React.FC<{
  bot: BotInfo
  contract: Contract
  actionBotId: string
  isExpanded: boolean
  onToggle: (botId: string) => void
  onPause: (bot: BotInfo) => void
  onResume: (bot: BotInfo) => void
  onWithdrawNative: (bot: BotInfo, amount: BigNumber) => void
  onWithdrawToken: (bot: BotInfo, payload: WithdrawTokenPayload) => void
}> = ({ bot, contract, actionBotId, isExpanded, onToggle, onPause, onResume, onWithdrawNative, onWithdrawToken }) => {
  const { t } = useTranslation()
  const buyDecimals = bot.buyWithNative ? 18 : bot.buyToken.toLowerCase() === bscTokens.usdt.address.toLowerCase() ? 6 : 18
  const buySymbol = bot.buyWithNative ? 'POL' : bot.buyToken.toLowerCase() === bscTokens.usdt.address.toLowerCase() ? 'USDT' : 'TOKEN'
  const { data: targetMetadata } = useTokenMetadata(contract, bot.targetToken)
  const targetSymbol = targetMetadata?.symbol || t('Pending')
  const targetDecimals = targetMetadata?.decimals ?? 18
  const isActionLoading = actionBotId === bot.id.toString()
  const isInactive = isInactiveBot(bot)
  const nativeWithdrawAmount = (bot.buyWithNative ? bot.remainingBuyAmount : BigNumber.from(0)).add(
    bot.proceedsToken === ZERO_ADDRESS ? bot.proceedsAmount : BigNumber.from(0),
  )
  const tokenWithdraws = [
    !bot.buyWithNative && bot.remainingBuyAmount.gt(0) ? { token: bot.buyToken, amount: bot.remainingBuyAmount, label: buySymbol, decimals: buyDecimals } : null,
    bot.acquiredAmount.gt(0) ? { token: bot.targetToken, amount: bot.acquiredAmount, label: targetSymbol, decimals: targetDecimals } : null,
    bot.proceedsToken !== ZERO_ADDRESS && bot.proceedsAmount.gt(0)
      ? { token: bot.proceedsToken, amount: bot.proceedsAmount, label: buySymbol, decimals: buyDecimals }
      : null,
  ].filter(Boolean) as Array<WithdrawTokenPayload & { label: string; decimals: number }>
  const canWithdraw = bot.status === 2 || bot.status === 4

  return (
    <Box p="16px" border="1px solid" borderColor="cardBorder" borderRadius="8px">
      <Flex justifyContent="space-between" alignItems="flex-start" mb={isExpanded ? '12px' : '0'} style={{ gap: '12px' }}>
        <Box>
          <Text bold>{t('Scanner Bot #%id%', { id: bot.id.toString() })}</Text>
          <Text fontSize="13px">
            {bot.targetToken === ZERO_ADDRESS ? t('Waiting for new pair') : `${targetSymbol} (${bot.targetToken})`}
          </Text>
          <Text color="textSubtle" fontSize="12px" ellipsis maxWidth="280px">
            {bot.factory}
          </Text>
        </Box>
        <Flex alignItems="center" style={{ gap: '8px', flexShrink: 0 }}>
          <Text color={bot.status === 1 || bot.status === 3 ? 'success' : 'textSubtle'} bold>
            {statusLabel(bot)}
          </Text>
          <Button scale="sm" variant="secondary" onClick={() => onToggle(bot.id.toString())}>
            {isExpanded ? t('Hide') : t('Details')}
          </Button>
        </Flex>
      </Flex>

      {isExpanded ? (
        <>
          <Flex flexDirection={['column', null, 'row']} style={{ gap: '12px' }}>
            <Box width="100%">
              <Text color="textSubtle" fontSize="12px">
                {t('Buy Amount')}
              </Text>
              <Text>
                {formatUnits(bot.buyAmount, buyDecimals)} {buySymbol}
              </Text>
            </Box>
            <Box width="100%">
              <Text color="textSubtle" fontSize="12px">
                {t('Take Profit')}
              </Text>
              <Text>{bot.takeProfitBps / 100}%</Text>
            </Box>
            <Box width="100%">
              <Text color="textSubtle" fontSize="12px">
                {t('Stop Loss')}
              </Text>
              <Text>{bot.stopLossBps / 100}%</Text>
            </Box>
          </Flex>
          <Flex mt="12px" flexDirection="column" style={{ gap: '4px' }}>
            <Text color="textSubtle" fontSize="12px">
              {t('Pair')}: {bot.pair === ZERO_ADDRESS ? '-' : bot.pair}
            </Text>
            <Text color="textSubtle" fontSize="12px">
              {t('Created')}: {formatHistoryDate(bot.createdAt)}
            </Text>
            <Text color="textSubtle" fontSize="12px">
              {t('Detected')}: {formatHistoryDate(bot.detectedAt)}
            </Text>
            <Text color="textSubtle" fontSize="12px">
              {t('Bought')}: {formatHistoryDate(bot.boughtAt)}
            </Text>
            <Text color="textSubtle" fontSize="12px">
              {t('Sold')}: {formatHistoryDate(bot.soldAt)}
            </Text>
          </Flex>
          <Flex mt="16px" style={{ gap: '8px', flexWrap: 'wrap' }}>
            <Button scale="sm" disabled={isInactive || (bot.status !== 1 && bot.status !== 3)} onClick={() => onPause(bot)}>
              {isActionLoading ? <AutoRenewIcon spin color="currentColor" mr="6px" /> : null}
              {isInactive ? t('Inactive') : t('Pause')}
            </Button>
            {!isInactive ? (
              <Button scale="sm" variant="secondary" disabled={bot.status !== 2} onClick={() => onResume(bot)}>
                {isActionLoading ? <AutoRenewIcon spin color="currentColor" mr="6px" /> : null}
                {t('Resume')}
              </Button>
            ) : null}
          </Flex>
        </>
      ) : null}

      {isExpanded && canWithdraw ? (
        <Box mt="16px">
          <Text bold mb="8px">
            {t('Withdraw')}
          </Text>
          <Flex style={{ gap: '8px', flexWrap: 'wrap' }}>
            {nativeWithdrawAmount.gt(0) ? (
              <Button scale="sm" variant="secondary" disabled={isActionLoading} onClick={() => onWithdrawNative(bot, nativeWithdrawAmount)}>
                {isActionLoading ? <AutoRenewIcon spin color="currentColor" mr="6px" /> : null}
                {t('Withdraw %amount% POL', { amount: formatUnits(nativeWithdrawAmount, 18) })}
              </Button>
            ) : null}
            {tokenWithdraws.map((withdraw) => (
              <Button
                key={`${withdraw.token}-${withdraw.amount.toString()}`}
                scale="sm"
                variant="secondary"
                disabled={isActionLoading}
                onClick={() => onWithdrawToken(bot, { token: withdraw.token, amount: withdraw.amount })}
              >
                {isActionLoading ? <AutoRenewIcon spin color="currentColor" mr="6px" /> : null}
                {t('Withdraw %amount% %symbol%', { amount: formatUnits(withdraw.amount, withdraw.decimals), symbol: withdraw.label })}
              </Button>
            ))}
            {!nativeWithdrawAmount.gt(0) && tokenWithdraws.length === 0 ? (
              <Text color="textSubtle" fontSize="12px">
                {t('No withdrawable balance.')}
              </Text>
            ) : null}
          </Flex>
        </Box>
      ) : null}
    </Box>
  )
}

const NewPairSniper: React.FC<{ activeView?: NewPairSniperView }> = ({ activeView = 'create' }) => {
  const { t } = useTranslation()
  const { address: account } = useAccount()
  const { chainId } = useActiveChainId()
  const { callWithGasPrice } = useCallWithGasPrice()
  const { toastError, toastSuccess } = useToast()

  const sniperAddress = useMemo(() => getNewPairSniperAddress(chainId), [chainId])
  const contract = useNewPairSniperContract()
  const plaxToken = bscTokens.cake
  const usdtToken = bscTokens.usdt
  const plaxContract = useTokenContract(plaxToken.address)
  const usdtContract = useTokenContract(usdtToken.address)
  const hasAddress = Boolean(sniperAddress)

  const [router, setRouter] = useState('')
  const [factory, setFactory] = useState('')
  const [buyTokenMode, setBuyTokenMode] = useState(NATIVE_BUY_TOKEN)
  const [buyAmount, setBuyAmount] = useState('')
  const [takeProfit, setTakeProfit] = useState('100')
  const [stopLoss, setStopLoss] = useState('30')
  const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE)
  const [minLiquidity, setMinLiquidity] = useState(DEFAULT_MIN_LIQUIDITY)
  const [isApprovingFee, setIsApprovingFee] = useState(false)
  const [isApprovingBuyToken, setIsApprovingBuyToken] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [actionBotId, setActionBotId] = useState('')
  const [botFilter, setBotFilter] = useState<BotFilter>('active')
  const [expandedBotId, setExpandedBotId] = useState('')

  const buyWithNative = buyTokenMode === NATIVE_BUY_TOKEN
  const quoteToken = buyWithNative ? WRAPPED_POL : usdtToken.address
  const buyTokenContract = buyWithNative ? null : usdtContract
  const buyDecimals = buyWithNative ? 18 : usdtToken.decimals
  const parsedBuyAmount = useMemo(() => {
    try {
      return buyAmount ? parseUnits(buyAmount, buyDecimals) : null
    } catch {
      return null
    }
  }, [buyAmount, buyDecimals])

  const { data: feeAllowance, mutate: refreshFeeAllowance } = useSWR(
    account && sniperAddress && plaxContract ? ['newPairSniperFeeAllowance', account, sniperAddress] : null,
    () => plaxContract.allowance(account, sniperAddress),
  )
  const { data: buyTokenAllowance, mutate: refreshBuyTokenAllowance } = useSWR(
    account && sniperAddress && buyTokenContract && parsedBuyAmount ? ['newPairSniperBuyAllowance', account, sniperAddress, buyTokenMode] : null,
    () => buyTokenContract.allowance(account, sniperAddress),
  )
  const { data: bots, mutate: refreshBots } = useSWR(
    activeView === 'my-bots' && account && contract ? ['newPairSniperBots', account] : null,
    () => contract.getBotsByOwner(account, 0, 50) as Promise<BotInfo[]>,
    { refreshInterval: 10000 },
  )

  const activeBots = useMemo(() => (bots ?? []).filter((bot) => !isInactiveBot(bot)), [bots])
  const inactiveBots = useMemo(() => (bots ?? []).filter((bot) => isInactiveBot(bot)), [bots])
  const filteredBots = botFilter === 'active' ? activeBots : inactiveBots
  const isApprovedFee = feeAllowance ? BigNumber.from(feeAllowance).gte(BOT_FEE) : false
  const isApprovedBuyToken = buyWithNative || (buyTokenAllowance && parsedBuyAmount ? BigNumber.from(buyTokenAllowance).gte(parsedBuyAmount) : false)
  const isWrongNetwork = chainId !== POLYGON_CHAIN_ID
  const canCreate =
    account &&
    hasAddress &&
    !isWrongNetwork &&
    isAddress(router) &&
    isAddress(factory) &&
    parsedBuyAmount?.gt(0) &&
    toBps(takeProfit) &&
    toBps(stopLoss) !== null &&
    toBps(slippage) !== null

  const handleApproveFee = useCallback(async () => {
    if (!plaxContract || !sniperAddress) return
    setIsApprovingFee(true)
    try {
      const tx = await callWithGasPrice(plaxContract, 'approve', [sniperAddress, MaxUint256])
      await tx.wait()
      await refreshFeeAllowance()
      toastSuccess(t('PLAX enabled'), <ToastDescriptionWithTx txHash={tx.hash}>{t('You can start a new pair scanner bot now.')}</ToastDescriptionWithTx>)
    } catch {
      toastError(t('Error'), t('Unable to approve PLAX. Please try again.'))
    } finally {
      setIsApprovingFee(false)
    }
  }, [callWithGasPrice, plaxContract, refreshFeeAllowance, sniperAddress, t, toastError, toastSuccess])

  const handleApproveBuyToken = useCallback(async () => {
    if (!buyTokenContract || !sniperAddress) return
    setIsApprovingBuyToken(true)
    try {
      const tx = await callWithGasPrice(buyTokenContract, 'approve', [sniperAddress, MaxUint256])
      await tx.wait()
      await refreshBuyTokenAllowance()
      toastSuccess(t('USDT enabled'), <ToastDescriptionWithTx txHash={tx.hash}>{t('USDT can be used by your scanner bot.')}</ToastDescriptionWithTx>)
    } catch {
      toastError(t('Error'), t('Unable to approve USDT. Please try again.'))
    } finally {
      setIsApprovingBuyToken(false)
    }
  }, [buyTokenContract, callWithGasPrice, refreshBuyTokenAllowance, sniperAddress, t, toastError, toastSuccess])

  const handleCreateBot = useCallback(async () => {
    if (!contract || !parsedBuyAmount) return
    const stopLossBps = toBps(stopLoss)
    const takeProfitBps = toBps(takeProfit)
    const slippageBps = toBps(slippage)
    if (stopLossBps === null || takeProfitBps === null || slippageBps === null) return

    setIsCreating(true)
    try {
      const tx = await callWithGasPrice(
        contract,
        'createBot',
        [
          router,
          factory,
          quoteToken,
          buyWithNative ? ZERO_ADDRESS : usdtToken.address,
          parsedBuyAmount,
          stopLossBps,
          takeProfitBps,
          slippageBps,
          parseUnits(minLiquidity || '0', 18),
          buyWithNative,
        ],
        buyWithNative ? { value: parsedBuyAmount } : undefined,
      )
      await tx.wait()
      toastSuccess(t('Scanner bot started'), <ToastDescriptionWithTx txHash={tx.hash}>{t('The keeper will scan for the next matching pair.')}</ToastDescriptionWithTx>)
      await refreshBots()
    } catch (error) {
      toastError(t('Error'), error instanceof Error ? error.message : t('Unable to create scanner bot.'))
    } finally {
      setIsCreating(false)
    }
  }, [
    buyWithNative,
    callWithGasPrice,
    contract,
    factory,
    minLiquidity,
    parsedBuyAmount,
    quoteToken,
    refreshBots,
    router,
    slippage,
    stopLoss,
    takeProfit,
    t,
    toastError,
    toastSuccess,
    usdtToken.address,
  ])

  const handleBotAction = useCallback(
    async (bot: BotInfo, action: 'pauseBot' | 'resumeBot') => {
      if (!contract) return
      setActionBotId(bot.id.toString())
      try {
        const tx = await callWithGasPrice(contract, action, [bot.id])
        await tx.wait()
        await refreshBots()
        toastSuccess(t(action === 'pauseBot' ? 'Bot paused' : 'Bot resumed'))
      } catch {
        toastError(t('Error'), t('Unable to update bot.'))
      } finally {
        setActionBotId('')
      }
    },
    [callWithGasPrice, contract, refreshBots, t, toastError, toastSuccess],
  )

  const handleWithdrawNative = useCallback(
    async (bot: BotInfo, amount: BigNumber) => {
      if (!contract || amount.lte(0)) return
      setActionBotId(bot.id.toString())
      try {
        const tx = await callWithGasPrice(contract, 'withdrawNative', [bot.id, amount])
        await tx.wait()
        await refreshBots()
        toastSuccess(t('Withdraw successful'), <ToastDescriptionWithTx txHash={tx.hash}>{t('Native balance has been withdrawn.')}</ToastDescriptionWithTx>)
      } catch (error) {
        toastError(t('Error'), error instanceof Error ? error.message : t('Unable to withdraw native balance.'))
      } finally {
        setActionBotId('')
      }
    },
    [callWithGasPrice, contract, refreshBots, t, toastError, toastSuccess],
  )

  const handleWithdrawToken = useCallback(
    async (bot: BotInfo, payload: WithdrawTokenPayload) => {
      if (!contract || payload.amount.lte(0)) return
      setActionBotId(bot.id.toString())
      try {
        const tx = await callWithGasPrice(contract, 'withdrawToken', [bot.id, payload.token, payload.amount])
        await tx.wait()
        await refreshBots()
        toastSuccess(t('Withdraw successful'), <ToastDescriptionWithTx txHash={tx.hash}>{t('Token balance has been withdrawn.')}</ToastDescriptionWithTx>)
      } catch (error) {
        toastError(t('Error'), error instanceof Error ? error.message : t('Unable to withdraw token balance.'))
      } finally {
        setActionBotId('')
      }
    },
    [callWithGasPrice, contract, refreshBots, t, toastError, toastSuccess],
  )

  const handleToggleBot = useCallback((botId: string) => {
    setExpandedBotId((currentBotId) => (currentBotId === botId ? '' : botId))
  }, [])

  return (
    <Page>
      <Box maxWidth="760px" mx="auto" width="100%">
        <NewPairSniperTabs activeView={activeView} />
        <Card>
          <CardBody>
            <Heading scale="lg" mb="8px">
              {t('DEX New Pair Sniper')}
            </Heading>
            <Text color="textSubtle" mb="24px">
              {t('Scan factory PairCreated events, buy the first matching new pair, then sell once take profit or stop loss is triggered.')}
            </Text>

            {!hasAddress ? (
              <Message variant="warning" mb="24px">
                <MessageText>{t('DEX New Pair Sniper contract address is not configured yet.')}</MessageText>
              </Message>
            ) : null}

            {activeView === 'create' ? (
              <>
                <Flex flexDirection={['column', null, 'row']} style={{ gap: '16px' }} mb="16px">
                  <Box width="100%">
                    <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
                      {t('Router Address')}
                    </Text>
                    <Input value={router} onChange={(event) => setRouter(event.target.value)} placeholder="0x..." />
                  </Box>
                  <Box width="100%">
                    <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
                      {t('Factory Address')}
                    </Text>
                    <Input value={factory} onChange={(event) => setFactory(event.target.value)} placeholder="0x..." />
                  </Box>
                </Flex>

                <Flex flexDirection={['column', null, 'row']} style={{ gap: '16px' }} mb="16px">
                  <Box width="100%">
                    <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
                      {t('Buy With')}
                    </Text>
                    <select value={buyTokenMode} onChange={(event) => setBuyTokenMode(event.target.value)} style={{ width: '100%', height: 48 }}>
                      <option value={NATIVE_BUY_TOKEN}>POL</option>
                      <option value="usdt">USDT</option>
                    </select>
                  </Box>
                  <Box width="100%">
                    <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
                      {t('Buy Amount')}
                    </Text>
                    <Input value={buyAmount} onChange={(event) => setBuyAmount(event.target.value)} placeholder="0.0" />
                  </Box>
                </Flex>

                <Flex flexDirection={['column', null, 'row']} style={{ gap: '16px' }} mb="16px">
                  <Box width="100%">
                    <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
                      {t('Take Profit %')}
                    </Text>
                    <Input value={takeProfit} onChange={(event) => setTakeProfit(event.target.value)} />
                  </Box>
                  <Box width="100%">
                    <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
                      {t('Stop Loss %')}
                    </Text>
                    <Input value={stopLoss} onChange={(event) => setStopLoss(event.target.value)} />
                  </Box>
                </Flex>

                <Flex flexDirection={['column', null, 'row']} style={{ gap: '16px' }} mb="24px">
                  <Box width="100%">
                    <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
                      {t('Slippage %')}
                    </Text>
                    <Input value={slippage} onChange={(event) => setSlippage(event.target.value)} />
                  </Box>
                  <Box width="100%">
                    <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
                      {t('Min Liquidity USD')}
                    </Text>
                    <Input value={minLiquidity} onChange={(event) => setMinLiquidity(event.target.value)} />
                  </Box>
                </Flex>

                <Flex justifyContent="space-between" mb="16px">
                  <Text color="textSubtle">{t('Start Bot Fee')}</Text>
                  <Text bold>{t('1 PLAX')}</Text>
                </Flex>

                {!account ? (
                  <ConnectWalletButton width="100%" />
                ) : !isApprovedFee ? (
                  <Button width="100%" onClick={handleApproveFee} disabled={isApprovingFee || !hasAddress}>
                    {isApprovingFee ? <AutoRenewIcon spin color="currentColor" mr="8px" /> : null}
                    {t('Enable PLAX')}
                  </Button>
                ) : !isApprovedBuyToken ? (
                  <Button width="100%" onClick={handleApproveBuyToken} disabled={isApprovingBuyToken || !hasAddress}>
                    {isApprovingBuyToken ? <AutoRenewIcon spin color="currentColor" mr="8px" /> : null}
                    {t('Enable USDT')}
                  </Button>
                ) : (
                  <Button width="100%" onClick={handleCreateBot} disabled={!canCreate || isCreating}>
                    {isCreating ? <AutoRenewIcon spin color="currentColor" mr="8px" /> : null}
                    {isWrongNetwork ? t('Switch to Polygon') : t('Pay 1 PLAX & Start Scanner Bot')}
                  </Button>
                )}
              </>
            ) : (
              <Box>
                {!account ? (
                  <ConnectWalletButton width="100%" />
                ) : bots?.length ? (
                  <>
                    <Flex mb="16px" style={{ gap: '8px', flexWrap: 'wrap' }}>
                      <Button scale="sm" variant={botFilter === 'active' ? 'primary' : 'secondary'} onClick={() => setBotFilter('active')}>
                        {t('Active')} ({activeBots.length})
                      </Button>
                      <Button scale="sm" variant={botFilter === 'inactive' ? 'primary' : 'secondary'} onClick={() => setBotFilter('inactive')}>
                        {t('Inactive')} ({inactiveBots.length})
                      </Button>
                    </Flex>
                    {filteredBots.length ? (
                      <Flex flexDirection="column" style={{ gap: '12px' }}>
                        {filteredBots.map((bot) => (
                          <BotRow
                            key={bot.id.toString()}
                            bot={bot}
                            contract={contract}
                            actionBotId={actionBotId}
                            isExpanded={expandedBotId === bot.id.toString()}
                            onToggle={handleToggleBot}
                            onPause={(currentBot) => handleBotAction(currentBot, 'pauseBot')}
                            onResume={(currentBot) => handleBotAction(currentBot, 'resumeBot')}
                            onWithdrawNative={handleWithdrawNative}
                            onWithdrawToken={handleWithdrawToken}
                          />
                        ))}
                      </Flex>
                    ) : (
                      <Text color="textSubtle">{botFilter === 'active' ? t('No active bots found.') : t('No inactive bots found.')}</Text>
                    )}
                  </>
                ) : (
                  <Text color="textSubtle">{t('No bots found.')}</Text>
                )}
              </Box>
            )}
          </CardBody>
        </Card>
      </Box>
    </Page>
  )
}

export default NewPairSniper
