import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BigNumber } from '@ethersproject/bignumber'
import { MaxUint256 } from '@ethersproject/constants'
import { formatUnits } from '@ethersproject/units'
import { useTranslation } from '@pancakeswap/localization'
import {
  AutoRenewIcon,
  Box,
  Button,
  Card,
  CardBody,
  Flex,
  Heading,
  Message,
  MessageText,
  Text,
  useToast,
} from '@pancakeswap/uikit'
import ConnectWalletButton from 'components/ConnectWalletButton'
import { ToastDescriptionWithTx } from 'components/Toast'
import { useActiveChainId } from 'hooks/useActiveChainId'
import { useCallWithGasPrice } from 'hooks/useCallWithGasPrice'
import { useGameShopContract, useTokenContract } from 'hooks/useContract'
import useSWR from 'swr'
import styled from 'styled-components'
import { getGameShopAddress } from 'utils/addressHelpers'
import { useAccount } from 'wagmi'
import Page from 'views/Page'

type TabView = 'farm' | 'shop-items' | 'shop-characters' | 'inventory'

type ShopAsset = {
  id: BigNumber
  name: string
  assetType: number
  pricePLAX: BigNumber
  imageURI: string
  active: boolean
}

type CropType = 'wheat' | 'carrot' | 'tomato' | 'pumpkin' | 'golden'
type PlotState = 'empty' | 'seed' | 'sprout' | 'growing' | 'ready' | 'withered'

type Plot = {
  state: PlotState
  crop?: CropType
  plantedAt?: number
  lastWateredAt?: number
}

type InventoryItem = {
  crop: CropType
  count: number
}

const GRID_SIZE = 6
const WATER_BOOST = 0.7

const CROP_CONFIG: Record<CropType, { name: string; emoji: string; growTime: number; pricePLAX: number; xp: number; stages: PlotState[] }> = {
  wheat: { name: 'Wheat', emoji: '🌾', growTime: 15, pricePLAX: 1, xp: 10, stages: ['seed', 'sprout', 'growing', 'ready'] },
  carrot: { name: 'Carrot', emoji: '🥕', growTime: 20, pricePLAX: 2, xp: 15, stages: ['seed', 'sprout', 'growing', 'ready'] },
  tomato: { name: 'Tomato', emoji: '🍅', growTime: 25, pricePLAX: 3, xp: 20, stages: ['seed', 'sprout', 'growing', 'ready'] },
  pumpkin: { name: 'Pumpkin', emoji: '🎃', growTime: 35, pricePLAX: 5, xp: 30, stages: ['seed', 'sprout', 'growing', 'ready'] },
  golden: { name: 'Golden Wheat', emoji: '🌾✨', growTime: 50, pricePLAX: 10, xp: 50, stages: ['seed', 'sprout', 'growing', 'ready'] },
}

const INITIAL_INVENTORY: InventoryItem[] = [
  { crop: 'wheat', count: 5 },
  { crop: 'carrot', count: 3 },
]

const STORAGE_KEY = 'plaxgame_farm'

const Container = styled(Box)`
  max-width: 1100px;
  margin: 0 auto;
`

const TabBar = styled(Flex)`
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 24px;
`

const FarmGrid = styled(Box)`
  display: grid;
  grid-template-columns: repeat(${GRID_SIZE}, 1fr);
  gap: 10px;
  max-width: 520px;
  margin: 0 auto;
`

const PlotBox = styled(Box)<{ $state: PlotState; $isClickable: boolean }>`
  aspect-ratio: 1;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  cursor: ${({ $isClickable }) => ($isClickable ? 'pointer' : 'default')};
  transition: all 0.2s;
  position: relative;
  border: 2px solid ${({ theme }) => theme.colors.cardBorder};
  background: ${({ $state, theme }) =>
    $state === 'empty' ? theme.colors.backgroundAlt
    : $state === 'ready' ? '#d4edda'
    : $state === 'withered' ? '#f8d7da'
    : '#fff3cd'};

  &:hover {
    transform: ${({ $isClickable }) => ($isClickable ? 'scale(1.05)' : 'none')};
    box-shadow: ${({ $isClickable }) => ($isClickable ? '0 4px 12px rgba(0,0,0,0.15)' : 'none')};
  }
`

const PlotEmoji = styled(Box)`
  font-size: 36px;
  line-height: 1;
`

const WaterBadge = styled(Box)`
  position: absolute;
  top: 2px;
  right: 2px;
  font-size: 12px;
`

const ProgressBar = styled(Box)`
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: ${({ theme }) => theme.colors.cardBorder};
  border-radius: 0 0 12px 12px;
  overflow: hidden;
`

const ProgressFill = styled(Box)<{ $pct: number }>`
  width: ${({ $pct }) => Math.min($pct, 100)}%;
  height: 100%;
  background: ${({ $pct }) => ($pct >= 100 ? '#28a745' : '#ffc107')};
  transition: width 1s linear;
`

const ShopGrid = styled(Box)`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
`

const AssetCard = styled(Card)`
  overflow: hidden;
`

const AssetCardTop = styled(Box)`
  padding: 20px;
  text-align: center;
  font-size: 48px;
  background: ${({ theme }) => theme.colors.backgroundAlt};
`

const WaterIcon = () => (
  <span style={{ fontSize: 16 }}>💧</span>
)

const getPlotEmoji = (state: PlotState, crop?: CropType): string => {
  if (state === 'empty') return '🟫'
  if (state === 'ready' && crop) return CROP_CONFIG[crop].emoji
  if (state === 'withered') return '💀'
  if (state === 'seed') return '🌱'
  if (state === 'sprout') return '🌿'
  return '🌱'
}

const calculateStage = (crop: CropType, plantedAt: number, lastWateredAt: number | undefined): { stage: PlotState; progress: number } => {
  const now = Date.now()
  const elapsed = (now - plantedAt) / 1000
  const boost = lastWateredAt ? WATER_BOOST : 1
  const adjustedElapsed = elapsed / boost
  const { growTime: totalGrow, stages } = CROP_CONFIG[crop]
  const progress = Math.min(adjustedElapsed / totalGrow, 1)

  if (progress >= 1) return { stage: 'ready', progress: 1 }

  const perStage = 1 / (stages.length - 1)
  const stageIndex = Math.min(Math.floor(progress / perStage), stages.length - 2)
  const stageProgress = (progress - stageIndex * perStage) / perStage

  return { stage: stages[stageIndex] as PlotState, progress: stageProgress }
}

const loadFarm = (): Plot[][] => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return JSON.parse(saved)
  } catch { /* ignore */ }
  return Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => ({ state: 'empty' as PlotState }))
  )
}

const saveFarm = (grid: Plot[][]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(grid))
}

const loadInventory = (): InventoryItem[] => {
  try {
    const saved = localStorage.getItem(`${STORAGE_KEY}_inv`)
    if (saved) return JSON.parse(saved)
  } catch { /* ignore */ }
  return INITIAL_INVENTORY.map((i) => ({ ...i }))
}

const saveInventory = (inv: InventoryItem[]) => {
  localStorage.setItem(`${STORAGE_KEY}_inv`, JSON.stringify(inv))
}

const loadXp = (): number => {
  try {
    return Number(localStorage.getItem(`${STORAGE_KEY}_xp`)) || 0
  } catch { return 0 }
}

const saveXp = (xp: number) => {
  localStorage.setItem(`${STORAGE_KEY}_xp`, String(xp))
}

const getLevel = (xp: number) => Math.floor(Math.sqrt(xp / 10)) + 1
const getXpForNextLevel = (level: number) => level * level * 10

const Game: React.FC = () => {
  const { t } = useTranslation()
  const { address: account } = useAccount()
  const { chainId } = useActiveChainId()
  const { callWithGasPrice } = useCallWithGasPrice()
  const { toastError, toastSuccess } = useToast()
  const gameShopContract = useGameShopContract()
  const gameShopAddress = useMemo(() => getGameShopAddress(chainId), [chainId])
  const hasAddress = Boolean(gameShopAddress)
  const [activeTab, setActiveTab] = useState<TabView>('farm')
  const [grid, setGrid] = useState<Plot[][]>(loadFarm)
  const [inventory, setInventory] = useState<InventoryItem[]>(loadInventory)
  const [xp, setXp] = useState(loadXp)
  const [selectedCrop, setSelectedCrop] = useState<CropType | null>(null)
  const [buyAssetIds, setBuyAssetIds] = useState<Set<string>>(new Set())
  const timerRef = useRef<NodeJS.Timeout>()

  const { data: plaxAddr } = useSWR(
    gameShopContract ? ['gamePlaxAddr'] : null,
    () => gameShopContract.plaxToken(),
  )
  const plaxContract = useTokenContract(plaxAddr)
  const { data: plaxBalance, mutate: refreshBalance } = useSWR(
    account && plaxContract ? ['gamePlaxBalance', account] : null,
    () => plaxContract.balanceOf(account),
    { refreshInterval: 10000 },
  )

  const { data: assets, mutate: refreshAssets } = useSWR(
    gameShopContract && hasAddress ? ['gameShopAssets'] : null,
    () => gameShopContract.getAllAssets() as Promise<ShopAsset[]>,
    { refreshInterval: 30000 },
  )

  const { data: userAssetIds, mutate: refreshUserAssets } = useSWR(
    gameShopContract && hasAddress && account ? ['gameUserAssets', account] : null,
    () => gameShopContract.getUserAssetIds(account) as Promise<BigNumber[]>,
    { refreshInterval: 15000 },
  )

  const ownedAssetSet = useMemo(() => {
    const s = new Set<string>()
    if (userAssetIds) {
      userAssetIds.forEach((id: BigNumber) => s.add(id.toString()))
    }
    return s
  }, [userAssetIds])

  const ownedCharacters = useMemo(() => {
    if (!assets || !userAssetIds) return []
    const ids = new Set(userAssetIds.map((id: BigNumber) => id.toString()))
    return assets.filter((a: ShopAsset) => a.assetType === 1 && ids.has(a.id.toString()))
  }, [assets, userAssetIds])

  const xpRef = useRef(xp)
  xpRef.current = xp

  useEffect(() => {
    const interval = setInterval(() => {
      setGrid((prev) => {
        let changed = false
        const next = prev.map((row) =>
          row.map((plot) => {
            if (plot.state === 'empty' || plot.state === 'ready' || plot.state === 'withered' || !plot.crop || !plot.plantedAt) return plot
            const { stage, progress } = calculateStage(plot.crop, plot.plantedAt, plot.lastWateredAt)
            if (stage !== plot.state || progress >= 1) {
              changed = true
              if (stage === 'ready') return { ...plot, state: 'ready' as PlotState }
              return { ...plot, state: stage }
            }
            return plot
          })
        )
        if (changed) saveFarm(next)
        return next
      })
    }, 1000)
    timerRef.current = interval
    return () => clearInterval(interval)
  }, [])

  useEffect(() => { saveFarm(grid) }, [grid])
  useEffect(() => { saveInventory(inventory) }, [inventory])
  useEffect(() => { saveXp(xp) }, [xp])

  const addXp = useCallback((amount: number) => {
    setXp((prev) => prev + amount)
  }, [])

  const level = getLevel(xp)
  const nextLevelXp = getXpForNextLevel(level)
  const currentLevelXp = getXpForNextLevel(level - 1)
  const levelProgress = nextLevelXp > currentLevelXp ? (xp - currentLevelXp) / (nextLevelXp - currentLevelXp) : 0

  const getCropCount = useCallback((crop: CropType) => {
    return inventory.find((i) => i.crop === crop)?.count ?? 0
  }, [inventory])

  const consumeSeed = useCallback((crop: CropType) => {
    setInventory((prev) => prev.map((i) => i.crop === crop ? { ...i, count: i.count - 1 } : i).filter((i) => i.count > 0))
  }, [])

  const handlePlotClick = useCallback((row: number, col: number) => {
    const plot = grid[row][col]

    if (plot.state === 'ready') {
      setGrid((prev) => {
        const next = prev.map((r) => r.map((p) => ({ ...p })))
        next[row][col] = { state: 'empty' }
        saveFarm(next)
        return next
      })
      addXp(plot.crop ? CROP_CONFIG[plot.crop].xp : 5)
      toastSuccess(t('Harvested!'), t('You harvested crops and gained XP!'))
      return
    }

    if (plot.state === 'empty' && selectedCrop) {
      const count = getCropCount(selectedCrop)
      if (count <= 0) {
        toastError(t('No Seeds'), t('You have no %crop% seeds!', { crop: CROP_CONFIG[selectedCrop].name }))
        return
      }
      consumeSeed(selectedCrop)
      const now = Date.now()
      setGrid((prev) => {
        const next = prev.map((r) => r.map((p) => ({ ...p })))
        next[row][col] = { state: 'seed', crop: selectedCrop, plantedAt: now, lastWateredAt: now }
        saveFarm(next)
        return next
      })
      setSelectedCrop(null)
      toastSuccess(t('Planted!'), t('%crop% seeds planted!', { crop: CROP_CONFIG[selectedCrop].name }))
      return
    }

    if (plot.state === 'seed' || plot.state === 'sprout' || plot.state === 'growing') {
      setGrid((prev) => {
        const next = prev.map((r) => r.map((p) => ({ ...p })))
        next[row][col] = { ...next[row][col], lastWateredAt: Date.now() }
        saveFarm(next)
        return next
      })
      toastSuccess(t('Watered!'), t('Crops grow faster when watered!'))
    }
  }, [grid, selectedCrop, getCropCount, consumeSeed, addXp, t, toastSuccess, toastError])

  const handleBuyAsset = useCallback(async (asset: ShopAsset) => {
    if (!gameShopContract || !plaxContract || !gameShopAddress || !account) return

    const assetId = asset.id.toString()
    setBuyAssetIds((prev) => new Set(prev).add(assetId))

    try {
      const allowance = await plaxContract.allowance(account, gameShopAddress)
      if (BigNumber.from(allowance).lt(asset.pricePLAX)) {
        const tx = await callWithGasPrice(plaxContract, 'approve', [gameShopAddress, MaxUint256])
        await tx.wait()
        toastSuccess(t('PLAX Enabled'), t('PLAX spending approved!'))
      }

      const tx = await callWithGasPrice(gameShopContract, 'buyAsset', [asset.id])
      const receipt = await tx.wait()
      toastSuccess(t('Purchased!'), <ToastDescriptionWithTx txHash={receipt.transactionHash} />)
      refreshBalance()
      refreshUserAssets()
      refreshAssets()
    } catch (error) {
      console.error(error)
      toastError(t('Error'), t('Unable to complete purchase.'))
    } finally {
      setBuyAssetIds((prev) => {
        const next = new Set(prev)
        next.delete(assetId)
        return next
      })
    }
  }, [account, callWithGasPrice, gameShopAddress, gameShopContract, plaxContract, refreshAssets, refreshBalance, refreshUserAssets, t, toastError, toastSuccess])

  const plaxFormatted = plaxBalance ? Number(formatUnits(plaxBalance, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 }) : '0'

  return (
    <Page>
      <Container>
        <Flex alignItems="center" justifyContent="space-between" mb="16px" flexWrap="wrap" style={{ gap: '12px' }}>
          <Box>
            <Heading scale="lg">{t('Plax Farm')}</Heading>
            <Text color="textSubtle" fontSize="14px">{t('Grow crops, earn XP, collect characters!')}</Text>
          </Box>
          <Flex alignItems="center" style={{ gap: '16px' }} flexWrap="wrap">
            <Box style={{ textAlign: 'right' }}>
              <Text color="textSubtle" fontSize="12px">{t('PLAX Balance')}</Text>
              <Text bold>{plaxFormatted} PLAX</Text>
            </Box>
            <Box style={{ textAlign: 'right' }}>
              <Text color="textSubtle" fontSize="12px">{t('Level')} {level}</Text>
              <Text bold>{xp} XP</Text>
              <Box width="100px" height="6px" bg="cardBorder" borderRadius="3px" overflow="hidden" mt="2px">
                <Box width={`${levelProgress * 100}%`} height="100%" bg="primary" borderRadius="3px" />
              </Box>
            </Box>
          </Flex>
        </Flex>

        <TabBar>
          <Button scale="sm" variant={activeTab === 'farm' ? 'primary' : 'secondary'} onClick={() => setActiveTab('farm')}>
            🧑‍🌾 {t('Farm')}
          </Button>
          <Button scale="sm" variant={activeTab === 'shop-items' ? 'primary' : 'secondary'} onClick={() => setActiveTab('shop-items')}>
            🛒 {t('Item Shop')}
          </Button>
          <Button scale="sm" variant={activeTab === 'shop-characters' ? 'primary' : 'secondary'} onClick={() => setActiveTab('shop-characters')}>
            👥 {t('Characters')}
          </Button>
          <Button scale="sm" variant={activeTab === 'inventory' ? 'primary' : 'secondary'} onClick={() => setActiveTab('inventory')}>
            🎒 {t('Inventory')}
          </Button>
        </TabBar>

        {activeTab === 'farm' && (
          <>
            <Flex mb="16px" style={{ gap: '8px' }} flexWrap="wrap" justifyContent="center">
              {(Object.keys(CROP_CONFIG) as CropType[]).map((crop) => {
                const config = CROP_CONFIG[crop]
                const count = getCropCount(crop)
                return (
                  <Button
                    key={crop}
                    scale="sm"
                    variant={selectedCrop === crop ? 'primary' : 'secondary'}
                    onClick={() => setSelectedCrop(selectedCrop === crop ? null : crop)}
                    disabled={count <= 0}
                    style={{ opacity: count <= 0 ? 0.5 : 1 }}
                  >
                    {config.emoji} {config.name} ({count})
                  </Button>
                )
              })}
              {selectedCrop && (
                <Button scale="sm" variant="text" onClick={() => setSelectedCrop(null)}>
                  {t('Cancel')}
                </Button>
              )}
            </Flex>
            {selectedCrop && (
              <Text textAlign="center" color="success" fontSize="14px" mb="12px">
                {t('Click an empty plot to plant %crop%!', { crop: CROP_CONFIG[selectedCrop].name })}
              </Text>
            )}
            <FarmGrid>
              {Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, cellIndex) => {
                const ri = Math.floor(cellIndex / GRID_SIZE)
                const ci = cellIndex % GRID_SIZE
                const plot = grid[ri][ci]
                const state = plot.state as PlotState
                const isClickable = state !== 'withered'
                const emoji = state !== 'empty' && plot.crop && state !== 'ready'
                  ? CROP_CONFIG[plot.crop].emoji
                  : getPlotEmoji(state, plot.crop)
                const showProgress = state !== 'empty' && state !== 'ready' && state !== 'withered' && plot.crop && plot.plantedAt
                let progressPct = 0
                if (showProgress && plot.crop && plot.plantedAt) {
                  const result = calculateStage(plot.crop, plot.plantedAt, plot.lastWateredAt)
                  progressPct = result.progress * 100
                }
                const needsWater = plot.state !== 'empty' && plot.state !== 'ready' && plot.state !== 'withered' && plot.lastWateredAt && (Date.now() - plot.lastWateredAt) > 8000

                return (
                  <PlotBox
                    key={`cell-${cellIndex}`}
                    $state={plot.state}
                    $isClickable={isClickable}
                    onClick={() => handlePlotClick(ri, ci)}
                  >
                    <PlotEmoji>{emoji}</PlotEmoji>
                    {needsWater && <WaterBadge><WaterIcon /></WaterBadge>}
                    {showProgress && (
                      <ProgressBar>
                        <ProgressFill $pct={progressPct} />
                      </ProgressBar>
                    )}
                  </PlotBox>
                )
              })}
            </FarmGrid>
            {ownedCharacters.length > 0 && (
              <Box mt="24px">
                <Heading as="h3" mb="12px">{t('Your Farm Characters')}</Heading>
                <Flex style={{ gap: '12px' }} flexWrap="wrap">
                  {ownedCharacters.map((char: ShopAsset) => (
                    <Card key={char.id.toString()}>
                      <CardBody style={{ textAlign: 'center', padding: '16px' }}>
                        <Text fontSize="36px">{char.imageURI || '🧑‍🌾'}</Text>
                        <Text bold fontSize="14px">{char.name}</Text>
                      </CardBody>
                    </Card>
                  ))}
                </Flex>
              </Box>
            )}
          </>
        )}

        {activeTab === 'shop-items' && (
          <>
            <Heading scale="md" mb="16px">{t('Item Shop')}</Heading>
            {!hasAddress ? (
              <Message variant="warning">
                <MessageText>{t('Game contract not configured for this network.')}</MessageText>
              </Message>
            ) : (
              <ShopGrid>
                {(assets ?? []).filter((a: ShopAsset) => a.assetType === 0).map((asset: ShopAsset) => {
                  const isOwned = ownedAssetSet.has(asset.id.toString())
                  const isBuying = buyAssetIds.has(asset.id.toString())
                  const priceDisplay = Number(formatUnits(asset.pricePLAX, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })

                  return (
                    <AssetCard key={asset.id.toString()}>
                      <AssetCardTop>{asset.imageURI || '📦'}</AssetCardTop>
                      <CardBody>
                        <Text bold mb="4px">{asset.name}</Text>
                        <Text color="textSubtle" fontSize="13px" mb="12px">{priceDisplay} PLAX</Text>
                        {!account ? (
                          <ConnectWalletButton width="100%" scale="sm" />
                        ) : isOwned ? (
                          <Button width="100%" scale="sm" disabled>{t('Owned')}</Button>
                        ) : !asset.active ? (
                          <Button width="100%" scale="sm" disabled>{t('Unavailable')}</Button>
                        ) : (
                          <Button
                            width="100%"
                            scale="sm"
                            onClick={() => handleBuyAsset(asset)}
                            disabled={isBuying}
                            endIcon={isBuying ? <AutoRenewIcon spin color="currentColor" /> : undefined}
                          >
                            {isBuying ? t('Buying...') : t('Buy')}
                          </Button>
                        )}
                      </CardBody>
                    </AssetCard>
                  )
                })}
                {(!assets || assets.filter((a: ShopAsset) => a.assetType === 0).length === 0) && (
                  <Text color="textSubtle">{t('No items available yet.')}</Text>
                )}
              </ShopGrid>
            )}
          </>
        )}

        {activeTab === 'shop-characters' && (
          <>
            <Heading scale="md" mb="16px">{t('Character Shop')}</Heading>
            {!hasAddress ? (
              <Message variant="warning">
                <MessageText>{t('Game contract not configured for this network.')}</MessageText>
              </Message>
            ) : (
              <ShopGrid>
                {(assets ?? []).filter((a: ShopAsset) => a.assetType === 1).map((asset: ShopAsset) => {
                  const isOwned = ownedAssetSet.has(asset.id.toString())
                  const isBuying = buyAssetIds.has(asset.id.toString())
                  const priceDisplay = Number(formatUnits(asset.pricePLAX, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })

                  return (
                    <AssetCard key={asset.id.toString()}>
                      <AssetCardTop>{asset.imageURI || '🧑‍🌾'}</AssetCardTop>
                      <CardBody>
                        <Text bold mb="4px">{asset.name}</Text>
                        <Text color="textSubtle" fontSize="13px" mb="12px">{priceDisplay} PLAX</Text>
                        {!account ? (
                          <ConnectWalletButton width="100%" scale="sm" />
                        ) : isOwned ? (
                          <Button width="100%" scale="sm" disabled>{t('Owned')}</Button>
                        ) : !asset.active ? (
                          <Button width="100%" scale="sm" disabled>{t('Unavailable')}</Button>
                        ) : (
                          <Button
                            width="100%"
                            scale="sm"
                            onClick={() => handleBuyAsset(asset)}
                            disabled={isBuying}
                            endIcon={isBuying ? <AutoRenewIcon spin color="currentColor" /> : undefined}
                          >
                            {isBuying ? t('Buying...') : t('Buy')}
                          </Button>
                        )}
                      </CardBody>
                    </AssetCard>
                  )
                })}
                {(!assets || assets.filter((a: ShopAsset) => a.assetType === 1).length === 0) && (
                  <Text color="textSubtle">{t('No characters available yet.')}</Text>
                )}
              </ShopGrid>
            )}
          </>
        )}

        {activeTab === 'inventory' && (
          <>
            <Heading scale="md" mb="16px">{t('Inventory')}</Heading>
            <Box mb="16px">
              <Text bold mb="8px">{t('Seeds')}</Text>
              {inventory.length === 0 ? (
                <Text color="textSubtle">{t('No seeds. Buy from Item Shop or start with default seeds.')}</Text>
              ) : (
                <Flex style={{ gap: '12px' }} flexWrap="wrap">
                  {inventory.map((item) => (
                    <Card key={item.crop}>
                      <CardBody style={{ padding: '16px', textAlign: 'center', minWidth: '120px' }}>
                        <Text fontSize="32px">{CROP_CONFIG[item.crop].emoji}</Text>
                        <Text bold fontSize="14px">{CROP_CONFIG[item.crop].name}</Text>
                        <Text color="textSubtle" fontSize="13px">{t('x%count%', { count: item.count })}</Text>
                      </CardBody>
                    </Card>
                  ))}
                </Flex>
              )}
            </Box>
            <Box>
              <Text bold mb="8px">{t('Owned Items & Characters')}</Text>
              {(!userAssetIds || userAssetIds.length === 0) ? (
                <Text color="textSubtle">{t('No items or characters purchased yet. Visit the shop!')}</Text>
              ) : (
                <Flex style={{ gap: '12px' }} flexWrap="wrap">
                  {(assets ?? [])
                    .filter((a: ShopAsset) => ownedAssetSet.has(a.id.toString()))
                    .map((asset: ShopAsset) => (
                      <Card key={asset.id.toString()}>
                        <CardBody style={{ padding: '16px', textAlign: 'center', minWidth: '120px' }}>
                          <Text fontSize="32px">{asset.imageURI || (asset.assetType === 1 ? '🧑‍🌾' : '📦')}</Text>
                          <Text bold fontSize="14px">{asset.name}</Text>
                          <Text color="textSubtle" fontSize="12px">{asset.assetType === 1 ? t('Character') : t('Item')}</Text>
                        </CardBody>
                      </Card>
                    ))}
                </Flex>
              )}
            </Box>
          </>
        )}
      </Container>
    </Page>
  )
}

export default Game
