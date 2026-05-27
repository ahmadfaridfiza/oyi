import { useCallback, useMemo, useState } from 'react'
import { BigNumber } from '@ethersproject/bignumber'
import { MaxUint256, Zero } from '@ethersproject/constants'
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
  InjectedModalProps,
  Input,
  LinkExternal,
  Message,
  MessageText,
  Modal,
  Text,
  useModal,
  useToast,
} from '@pancakeswap/uikit'
import ConnectWalletButton from 'components/ConnectWalletButton'
import { ToastDescriptionWithTx } from 'components/Toast'
import { useActiveChainId } from 'hooks/useActiveChainId'
import { useCallWithGasPrice } from 'hooks/useCallWithGasPrice'
import { useMiningFactoryContract, useTokenContract } from 'hooks/useContract'
import useSWR from 'swr'
import styled from 'styled-components'
import { getBlockExploreLink, isAddress } from 'utils'
import { getMiningFactoryAddress } from 'utils/addressHelpers'
import { useAccount } from 'wagmi'
import Page from 'views/Page'

type MiningView = 'all' | 'my-mining'

type PackageInfo = {
  id: BigNumber
  name: string
  hashRate: BigNumber
  priceUSDT: BigNumber
  rewardPerDay: BigNumber
  active: boolean
}

type MiningInfo = {
  id: BigNumber
  user: string
  referrer: string
  packageId: BigNumber
  hashRate: BigNumber
  startTime: BigNumber
  endTime: BigNumber
  totalPaid: BigNumber
  totalReward: BigNumber
  rewardClaimed: BigNumber
  lastClaimTime: BigNumber
  accRewardPerShare: BigNumber
  rewardDebt: BigNumber
  active: boolean
}

const CARD_COLORS = ['#1FC7D4', '#7645D9', '#FFB237', '#31D0AA', '#ED4B9E', '#9A6AFF', '#6B8CFF', '#FF6B6B', '#51E0A0', '#E0A051']

const CardGrid = styled(Box)`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 24px;
`

const PackageCardShell = styled(Card)<{ $accent: string }>`
  overflow: hidden;
  border-top: 4px solid ${({ $accent }) => $accent};
`

const PackageCardTop = styled(Box)<{ $accent: string }>`
  padding: 24px;
  background: ${({ theme }) => theme.colors.backgroundAlt};
  text-align: center;
`

const PackageEmoji = styled(Box)`
  font-size: 48px;
  line-height: 1;
  margin-bottom: 12px;
`

const MineShell = styled(Box)`
  overflow: hidden;
  border: 1px solid ${({ theme }) => theme.colors.cardBorder};
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.backgroundAlt};
`

const MineHeader = styled(Flex)`
  min-height: 72px;
  gap: 16px;
  padding: 18px 24px;
  align-items: center;

  ${({ theme }) => theme.mediaQueries.md} {
    align-items: center;
  }
`

const MinePanel = styled(Box)`
  border-top: 1px solid ${({ theme }) => theme.colors.cardBorder};
  padding: 20px 24px 24px;
`

const StatBox = styled(Box)`
  min-width: 100px;
`

const ActionBox = styled(Box)`
  border: 1px solid ${({ theme }) => theme.colors.cardBorder};
  border-radius: 8px;
  padding: 18px;
`

const StyledPrice = styled(Text)`
  font-size: 28px;
  font-weight: 700;
`

const formatCompactAmount = (amount: BigNumber, decimals: number, precision = 4) => {
  const value = Number(formatUnits(amount, decimals))
  if (!Number.isFinite(value)) return '0'
  if (value === 0) return '0'
  const fixedPrecision = Math.max(precision, Math.abs(Math.floor(Math.log10(Math.abs(value)))) + 2)
  return value.toLocaleString(undefined, { maximumFractionDigits: fixedPrecision })
}

const formatDuration = (seconds?: BigNumber) => {
  if (!seconds || seconds.lte(0)) return '-'

  let value = 0
  try {
    value = seconds.toNumber()
  } catch {
    return 'Long running'
  }

  const days = Math.floor(value / 86400)
  const hours = Math.floor((value % 86400) / 3600)
  if (days > 0) return `${days.toLocaleString()}d ${hours}h`
  return `${hours}h`
}

const PACKAGE_EMOJIS = ['⚡', '💎', '🔥', '🚀', '🌟', '💪', '🎯', '🏆', '⚙️', '🔮']

const getPackageColor = (id: number) => CARD_COLORS[id % CARD_COLORS.length]
const getPackageEmoji = (id: number) => PACKAGE_EMOJIS[id % PACKAGE_EMOJIS.length]

const MiningTabs: React.FC<{ activeView: MiningView }> = ({ activeView }) => {
  const { t } = useTranslation()
  const links = [
    { href: '/mining', label: t('Mining Packages'), view: 'all' },
    { href: '/mining/my-mining', label: t('My Mining'), view: 'my-mining' },
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

const BuyHashModal: React.FC<
  InjectedModalProps & {
    pkg: PackageInfo
    miningFactoryAddress: string
    onRefresh: () => void
  }
> = ({ pkg, miningFactoryAddress, onDismiss, onRefresh }) => {
  const { t } = useTranslation()
  const { address: account } = useAccount()
  const { callWithGasPrice } = useCallWithGasPrice()
  const { toastError, toastSuccess } = useToast()
  const miningFactoryContract = useMiningFactoryContract()
  const [referrerAddress, setReferrerAddress] = useState('')
  const [isBuying, setIsBuying] = useState(false)

  const { data: usdtAddr } = useSWR(
    miningFactoryContract ? ['miningUsdtAddress'] : null,
    () => miningFactoryContract.usdt(),
  )

  const usdtTokenContract = useTokenContract(usdtAddr)

  const { data: usdtAllowance, mutate: refreshAllowance } = useSWR(
    account && usdtTokenContract && miningFactoryAddress
      ? ['miningUsdtAllowance', account, miningFactoryAddress]
      : null,
    () => usdtTokenContract.allowance(account, miningFactoryAddress),
  )

  const price = pkg.priceUSDT
  const isApproved = usdtAllowance ? BigNumber.from(usdtAllowance).gte(price) : false

  const handleApprove = useCallback(async () => {
    if (!usdtTokenContract || !miningFactoryAddress) return

    setIsBuying(true)
    try {
      const tx = await callWithGasPrice(usdtTokenContract, 'approve', [miningFactoryAddress, MaxUint256])
      const receipt = await tx.wait()
      toastSuccess(t('USDT Enabled'), <ToastDescriptionWithTx txHash={receipt.transactionHash} />)
      refreshAllowance()
    } catch (error) {
      console.error(error)
      toastError(t('Error'), t('Unable to approve USDT. Please try again.'))
    } finally {
      setIsBuying(false)
    }
  }, [callWithGasPrice, miningFactoryAddress, refreshAllowance, t, toastError, toastSuccess, usdtTokenContract])

  const handleBuy = useCallback(async () => {
    if (!miningFactoryContract) return

    setIsBuying(true)
    try {
      const ref = isAddress(referrerAddress) ? referrerAddress : '0x0000000000000000000000000000000000000000'
      const tx = await callWithGasPrice(miningFactoryContract, 'buyHash', [pkg.id, ref])
      const receipt = await tx.wait()
      toastSuccess(t('Hash Purchased!'), <ToastDescriptionWithTx txHash={receipt.transactionHash} />)
      onRefresh()
      onDismiss?.()
    } catch (error) {
      console.error(error)
      toastError(t('Error'), t('Unable to purchase hash. Please try again.'))
    } finally {
      setIsBuying(false)
    }
  }, [callWithGasPrice, miningFactoryContract, onDismiss, onRefresh, pkg.id, referrerAddress, t, toastError, toastSuccess])

  return (
    <Modal title={t('Buy %package% Package', { package: pkg.name })} onDismiss={onDismiss}>
      <Box width={['100%', '100%', '400px']}>
        <Flex flexDirection="column" alignItems="center" mb="24px">
          <Text fontSize="14px" color="textSubtle">{t('Price')}</Text>
          <StyledPrice>{formatCompactAmount(pkg.priceUSDT, 6, 2)} USDT</StyledPrice>
          <Text fontSize="14px" color="textSubtle" mt="8px">{t('Hash Rate')}</Text>
          <Text bold fontSize="20px">{formatCompactAmount(pkg.hashRate, 0, 0)} TH/s</Text>
          <Text fontSize="14px" color="textSubtle" mt="8px">{t('Daily Reward')}</Text>
          <Text bold fontSize="20px">{formatCompactAmount(pkg.rewardPerDay, 18, 2)} PLAX</Text>
        </Flex>

        <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
          {t('Referral Address (Optional)')}
        </Text>
        <Input
          value={referrerAddress}
          onChange={(event) => setReferrerAddress(event.target.value)}
          placeholder="0x..."
          mb="16px"
        />
        {isAddress(referrerAddress) ? (
          <Text color="success" fontSize="12px" mb="16px">
            {t('Referrer will receive 10% of your payment in USDT!')}
          </Text>
        ) : null}

        {!account ? (
          <ConnectWalletButton width="100%" />
        ) : !isApproved ? (
          <Button
            width="100%"
            onClick={handleApprove}
            disabled={isBuying}
            endIcon={isBuying ? <AutoRenewIcon spin color="currentColor" /> : undefined}
          >
            {t('Enable USDT')}
          </Button>
        ) : (
          <Button
            width="100%"
            onClick={handleBuy}
            disabled={isBuying}
            endIcon={isBuying ? <AutoRenewIcon spin color="currentColor" /> : undefined}
          >
            {t('Buy Hash')}
          </Button>
        )}
      </Box>
    </Modal>
  )
}

const PackageCard: React.FC<{
  pkg: PackageInfo
  miningFactoryAddress: string
  onRefresh: () => void
}> = ({ pkg, miningFactoryAddress, onRefresh }) => {
  const { t } = useTranslation()
  const color = getPackageColor(pkg.id.toNumber())

  const [onPresentBuyModal] = useModal(
    <BuyHashModal pkg={pkg} miningFactoryAddress={miningFactoryAddress} onRefresh={onRefresh} />,
  )

  const dailyRewardFormatted = formatCompactAmount(pkg.rewardPerDay, 18, 2)
  const totalRewardFormatted = formatCompactAmount(pkg.rewardPerDay.mul(30), 18, 2)

  return (
    <PackageCardShell $accent={color}>
      <PackageCardTop $accent={color}>
        <PackageEmoji>{getPackageEmoji(pkg.id.toNumber())}</PackageEmoji>
        <Heading scale="md" mb="4px">{pkg.name}</Heading>
        <Text fontSize="14px" color="textSubtle">{formatCompactAmount(pkg.hashRate, 0, 0)} TH/s</Text>
      </PackageCardTop>
      <CardBody>
        <Flex justifyContent="space-between" mb="8px">
          <Text color="textSubtle">{t('Price')}</Text>
          <Text bold>{formatCompactAmount(pkg.priceUSDT, 6, 2)} USDT</Text>
        </Flex>
        <Flex justifyContent="space-between" mb="8px">
          <Text color="textSubtle">{t('Daily Reward')}</Text>
          <Text bold>{dailyRewardFormatted} PLAX</Text>
        </Flex>
        <Flex justifyContent="space-between" mb="8px">
          <Text color="textSubtle">{t('Duration')}</Text>
          <Text bold>{t('30 Days')}</Text>
        </Flex>
        <Flex justifyContent="space-between" mb="24px">
          <Text color="textSubtle">{t('Total Reward')}</Text>
          <Text bold>{totalRewardFormatted} PLAX</Text>
        </Flex>
        <Button width="100%" onClick={onPresentBuyModal} disabled={!pkg.active}>
          {pkg.active ? t('Buy Hash') : t('Sold Out')}
        </Button>
      </CardBody>
    </PackageCardShell>
  )
}

const MiningRow: React.FC<{
  mining: MiningInfo
  miningFactoryContract: any
  packages?: PackageInfo[]
  onRefresh: () => void
}> = ({ mining, miningFactoryContract, packages, onRefresh }) => {
  const { t } = useTranslation()
  const { address: account } = useAccount()
  const { callWithGasPrice } = useCallWithGasPrice()
  const { toastError, toastSuccess } = useToast()
  const [pendingAction, setPendingAction] = useState('')
  const [expanded, setExpanded] = useState(false)

  const packageId = mining.packageId.toNumber()
  const pkg = packages?.find((p) => p.id.toNumber() === packageId)
  const packageName = pkg?.name ?? `${t('Package')} #${packageId}`

  const { data: pendingReward, mutate: refreshPending } = useSWR(
    account && miningFactoryContract
      ? ['miningPendingReward', mining.id.toString(), account]
      : null,
    () => miningFactoryContract.pendingReward(mining.id) as Promise<BigNumber>,
    { refreshInterval: 10000 },
  )

  const pending = pendingReward ?? Zero
  const isActive = mining.active
  const now = Math.floor(Date.now() / 1000)
  const endTime = mining.endTime.toNumber()
  const remainingSeconds = endTime > now ? endTime - now : 0
  const totalReward = Number(formatUnits(mining.totalReward, 18))
  const rewardClaimed = Number(formatUnits(mining.rewardClaimed, 18))
  const progressPct = totalReward > 0 ? Math.min((rewardClaimed / totalReward) * 100, 100) : 0

  const handleClaim = useCallback(async () => {
    if (!miningFactoryContract) return

    setPendingAction('claim')
    try {
      const tx = await callWithGasPrice(miningFactoryContract, 'claimReward', [mining.id])
      const receipt = await tx.wait()
      toastSuccess(t('Reward Claimed!'), <ToastDescriptionWithTx txHash={receipt.transactionHash} />)
      refreshPending()
      onRefresh()
    } catch (error) {
      console.error(error)
      toastError(t('Error'), t('Unable to claim reward. Please try again.'))
    } finally {
      setPendingAction('')
    }
  }, [callWithGasPrice, mining.id, miningFactoryContract, onRefresh, refreshPending, t, toastError, toastSuccess])

  return (
    <MineShell>
      <MineHeader
        flexDirection={['column', 'row']}
        justifyContent="space-between"
        onClick={() => setExpanded((current) => !current)}
        style={{ cursor: 'pointer' }}
      >
        <Flex alignItems="center" style={{ gap: '12px' }}>
          <Box
            width="8px"
            height="8px"
            borderRadius="50%"
            style={{ background: isActive ? '#31D0AA' : '#9B9B9B', flexShrink: 0 }}
          />
          <Box>
            <Text bold>{packageName}</Text>
            <Text color="textSubtle" fontSize="12px">#{mining.id.toString()}</Text>
          </Box>
        </Flex>
        <StatBox>
          <Text color="textSubtle" fontSize="12px">{t('Hash')}</Text>
          <Text bold fontSize="14px">{formatCompactAmount(mining.hashRate, 0, 0)} TH/s</Text>
        </StatBox>
        <StatBox>
          <Text color="textSubtle" fontSize="12px">{t('Reward')}</Text>
          <Text bold fontSize="14px">{formatCompactAmount(pending, 18, 4)} PLAX</Text>
        </StatBox>
        <StatBox>
          <Text color="textSubtle" fontSize="12px">{isActive ? t('Ends in') : t('Status')}</Text>
          <Text bold fontSize="14px" color={isActive ? 'success' : 'textSubtle'}>
            {isActive ? formatDuration(BigNumber.from(remainingSeconds)) : t('Ended')}
          </Text>
        </StatBox>
        <Button variant="text" scale="sm">{expanded ? t('Hide') : t('Details')}</Button>
      </MineHeader>
      {expanded ? (
        <MinePanel>
          <Flex flexDirection={['column', null, 'row']} style={{ gap: '24px' }}>
            <Box minWidth="200px">
              <Flex justifyContent="space-between" mb="6px">
                <Text color="textSubtle">{t('Total Paid')}</Text>
                <Text bold>{formatCompactAmount(mining.totalPaid, 6, 2)} USDT</Text>
              </Flex>
              <Flex justifyContent="space-between" mb="6px">
                <Text color="textSubtle">{t('Total Reward')}</Text>
                <Text bold>{formatCompactAmount(mining.totalReward, 18, 2)} PLAX</Text>
              </Flex>
              <Flex justifyContent="space-between" mb="6px">
                <Text color="textSubtle">{t('Claimed')}</Text>
                <Text bold>{formatCompactAmount(mining.rewardClaimed, 18, 2)} PLAX</Text>
              </Flex>
              <Flex justifyContent="space-between" mb="6px">
                <Text color="textSubtle">{t('Progress')}</Text>
                <Text bold>{progressPct.toFixed(1)}%</Text>
              </Flex>
              <Box width="100%" height="8px" bg="cardBorder" borderRadius="4px" mt="4px" mb="12px" overflow="hidden">
                <Box width={`${progressPct}%`} height="100%" bg="primary" borderRadius="4px" />
              </Box>
              <Flex alignItems="center" style={{ gap: '6px', flexWrap: 'wrap' }}>
                <LinkExternal href={getBlockExploreLink(miningFactoryContract?.address || '', 'address')} bold={false} small>
                  {t('View Contract')}
                </LinkExternal>
              </Flex>
            </Box>
            <ActionBox width="100%">
              <Text color="secondary" fontSize="12px" bold textTransform="uppercase" mb="12px">
                {t('PLAX Earned')}
              </Text>
              <Flex justifyContent="space-between" alignItems="center" style={{ gap: '12px' }}>
                <Box>
                  <Text fontSize="24px" bold>{formatCompactAmount(pending, 18, 6)}</Text>
                  <Text color="textSubtle" fontSize="12px">PLAX</Text>
                </Box>
                <Button
                  onClick={handleClaim}
                  disabled={pending.lte(0) || pendingAction === 'claim'}
                  endIcon={pendingAction === 'claim' ? <AutoRenewIcon spin color="currentColor" /> : undefined}
                >
                  {t('Claim')}
                </Button>
              </Flex>
            </ActionBox>
          </Flex>
        </MinePanel>
      ) : null}
    </MineShell>
  )
}

const PackagesList: React.FC<{ onRefresh: () => void }> = ({ onRefresh }) => {
  const { t } = useTranslation()
  const { chainId } = useActiveChainId()
  const miningFactoryAddress = useMemo(() => getMiningFactoryAddress(chainId), [chainId])
  const hasAddress = Boolean(miningFactoryAddress)
  const miningFactoryContract = useMiningFactoryContract(false)

  const { data: packages, mutate } = useSWR(
    miningFactoryContract && hasAddress ? ['miningPackagesAll'] : null,
    () => miningFactoryContract.getAllPackages() as Promise<PackageInfo[]>,
    { refreshInterval: 30000 },
  )

  const { data: totalStaked } = useSWR(
    miningFactoryContract && hasAddress ? ['miningTotalStaked'] : null,
    () => miningFactoryContract.totalStaked(),
  )

  const { data: miningCount } = useSWR(
    miningFactoryContract && hasAddress ? ['miningCount'] : null,
    () => miningFactoryContract.miningCount(),
  )

  const refresh = useCallback(() => {
    mutate()
    onRefresh()
  }, [mutate, onRefresh])

  if (!hasAddress) {
    return (
      <Message variant="warning">
        <MessageText>{t('Mining contract address is not configured for this network yet.')}</MessageText>
      </Message>
    )
  }

  return (
    <>
      <Flex mb="24px" style={{ gap: '24px' }} flexWrap="wrap">
        <Card>
          <CardBody>
            <Text color="textSubtle" fontSize="12px">{t('Total Hash Staked')}</Text>
            <Text bold fontSize="24px">
              {totalStaked ? `${formatCompactAmount(BigNumber.from(totalStaked), 0, 0)} TH/s` : '-'}
            </Text>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <Text color="textSubtle" fontSize="12px">{t('Total Miners')}</Text>
            <Text bold fontSize="24px">{miningCount ? miningCount.toString() : '-'}</Text>
          </CardBody>
        </Card>
      </Flex>

      <CardGrid>
        {packages?.map((pkg: PackageInfo) => (
          <PackageCard
            key={pkg.id.toString()}
            pkg={pkg}
            miningFactoryAddress={miningFactoryAddress}
            onRefresh={refresh}
          />
        )) ?? null}
      </CardGrid>

      {!packages?.length ? (
        <Card mt="24px">
          <CardBody>
            <Text color="textSubtle">{t('Loading packages...')}</Text>
          </CardBody>
        </Card>
      ) : null}
    </>
  )
}

const MyMiningList: React.FC = () => {
  const { t } = useTranslation()
  const { address: account } = useAccount()
  const { chainId } = useActiveChainId()
  const miningFactoryAddress = useMemo(() => getMiningFactoryAddress(chainId), [chainId])
  const hasAddress = Boolean(miningFactoryAddress)
  const miningFactoryContract = useMiningFactoryContract()

  const { data: packages } = useSWR(
    miningFactoryContract && hasAddress ? ['miningPackagesAll'] : null,
    () => miningFactoryContract.getAllPackages() as Promise<PackageInfo[]>,
    { refreshInterval: 60000 },
  )

  const { data: minings, mutate } = useSWR(
    miningFactoryContract && hasAddress && account
      ? ['miningMyMinings', account, miningFactoryAddress]
      : null,
    () => miningFactoryContract.getMiningsByUser(account, 0, 50) as Promise<MiningInfo[]>,
    { refreshInterval: 15000 },
  )

  const { data: referralEarnings } = useSWR(
    miningFactoryContract && hasAddress && account
      ? ['miningReferralEarnings', account]
      : null,
    () => miningFactoryContract.totalReferralEarnings(account),
  )

  if (!hasAddress) {
    return (
      <Message variant="warning">
        <MessageText>{t('Mining contract address is not configured for this network yet.')}</MessageText>
      </Message>
    )
  }

  if (!account) {
    return <ConnectWalletButton />
  }

  return (
    <>
      {referralEarnings ? (
        <Card mb="24px">
          <CardBody>
            <Flex alignItems="center" justifyContent="space-between">
              <Box>
                <Text color="textSubtle" fontSize="12px">{t('Total Referral Earnings')}</Text>
                <Text bold fontSize="24px">{formatCompactAmount(BigNumber.from(referralEarnings), 6, 2)} USDT</Text>
              </Box>
              <Text fontSize="40px">🎯</Text>
            </Flex>
          </CardBody>
        </Card>
      ) : null}

      <Flex flexDirection="column" style={{ gap: '0' }}>
        {minings?.map((mining: MiningInfo) => (
          <MiningRow
            key={mining.id.toString()}
            mining={mining}
            packages={packages}
            miningFactoryContract={miningFactoryContract}
            onRefresh={mutate}
          />
        )) ?? null}
      </Flex>

      {!minings?.length ? (
        <Card>
          <CardBody>
            <Text color="textSubtle">{t('No mining active. Buy a package to start mining!')}</Text>
          </CardBody>
        </Card>
      ) : null}
    </>
  )
}

const Mining: React.FC<{ view: MiningView }> = ({ view }) => {
  const [refreshKey, setRefreshKey] = useState(0)
  const handleRefresh = useCallback(() => setRefreshKey((k) => k + 1), [])

  return (
    <Page>
      <Box maxWidth="1200px" mx="auto" width="100%">
        <MiningTabs activeView={view} />
        {view === 'all' ? <PackagesList onRefresh={handleRefresh} /> : <MyMiningList />}
      </Box>
    </Page>
  )
}

export default Mining
