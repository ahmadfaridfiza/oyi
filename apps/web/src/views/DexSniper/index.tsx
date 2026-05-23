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
import { useDexSniperContract, useTokenContract } from 'hooks/useContract'
import useSWR from 'swr'
import { isAddress } from 'utils'
import { getDexSniperAddress } from 'utils/addressHelpers'
import { useAccount } from 'wagmi'
import Page from 'views/Page'

type DexSniperView = 'create' | 'my-bots'
type BotFilter = 'active' | 'inactive'
type DexPresetId = 'plaxswap' | 'quickswap' | 'sushiswap' | 'uniswap' | 'custom'

type BotInfo = {
  id: BigNumber
  owner: string
  router: string
  factory: string
  targetToken: string
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
  boughtAt: BigNumber
  soldAt: BigNumber
  cycleCount: BigNumber
}

type BotHistoryEntry = {
  type: string
  label: string
  txHash?: string
  blockNumber: number
  logIndex: number
  timestamp?: number
  amount?: string
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
const DEFAULT_SLIPPAGE = '20'
const DEFAULT_MIN_LIQUIDITY = '100'
const CUSTOM_DEX_PRESET: DexPresetId = 'custom'
const DEX_PRESETS: Array<{ id: DexPresetId; label: string; router?: string; factory?: string }> = [
  {
    id: 'plaxswap',
    label: 'Plaxswap',
    router: '0x09bfaA0E9B73D4741AE3721b6F82409e79695eBF',
    factory: '0x709e3C6b22993189327a8CFebD572b6cc459fe40',
  },
  {
    id: 'quickswap',
    label: 'QuickSwap',
    router: '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff',
    factory: '0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32',
  },
  {
    id: 'sushiswap',
    label: 'SushiSwap',
    router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    factory: '0xc35DADB65012eC5796536bD9864eD8773aBc74C4',
  },
  {
    id: 'uniswap',
    label: 'UniSwap',
    router: '0xedf6066a2b290C185783862C7F4776A2C8077AD1',
    factory: '0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C',
  },
  {
    id: CUSTOM_DEX_PRESET,
    label: 'Custom DEX',
  },
]
const ERC20_METADATA_ABI = ['function name() view returns (string)', 'function symbol() view returns (string)', 'function decimals() view returns (uint8)']

const toBps = (value: string) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.round(parsed * 100)
}

const isInactiveBot = (bot: BotInfo) =>
  bot.status === 2 && bot.remainingBuyAmount.eq(0) && bot.acquiredAmount.eq(0) && bot.proceedsAmount.eq(0)

const statusLabel = (bot: BotInfo) => {
  if (isInactiveBot(bot)) return 'Inactive'
  const { status } = bot
  if (status === 1) return 'Active'
  if (status === 2) return 'Paused'
  if (status === 3) return 'Bought'
  if (status === 4) return 'Inactive'
  return 'Unknown'
}

const getHistoryFromBlock = () => Number(process.env.NEXT_PUBLIC_DEX_SNIPER_HISTORY_FROM_BLOCK ?? 0)

const formatHistoryDate = (timestamp?: number) => {
  if (!timestamp) return '-'
  return new Date(timestamp * 1000).toLocaleString()
}

const getExplorerTxUrl = (txHash: string) => `https://polygonscan.com/tx/${txHash}`

const getWithdrawTokenLabel = (
  token: string,
  buyToken: string,
  buySymbol: string,
  targetToken: string,
  targetSymbol: string,
  proceedsToken: string,
) => {
  const normalizedToken = token.toLowerCase()
  if (normalizedToken === targetToken.toLowerCase()) return targetSymbol
  if (normalizedToken === buyToken.toLowerCase()) return buySymbol
  if (proceedsToken !== ZERO_ADDRESS && normalizedToken === proceedsToken.toLowerCase()) return buySymbol
  return 'TOKEN'
}

const DexSniperTabs: React.FC<{ activeView: DexSniperView }> = ({ activeView }) => {
  const { t } = useTranslation()
  const links = [
    { href: '/dex-sniper', label: t('Create Target Bot'), view: 'create' },
    { href: '/dex-sniper/my-bots', label: t('My Target Bots'), view: 'my-bots' },
  ]

  return (
    <Flex mb="24px" style={{ gap: '8px', flexWrap: 'wrap' }}>
      {links.map((link) => (
        <Button
          key={link.href}
          as="a"
          href={link.href}
          scale="sm"
          variant={activeView === link.view ? 'primary' : 'secondary'}
        >
          {link.label}
        </Button>
      ))}
    </Flex>
  )
}

const BotRow: React.FC<{
  bot: BotInfo
  dexSniperContract: Contract
  actionBotId: string
  onPause: (bot: BotInfo) => void
  onResume: (bot: BotInfo) => void
  onWithdrawNative: (bot: BotInfo, amount: BigNumber) => void
  onWithdrawToken: (bot: BotInfo, payload: WithdrawTokenPayload) => void
  isExpanded: boolean
  onToggle: (botId: string) => void
}> = ({ bot, dexSniperContract, actionBotId, onPause, onResume, onWithdrawNative, onWithdrawToken, isExpanded, onToggle }) => {
  const { t } = useTranslation()
  const buyDecimals = bot.buyWithNative ? 18 : bot.buyToken.toLowerCase() === bscTokens.usdt.address.toLowerCase() ? 6 : 18
  const buySymbol = bot.buyWithNative ? 'POL' : bot.buyToken.toLowerCase() === bscTokens.usdt.address.toLowerCase() ? 'USDT' : 'TOKEN'
  const isActionLoading = actionBotId === bot.id.toString()
  const { data: targetMetadata } = useSWR(
    dexSniperContract ? ['dexSniperTargetMetadata', dexSniperContract.address, bot.targetToken] : null,
    async () => {
      const tokenContract = new EthersContract(bot.targetToken, ERC20_METADATA_ABI, dexSniperContract.provider)
      const [name, symbol, decimals] = await Promise.all([
        tokenContract.name().catch(() => ''),
        tokenContract.symbol().catch(() => 'TOKEN'),
        tokenContract.decimals().catch(() => 18),
      ])

      return {
        name,
        symbol,
        decimals: Number(decimals),
      } as TokenMetadata
    },
  )
  const targetName = targetMetadata?.name || t('Unknown Token')
  const targetSymbol = targetMetadata?.symbol || t('Token')
  const targetDecimals = targetMetadata?.decimals ?? 18
  const isInactive = isInactiveBot(bot)
  const canWithdraw = bot.status === 2
  const nativeWithdrawAmount = bot.buyWithNative ? bot.remainingBuyAmount : BigNumber.from(0)
  const tokenWithdraws = [
    !bot.buyWithNative && bot.remainingBuyAmount.gt(0)
      ? {
          token: bot.buyToken,
          amount: bot.remainingBuyAmount,
          label: buySymbol,
          decimals: buyDecimals,
        }
      : null,
    bot.acquiredAmount.gt(0)
      ? {
          token: bot.targetToken,
          amount: bot.acquiredAmount,
          label: targetSymbol,
          decimals: targetDecimals,
        }
      : null,
  ].filter(Boolean) as Array<WithdrawTokenPayload & { label: string; decimals: number }>
  const { data: history, isLoading: isHistoryLoading } = useSWR(
    dexSniperContract && isExpanded
      ? [
          'dexSniperBotHistory',
          dexSniperContract.address,
          bot.id.toString(),
          bot.status,
          bot.acquiredAmount.toString(),
          bot.remainingBuyAmount.toString(),
          bot.proceedsAmount.toString(),
          bot.createdAt.toString(),
          bot.boughtAt.toString(),
          bot.soldAt.toString(),
          bot.cycleCount.toString(),
          targetSymbol,
          targetDecimals,
        ]
      : null,
    async () => {
      const fromBlock = getHistoryFromBlock()
      const filters = [
        { type: 'created', label: t('Created'), filter: dexSniperContract.filters.BotCreated(bot.id) },
        { type: 'bought', label: t('Bought'), filter: dexSniperContract.filters.BotBought(bot.id) },
        { type: 'sold', label: t('Sold / Cycle'), filter: dexSniperContract.filters.BotSold(bot.id) },
        { type: 'paused', label: t('Paused'), filter: dexSniperContract.filters.BotPaused(bot.id) },
        { type: 'resumed', label: t('Resumed'), filter: dexSniperContract.filters.BotResumed(bot.id) },
        { type: 'withdrawn', label: t('Withdrawn'), filter: dexSniperContract.filters.BotWithdrawn(bot.id) },
      ]
      const logs = (
        await Promise.all(
          filters.map(async ({ type, label, filter }) => {
            const events = await dexSniperContract.queryFilter(filter, fromBlock).catch((error) => {
              console.info('[DexSniper] Failed to load bot history event', {
                botId: bot.id.toString(),
                type,
                fromBlock,
                error,
              })
              return []
            })
            return events.map((event) => {
              const amount =
                type === 'bought'
                  ? `${formatUnits(event.args?.spentAmount ?? 0, buyDecimals)} ${buySymbol} -> ${formatUnits(
                      event.args?.acquiredAmount ?? 0,
                      targetDecimals,
                    )} ${targetSymbol}`
                  : type === 'sold'
                  ? `${formatUnits(event.args?.soldAmount ?? 0, targetDecimals)} ${targetSymbol}`
                  : type === 'withdrawn'
                  ? `${formatUnits(
                      event.args?.amount ?? 0,
                      event.args?.token?.toLowerCase() === bot.targetToken.toLowerCase() ? targetDecimals : buyDecimals,
                    )} ${
                      event.args?.token === ZERO_ADDRESS
                        ? 'POL'
                        : getWithdrawTokenLabel(
                            event.args?.token ?? ZERO_ADDRESS,
                            bot.buyToken,
                            buySymbol,
                            bot.targetToken,
                            targetSymbol,
                            bot.proceedsToken,
                          )
                    }`
                  : undefined

              return {
                type,
                label,
                txHash: event.transactionHash,
                blockNumber: event.blockNumber,
                logIndex: event.logIndex,
                amount,
              }
            })
          }),
        )
      )
        .flat()
        .sort((a, b) => (b.blockNumber === a.blockNumber ? b.logIndex - a.logIndex : b.blockNumber - a.blockNumber))

      const blockNumbers = Array.from(new Set(logs.map((event) => event.blockNumber)))
      const blocks = await Promise.all(blockNumbers.map((blockNumber) => dexSniperContract.provider.getBlock(blockNumber)))
      const timestampByBlock = blocks.reduce<Record<number, number>>(
        (timestamps, block) => ({
          ...timestamps,
          [block.number]: block.timestamp,
        }),
        {},
      )

      const eventHistory = logs.map((event) => ({ ...event, timestamp: timestampByBlock[event.blockNumber] })) as BotHistoryEntry[]
      const hasEventType = (type: string) => eventHistory.some((event) => event.type === type)
      const fallbackHistory: BotHistoryEntry[] = []

      if (!hasEventType('created') && bot.createdAt.gt(0)) {
        fallbackHistory.push({
          type: 'created',
          label: t('Created'),
          blockNumber: 0,
          logIndex: 0,
          timestamp: bot.createdAt.toNumber(),
        })
      }

      if (!hasEventType('bought') && bot.boughtAt.gt(0)) {
        const spentAmount = bot.buyAmount.sub(bot.remainingBuyAmount)
        const acquiredText = bot.acquiredAmount.gt(0) ? ` -> ${formatUnits(bot.acquiredAmount, targetDecimals)} ${targetSymbol}` : ''

        fallbackHistory.push({
          type: 'bought',
          label: t('Bought'),
          blockNumber: 0,
          logIndex: 1,
          timestamp: bot.boughtAt.toNumber(),
          amount: `${formatUnits(spentAmount, buyDecimals)} ${buySymbol}${acquiredText}`,
        })
      }

      if (!hasEventType('sold') && bot.soldAt.gt(0)) {
        fallbackHistory.push({
          type: 'sold',
          label: t('Sold / Cycle'),
          blockNumber: 0,
          logIndex: 2,
          timestamp: bot.soldAt.toNumber(),
          amount: `${formatUnits(bot.buyAmount, buyDecimals)} ${buySymbol} ${t('ready for next buy')}`,
        })
      }

      return [...eventHistory, ...fallbackHistory].sort((a, b) => {
        const timestampDiff = (b.timestamp ?? 0) - (a.timestamp ?? 0)
        if (timestampDiff !== 0) return timestampDiff
        return b.logIndex - a.logIndex
      }) as BotHistoryEntry[]
    },
    { refreshInterval: 10000 },
  )

  return (
    <Box p="16px" border="1px solid" borderColor="cardBorder" borderRadius="8px">
      <Flex justifyContent="space-between" alignItems="flex-start" mb={isExpanded ? '12px' : '0'} style={{ gap: '12px' }}>
        <Box>
          <Text bold>{t('Bot #%id%', { id: bot.id.toString() })}</Text>
          <Text fontSize="13px">
            {targetSymbol} - {targetName} ({targetDecimals} {t('decimals')})
          </Text>
          <Text color="textSubtle" fontSize="12px" ellipsis maxWidth="280px">
            {bot.targetToken}
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
                {t('Current Capital')}
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
            <Box width="100%">
              <Text color="textSubtle" fontSize="12px">
                {t('Cycles')}
              </Text>
              <Text>{bot.cycleCount.toString()}</Text>
            </Box>
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
              <Button
                scale="sm"
                variant="secondary"
                disabled={isActionLoading}
                onClick={() => onWithdrawNative(bot, nativeWithdrawAmount)}
              >
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
                {t('Withdraw %amount% %symbol%', {
                  amount: formatUnits(withdraw.amount, withdraw.decimals),
                  symbol: withdraw.label,
                })}
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

      {isExpanded ? (
        <Box mt="16px">
          <Text bold mb="8px">
            {t('Bot History')}
          </Text>
          {isHistoryLoading ? (
            <Text color="textSubtle" fontSize="12px">
              {t('Loading history...')}
            </Text>
          ) : history?.length ? (
            <Flex flexDirection="column" style={{ gap: '8px' }}>
              {history.map((event) => (
                <Box
                  key={`${event.txHash ?? event.type}-${event.timestamp ?? event.blockNumber}-${event.logIndex}`}
                  p="10px"
                  border="1px solid"
                  borderColor="cardBorder"
                  borderRadius="8px"
                >
                  <Flex justifyContent="space-between" alignItems="center" style={{ gap: '8px' }}>
                    <Box>
                      <Text bold fontSize="13px">
                        {event.label}
                      </Text>
                      <Text color="textSubtle" fontSize="12px">
                        {formatHistoryDate(event.timestamp)}
                      </Text>
                      {event.amount ? (
                        <Text color="textSubtle" fontSize="12px">
                          {event.amount}
                        </Text>
                      ) : null}
                    </Box>
                    {event.txHash ? (
                      <Text as="a" href={getExplorerTxUrl(event.txHash)} target="_blank" rel="noreferrer" color="primary" fontSize="12px">
                        {t('View Tx')}
                      </Text>
                    ) : null}
                  </Flex>
                </Box>
              ))}
            </Flex>
          ) : (
            <Text color="textSubtle" fontSize="12px">
              {t('No history for this bot yet.')}
            </Text>
          )}
        </Box>
      ) : null}
    </Box>
  )
}

const DexSniper: React.FC<{ activeView?: DexSniperView }> = ({ activeView = 'create' }) => {
  const { t } = useTranslation()
  const { address: account } = useAccount()
  const { chainId } = useActiveChainId()
  const { callWithGasPrice } = useCallWithGasPrice()
  const { toastError, toastSuccess } = useToast()

  const dexSniperAddress = useMemo(() => getDexSniperAddress(chainId), [chainId])
  const hasDexSniperAddress = Boolean(dexSniperAddress)
  const dexSniperContract = useDexSniperContract()
  const plaxToken = bscTokens.cake
  const usdtToken = bscTokens.usdt
  const plaxContract = useTokenContract(plaxToken.address)
  const usdtContract = useTokenContract(usdtToken.address)

  const [dexPreset, setDexPreset] = useState<DexPresetId>('plaxswap')
  const [router, setRouter] = useState('')
  const [factory, setFactory] = useState('')
  const [targetToken, setTargetToken] = useState('')
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
  const buyTokenContract = buyWithNative ? null : usdtContract
  const buyDecimals = buyWithNative ? 18 : usdtToken.decimals
  const selectedDexPreset = useMemo(() => DEX_PRESETS.find((preset) => preset.id === dexPreset), [dexPreset])
  const isCustomDex = dexPreset === CUSTOM_DEX_PRESET
  const routerAddress = selectedDexPreset?.router ?? router
  const factoryAddress = selectedDexPreset?.factory ?? factory

  const { data: feeAllowance, mutate: refreshFeeAllowance } = useSWR(
    account && dexSniperAddress && plaxContract ? ['dexSniperFeeAllowance', account, dexSniperAddress] : null,
    () => plaxContract.allowance(account, dexSniperAddress),
  )
  const parsedBuyAmount = useMemo(() => {
    try {
      return buyAmount ? parseUnits(buyAmount, buyDecimals) : null
    } catch {
      return null
    }
  }, [buyAmount, buyDecimals])
  const { data: buyTokenAllowance, mutate: refreshBuyTokenAllowance } = useSWR(
    account && dexSniperAddress && buyTokenContract && parsedBuyAmount
      ? ['dexSniperBuyAllowance', account, dexSniperAddress, buyTokenMode]
      : null,
    () => buyTokenContract.allowance(account, dexSniperAddress),
  )
  const { data: bots, mutate: refreshBots } = useSWR(
    activeView === 'my-bots' && account && dexSniperContract ? ['dexSniperBots', account] : null,
    () => dexSniperContract.getBotsByOwner(account, 0, 50) as Promise<BotInfo[]>,
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
    hasDexSniperAddress &&
    !isWrongNetwork &&
    isAddress(routerAddress) &&
    isAddress(factoryAddress) &&
    isAddress(targetToken) &&
    parsedBuyAmount?.gt(0) &&
    toBps(takeProfit) &&
    toBps(stopLoss) !== null &&
    toBps(slippage) !== null

  const handleApproveFee = useCallback(async () => {
    if (!plaxContract || !dexSniperAddress) return
    setIsApprovingFee(true)
    try {
      const tx = await callWithGasPrice(plaxContract, 'approve', [dexSniperAddress, MaxUint256])
      await tx.wait()
      await refreshFeeAllowance()
      toastSuccess(t('PLAX enabled'), <ToastDescriptionWithTx txHash={tx.hash}>{t('You can start a sniper bot now.')}</ToastDescriptionWithTx>)
    } catch {
      toastError(t('Error'), t('Unable to approve PLAX. Please try again.'))
    } finally {
      setIsApprovingFee(false)
    }
  }, [callWithGasPrice, dexSniperAddress, plaxContract, refreshFeeAllowance, t, toastError, toastSuccess])

  const handleApproveBuyToken = useCallback(async () => {
    if (!buyTokenContract || !dexSniperAddress) return
    setIsApprovingBuyToken(true)
    try {
      const tx = await callWithGasPrice(buyTokenContract, 'approve', [dexSniperAddress, MaxUint256])
      await tx.wait()
      await refreshBuyTokenAllowance()
      toastSuccess(t('USDT enabled'), <ToastDescriptionWithTx txHash={tx.hash}>{t('USDT can be used by your bot.')}</ToastDescriptionWithTx>)
    } catch {
      toastError(t('Error'), t('Unable to approve USDT. Please try again.'))
    } finally {
      setIsApprovingBuyToken(false)
    }
  }, [buyTokenContract, callWithGasPrice, dexSniperAddress, refreshBuyTokenAllowance, t, toastError, toastSuccess])

  const handleCreateBot = useCallback(async () => {
    if (!dexSniperContract || !parsedBuyAmount) return
    const stopLossBps = toBps(stopLoss)
    const takeProfitBps = toBps(takeProfit)
    const slippageBps = toBps(slippage)
    if (stopLossBps === null || takeProfitBps === null || slippageBps === null) return

    setIsCreating(true)
    try {
      const tx = await callWithGasPrice(
        dexSniperContract,
        'createBot',
        [
          routerAddress,
          factoryAddress,
          targetToken,
          buyWithNative ? '0x0000000000000000000000000000000000000000' : usdtToken.address,
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
      toastSuccess(t('Bot started'), <ToastDescriptionWithTx txHash={tx.hash}>{t('Your sniper bot is active.')}</ToastDescriptionWithTx>)
      await refreshBots()
    } catch (error) {
      toastError(t('Error'), error instanceof Error ? error.message : t('Unable to create bot.'))
    } finally {
      setIsCreating(false)
    }
  }, [
    buyWithNative,
    callWithGasPrice,
    dexSniperContract,
    factoryAddress,
    minLiquidity,
    parsedBuyAmount,
    refreshBots,
    routerAddress,
    slippage,
    stopLoss,
    takeProfit,
    targetToken,
    t,
    toastError,
    toastSuccess,
    usdtToken.address,
  ])

  const handleBotAction = useCallback(
    async (bot: BotInfo, action: 'pauseBot' | 'resumeBot') => {
      if (!dexSniperContract) return
      setActionBotId(bot.id.toString())
      try {
        const tx = await callWithGasPrice(dexSniperContract, action, [bot.id])
        await tx.wait()
        await refreshBots()
        toastSuccess(t(action === 'pauseBot' ? 'Bot paused' : 'Bot resumed'))
      } catch {
        toastError(t('Error'), t('Unable to update bot.'))
      } finally {
        setActionBotId('')
      }
    },
    [callWithGasPrice, dexSniperContract, refreshBots, t, toastError, toastSuccess],
  )

  const handleWithdrawNative = useCallback(
    async (bot: BotInfo, amount: BigNumber) => {
      if (!dexSniperContract || amount.lte(0)) return
      setActionBotId(bot.id.toString())
      try {
        const tx = await callWithGasPrice(dexSniperContract, 'withdrawNative', [bot.id, amount])
        await tx.wait()
        await refreshBots()
        toastSuccess(t('Withdraw successful'), <ToastDescriptionWithTx txHash={tx.hash}>{t('Native balance has been withdrawn.')}</ToastDescriptionWithTx>)
      } catch (error) {
        toastError(t('Error'), error instanceof Error ? error.message : t('Unable to withdraw native balance.'))
      } finally {
        setActionBotId('')
      }
    },
    [callWithGasPrice, dexSniperContract, refreshBots, t, toastError, toastSuccess],
  )

  const handleWithdrawToken = useCallback(
    async (bot: BotInfo, payload: WithdrawTokenPayload) => {
      if (!dexSniperContract || payload.amount.lte(0)) return
      setActionBotId(bot.id.toString())
      try {
        const tx = await callWithGasPrice(dexSniperContract, 'withdrawToken', [bot.id, payload.token, payload.amount])
        await tx.wait()
        await refreshBots()
        toastSuccess(t('Withdraw successful'), <ToastDescriptionWithTx txHash={tx.hash}>{t('Token balance has been withdrawn.')}</ToastDescriptionWithTx>)
      } catch (error) {
        toastError(t('Error'), error instanceof Error ? error.message : t('Unable to withdraw token balance.'))
      } finally {
        setActionBotId('')
      }
    },
    [callWithGasPrice, dexSniperContract, refreshBots, t, toastError, toastSuccess],
  )

  const handleToggleBot = useCallback((botId: string) => {
    setExpandedBotId((currentBotId) => (currentBotId === botId ? '' : botId))
  }, [])

  return (
    <Page>
      <Box maxWidth="760px" mx="auto" width="100%">
        <DexSniperTabs activeView={activeView} />
        <Card>
          <CardBody>
            <Heading scale="lg" mb="8px">
              {t('DEX Target Sniper')}
            </Heading>
            <Text color="textSubtle" mb="24px">
              {t('Create a target-token sniper bot that cycles buy and sell using your configured take profit and stop loss.')}
            </Text>

            {!hasDexSniperAddress ? (
              <Message variant="warning" mb="24px">
                <MessageText>{t('DEX Target Sniper contract address is not configured yet.')}</MessageText>
              </Message>
            ) : null}

            {activeView === 'create' ? (
              <>
                <Box mb="16px">
                  <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
                    {t('DEX')}
                  </Text>
                  <select
                    value={dexPreset}
                    onChange={(event) => setDexPreset(event.target.value as DexPresetId)}
                    style={{ width: '100%', height: 48 }}
                  >
                    {DEX_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                  {!isCustomDex && selectedDexPreset ? (
                    <Flex mt="8px" flexDirection="column" style={{ gap: '4px' }}>
                      <Text color="textSubtle" fontSize="12px" ellipsis>
                        {t('Router')}: {selectedDexPreset.router}
                      </Text>
                      <Text color="textSubtle" fontSize="12px" ellipsis>
                        {t('Factory')}: {selectedDexPreset.factory}
                      </Text>
                    </Flex>
                  ) : null}
                </Box>

                {isCustomDex ? (
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
                ) : null}

                <Box mb="16px">
                    <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
                      {t('Target Token')}
                    </Text>
                  <Input value={targetToken} onChange={(event) => setTargetToken(event.target.value)} placeholder="0x..." />
                </Box>

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
                  <Button width="100%" onClick={handleApproveFee} disabled={isApprovingFee || !hasDexSniperAddress}>
                    {isApprovingFee ? <AutoRenewIcon spin color="currentColor" mr="8px" /> : null}
                    {t('Enable PLAX')}
                  </Button>
                ) : !isApprovedBuyToken ? (
                  <Button width="100%" onClick={handleApproveBuyToken} disabled={isApprovingBuyToken || !hasDexSniperAddress}>
                    {isApprovingBuyToken ? <AutoRenewIcon spin color="currentColor" mr="8px" /> : null}
                    {t('Enable USDT')}
                  </Button>
                ) : (
                  <Button width="100%" onClick={handleCreateBot} disabled={!canCreate || isCreating}>
                    {isCreating ? <AutoRenewIcon spin color="currentColor" mr="8px" /> : null}
                    {isWrongNetwork ? t('Switch to Polygon') : t('Pay 1 PLAX & Start Target Bot')}
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
                      <Button
                        scale="sm"
                        variant={botFilter === 'active' ? 'primary' : 'secondary'}
                        onClick={() => setBotFilter('active')}
                      >
                        {t('Active')} ({activeBots.length})
                      </Button>
                      <Button
                        scale="sm"
                        variant={botFilter === 'inactive' ? 'primary' : 'secondary'}
                        onClick={() => setBotFilter('inactive')}
                      >
                        {t('Inactive')} ({inactiveBots.length})
                      </Button>
                    </Flex>
                    {filteredBots.length ? (
                      <Flex flexDirection="column" style={{ gap: '12px' }}>
                        {filteredBots.map((bot) => (
                          <BotRow
                            key={bot.id.toString()}
                            bot={bot}
                            dexSniperContract={dexSniperContract}
                            actionBotId={actionBotId}
                            onPause={(currentBot) => handleBotAction(currentBot, 'pauseBot')}
                            onResume={(currentBot) => handleBotAction(currentBot, 'resumeBot')}
                            onWithdrawNative={handleWithdrawNative}
                            onWithdrawToken={handleWithdrawToken}
                            isExpanded={expandedBotId === bot.id.toString()}
                            onToggle={handleToggleBot}
                          />
                        ))}
                      </Flex>
                    ) : (
                      <Text color="textSubtle">
                        {botFilter === 'active' ? t('No active bots found.') : t('No inactive bots found.')}
                      </Text>
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

export default DexSniper
