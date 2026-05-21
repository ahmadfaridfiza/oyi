import { useCallback, useMemo, useState } from 'react'
import { BigNumber } from '@ethersproject/bignumber'
import { MaxUint256, Zero } from '@ethersproject/constants'
import { formatUnits, parseUnits } from '@ethersproject/units'
import { useTranslation } from '@pancakeswap/localization'
import {
  AutoRenewIcon,
  Box,
  Button,
  Card,
  CardBody,
  Checkbox,
  CopyButton,
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
import { useTokenContract, useTokenLockerContract } from 'hooks/useContract'
import useSWR from 'swr'
import { isAddress } from 'utils'
import { getTokenLockerAddress } from 'utils/addressHelpers'
import { useAccount } from 'wagmi'
import Page from 'views/Page'

type TokenLockerView = 'create' | 'my-locks' | 'all-locks'

type LockInfo = {
  id: BigNumber
  token: string
  owner: string
  title: string
  amount: BigNumber
  withdrawnAmount: BigNumber
  createdAt: BigNumber
  unlockDate: BigNumber
  vesting: boolean
  tgeDate: BigNumber
  tgeBps: number
  cycle: BigNumber
  cycleBps: number
}

const LOCK_FEE = parseUnits('10', 18)
const LOCKS_PAGE_SIZE = 50

const parseUtcDateInput = (value: string) => {
  if (!value) return 0
  const timestamp = Date.parse(`${value}:00Z`)
  return Number.isNaN(timestamp) ? 0 : Math.floor(timestamp / 1000)
}

const formatDate = (timestamp?: BigNumber) => {
  const value = timestamp?.toNumber()
  if (!value) return '-'
  return new Date(value * 1000).toISOString().replace('T', ' ').slice(0, 16)
}

const parsePercentToBps = (value: string) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.round(parsed * 100)
}

const getWithdrawableAmount = (lock: LockInfo) => {
  const now = Math.floor(Date.now() / 1000)
  let unlocked = Zero

  if (!lock.vesting) {
    unlocked = now >= lock.unlockDate.toNumber() ? lock.amount : Zero
  } else if (now >= lock.tgeDate.toNumber()) {
    const cycles = lock.cycle.gt(0) ? Math.floor((now - lock.tgeDate.toNumber()) / lock.cycle.toNumber()) : 0
    const releasedBps = Math.min(10000, lock.tgeBps + cycles * lock.cycleBps)
    unlocked = lock.amount.mul(releasedBps).div(10000)
  }

  return unlocked.gt(lock.withdrawnAmount) ? unlocked.sub(lock.withdrawnAmount) : Zero
}

const getLockTitle = (lock: LockInfo) => lock.title || `Lock #${lock.id.toString()}`

const LockRow: React.FC<{
  lock: LockInfo
  view: 'my-locks' | 'all-locks'
  withdrawingLockId: string
  onWithdraw: (lock: LockInfo) => void
}> = ({ lock, view, withdrawingLockId, onWithdraw }) => {
  const { t } = useTranslation()
  const tokenContract = useTokenContract(lock.token, false)
  const { data: tokenMetadata } = useSWR(tokenContract ? ['tokenLockerListTokenMetadata', lock.token] : null, async () => {
    const [decimals, symbol] = await Promise.all([
      tokenContract.decimals().catch(() => 18),
      tokenContract.symbol().catch(() => 'TOKEN'),
    ])
    return { decimals: Number(decimals), symbol: String(symbol) }
  })
  const decimals = tokenMetadata?.decimals ?? 18
  const symbol = tokenMetadata?.symbol ?? 'TOKEN'
  const withdrawable = getWithdrawableAmount(lock)

  return (
    <Box p="16px" border="1px solid" borderColor="cardBorder" borderRadius="8px">
      <Flex justifyContent="space-between" alignItems="flex-start" mb="8px" style={{ gap: '12px' }}>
        <Box>
          <Text bold>{getLockTitle(lock)}</Text>
          <Flex alignItems="center" style={{ gap: '6px', flexWrap: 'wrap' }}>
            <Text color="textSubtle" fontSize="12px">
              {symbol} - {lock.token}
            </Text>
            <CopyButton width="16px" buttonColor="textSubtle" text={lock.token} tooltipMessage={t('Token address copied')} />
          </Flex>
        </Box>
        <Text fontSize="12px" color={lock.vesting ? 'secondary' : 'primary'} bold>
          {lock.vesting ? t('Vesting') : t('Lock')}
        </Text>
      </Flex>
      <Flex flexDirection={['column', null, 'row']} style={{ gap: '12px' }}>
        <Box width="100%">
          <Text color="textSubtle" fontSize="12px">
            {t('Amount')}
          </Text>
          <Text>
            {formatUnits(lock.amount, decimals)} {symbol}
          </Text>
        </Box>
        <Box width="100%">
          <Text color="textSubtle" fontSize="12px">
            {lock.vesting ? t('TGE Date (UTC)') : t('Unlock Date (UTC)')}
          </Text>
          <Text>{formatDate(lock.vesting ? lock.tgeDate : lock.unlockDate)}</Text>
        </Box>
        <Box width="100%">
          <Text color="textSubtle" fontSize="12px">
            {t('Owner')}
          </Text>
          <Text fontSize="12px">{lock.owner}</Text>
        </Box>
      </Flex>
      {view === 'my-locks' ? (
        <Button
          mt="16px"
          scale="sm"
          onClick={() => onWithdraw(lock)}
          disabled={withdrawable.lte(0) || withdrawingLockId === lock.id.toString()}
          endIcon={withdrawingLockId === lock.id.toString() ? <AutoRenewIcon spin color="currentColor" /> : undefined}
        >
          {withdrawable.gt(0)
            ? t('Withdraw %amount%', { amount: `${formatUnits(withdrawable, decimals)} ${symbol}` })
            : t('Locked')}
        </Button>
      ) : null}
    </Box>
  )
}

const TokenLockerTabs: React.FC<{ activeView: TokenLockerView }> = ({ activeView }) => {
  const { t } = useTranslation()
  const links = [
    { href: '/token-locker', label: t('Create Lock'), view: 'create' },
    { href: '/token-locker/my-locks', label: t('My Locks'), view: 'my-locks' },
    { href: '/token-locker/all-locks', label: t('All Locks'), view: 'all-locks' },
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

const CreateLock = () => {
  const { t } = useTranslation()
  const { address: account } = useAccount()
  const { chainId } = useActiveChainId()
  const { callWithGasPrice } = useCallWithGasPrice()
  const { toastError, toastSuccess } = useToast()

  const tokenLockerAddress = useMemo(() => getTokenLockerAddress(chainId), [chainId])
  const hasTokenLockerAddress = Boolean(tokenLockerAddress)
  const plaxToken = bscTokens.cake
  const plaxContract = useTokenContract(plaxToken.address)
  const tokenLockerContract = useTokenLockerContract()

  const [tokenAddress, setTokenAddress] = useState('')
  const validatedTokenAddress = useMemo(() => isAddress(tokenAddress), [tokenAddress])
  const lockedTokenContract = useTokenContract(validatedTokenAddress || undefined)

  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [unlockDate, setUnlockDate] = useState('')
  const [useAnotherOwner, setUseAnotherOwner] = useState(false)
  const [ownerAddress, setOwnerAddress] = useState('')
  const [useVesting, setUseVesting] = useState(false)
  const [tgeDate, setTgeDate] = useState('')
  const [tgePercent, setTgePercent] = useState('')
  const [cycleDays, setCycleDays] = useState('')
  const [cyclePercent, setCyclePercent] = useState('')
  const [isApprovingFee, setIsApprovingFee] = useState(false)
  const [isApprovingToken, setIsApprovingToken] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [createdLockId, setCreatedLockId] = useState('')

  const { data: tokenMetadata } = useSWR(
    validatedTokenAddress && lockedTokenContract ? ['tokenLockerTokenMetadata', validatedTokenAddress] : null,
    async () => {
      const [decimals, symbol] = await Promise.all([
        lockedTokenContract.decimals().catch(() => 18),
        lockedTokenContract.symbol().catch(() => 'TOKEN'),
      ])
      return { decimals: Number(decimals), symbol: String(symbol) }
    },
  )

  const tokenDecimals = tokenMetadata?.decimals ?? 18
  const parsedAmount = useMemo(() => {
    if (!amount) return null
    try {
      return parseUnits(amount, tokenDecimals)
    } catch {
      return null
    }
  }, [amount, tokenDecimals])

  const lockOwner = useMemo(() => {
    if (!useAnotherOwner) return account
    return isAddress(ownerAddress) || undefined
  }, [account, ownerAddress, useAnotherOwner])

  const { data: feeAllowance, mutate: refreshFeeAllowance } = useSWR(
    account && plaxContract && hasTokenLockerAddress ? ['tokenLockerFeeAllowance', account, tokenLockerAddress] : null,
    () => plaxContract.allowance(account, tokenLockerAddress),
  )

  const { data: tokenAllowance, mutate: refreshTokenAllowance } = useSWR(
    account && lockedTokenContract && validatedTokenAddress && hasTokenLockerAddress
      ? ['tokenLockerTokenAllowance', account, validatedTokenAddress, tokenLockerAddress]
      : null,
    () => lockedTokenContract.allowance(account, tokenLockerAddress),
  )

  const isFeeApproved = feeAllowance ? BigNumber.from(feeAllowance).gte(LOCK_FEE) : false
  const isTokenApproved = parsedAmount && tokenAllowance ? BigNumber.from(tokenAllowance).gte(parsedAmount) : false
  const unlockTimestamp = parseUtcDateInput(unlockDate)
  const tgeTimestamp = parseUtcDateInput(tgeDate)
  const tgeBps = parsePercentToBps(tgePercent)
  const cycleBps = parsePercentToBps(cyclePercent)
  const cycleSeconds = Math.floor(Number(cycleDays) * 24 * 60 * 60)

  const canCreate =
    Boolean(account) &&
    Boolean(tokenLockerContract) &&
    hasTokenLockerAddress &&
    Boolean(validatedTokenAddress) &&
    Boolean(lockOwner) &&
    parsedAmount?.gt(0) &&
    (useVesting
      ? tgeTimestamp > Math.floor(Date.now() / 1000) &&
        tgeBps !== null &&
        cycleBps !== null &&
        tgeBps <= 10000 &&
        cycleBps <= 10000 &&
        tgeBps + cycleBps > 0 &&
        cycleSeconds > 0
      : unlockTimestamp > Math.floor(Date.now() / 1000))

  const handleApproveFee = useCallback(async () => {
    if (!plaxContract || !hasTokenLockerAddress) return

    setIsApprovingFee(true)
    try {
      const tx = await callWithGasPrice(plaxContract, 'approve', [tokenLockerAddress, MaxUint256])
      const receipt = await tx.wait()
      toastSuccess(t('Contract Enabled'), <ToastDescriptionWithTx txHash={receipt.transactionHash} />)
      refreshFeeAllowance()
    } catch (error) {
      console.error(error)
      toastError(t('Error'), t('Unable to approve PLAX. Please try again.'))
    } finally {
      setIsApprovingFee(false)
    }
  }, [callWithGasPrice, hasTokenLockerAddress, plaxContract, refreshFeeAllowance, t, toastError, toastSuccess, tokenLockerAddress])

  const handleApproveToken = useCallback(async () => {
    if (!lockedTokenContract || !hasTokenLockerAddress) return

    setIsApprovingToken(true)
    try {
      const tx = await callWithGasPrice(lockedTokenContract, 'approve', [tokenLockerAddress, MaxUint256])
      const receipt = await tx.wait()
      toastSuccess(t('Token Enabled'), <ToastDescriptionWithTx txHash={receipt.transactionHash} />)
      refreshTokenAllowance()
    } catch (error) {
      console.error(error)
      toastError(t('Error'), t('Unable to approve token. Please try again.'))
    } finally {
      setIsApprovingToken(false)
    }
  }, [
    callWithGasPrice,
    hasTokenLockerAddress,
    lockedTokenContract,
    refreshTokenAllowance,
    t,
    toastError,
    toastSuccess,
    tokenLockerAddress,
  ])

  const handleCreateLock = useCallback(async () => {
    if (!tokenLockerContract || !validatedTokenAddress || !parsedAmount || !lockOwner || !canCreate) return

    setIsCreating(true)
    setCreatedLockId('')
    try {
      const tx = await callWithGasPrice(tokenLockerContract, 'createLock', [
        validatedTokenAddress,
        title.trim(),
        parsedAmount,
        useVesting ? 0 : unlockTimestamp,
        lockOwner,
        useVesting,
        useVesting ? tgeTimestamp : 0,
        useVesting ? tgeBps : 0,
        useVesting ? cycleSeconds : 0,
        useVesting ? cycleBps : 0,
      ])
      const receipt = await tx.wait()
      const createdEvent = receipt.logs
        .map((log) => {
          try {
            return tokenLockerContract.interface.parseLog(log)
          } catch {
            return null
          }
        })
        .find((event) => event?.name === 'LockCreated')

      if (createdEvent?.args?.id) {
        setCreatedLockId(createdEvent.args.id.toString())
      }

      toastSuccess(t('Lock Created'), <ToastDescriptionWithTx txHash={receipt.transactionHash} />)
      refreshFeeAllowance()
      refreshTokenAllowance()
    } catch (error) {
      console.error(error)
      toastError(t('Error'), t('Unable to create lock. Please check your inputs and try again.'))
    } finally {
      setIsCreating(false)
    }
  }, [
    callWithGasPrice,
    canCreate,
    cycleBps,
    cycleSeconds,
    lockOwner,
    parsedAmount,
    refreshFeeAllowance,
    refreshTokenAllowance,
    t,
    tgeBps,
    tgeTimestamp,
    title,
    toastError,
    toastSuccess,
    tokenLockerContract,
    unlockTimestamp,
    useVesting,
    validatedTokenAddress,
  ])

  return (
    <Card>
      <CardBody>
        <Heading scale="lg" mb="8px">
          {t('Token / LP Locker')}
        </Heading>
        <Text color="textSubtle" mb="24px">
          {t('Lock any ERC-20 token or LP token with a fixed %fee% PLAX fee.', { fee: formatUnits(LOCK_FEE, 18) })}
        </Text>

        {!hasTokenLockerAddress ? (
          <Message variant="warning" mb="24px">
            <MessageText>{t('Token locker contract address is not configured for this network yet.')}</MessageText>
          </Message>
        ) : null}

        <Box mb="16px">
          <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
            {t('Token or LP Token Address')}
          </Text>
          <Input value={tokenAddress} onChange={(event) => setTokenAddress(event.target.value)} placeholder="0x..." />
          {validatedTokenAddress && tokenMetadata?.symbol ? (
            <Text color="textSubtle" fontSize="12px" mt="4px">
              {t('Detected: %symbol% (%decimals% decimals)', {
                symbol: tokenMetadata.symbol,
                decimals: tokenDecimals,
              })}
            </Text>
          ) : null}
        </Box>

        <Box mb="16px">
          <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
            {t('Title')}
          </Text>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t('Optional')} />
        </Box>

        <Box mb="16px">
          <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
            {t('Amount')}
          </Text>
          <Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.0" />
        </Box>

        <Flex justifyContent="space-between" alignItems="center" mb="16px">
          <Box>
            <Text bold>{t('Use another owner')}</Text>
            <Text color="textSubtle" fontSize="12px">
              {t('Assign ownership of the lock to another wallet.')}
            </Text>
          </Box>
          <Checkbox checked={useAnotherOwner} onChange={() => setUseAnotherOwner((current) => !current)} scale="sm" />
        </Flex>

        {useAnotherOwner ? (
          <Box mb="16px">
            <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
              {t('Owner Address')}
            </Text>
            <Input value={ownerAddress} onChange={(event) => setOwnerAddress(event.target.value)} placeholder="0x..." />
          </Box>
        ) : null}

        <Flex justifyContent="space-between" alignItems="center" mb="16px">
          <Box>
            <Text bold>{t('Use vesting')}</Text>
            <Text color="textSubtle" fontSize="12px">
              {t('Release the lock gradually after TGE.')}
            </Text>
          </Box>
          <Checkbox checked={useVesting} onChange={() => setUseVesting((current) => !current)} scale="sm" />
        </Flex>

        {useVesting ? (
          <>
            <Box mb="16px">
              <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
                {t('TGE Date (UTC)')}
              </Text>
              <Input type="datetime-local" value={tgeDate} onChange={(event) => setTgeDate(event.target.value)} />
            </Box>
            <Flex mb="16px" flexDirection={['column', null, 'row']} style={{ gap: '16px' }}>
              <Box width="100%" style={{ flex: 1 }}>
                <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
                  {t('TGE Percent')}
                </Text>
                <Input inputMode="decimal" value={tgePercent} onChange={(event) => setTgePercent(event.target.value)} />
              </Box>
              <Box width="100%" style={{ flex: 1 }}>
                <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
                  {t('Cycle Release Percent')}
                </Text>
                <Input inputMode="decimal" value={cyclePercent} onChange={(event) => setCyclePercent(event.target.value)} />
              </Box>
            </Flex>
            <Box mb="16px">
              <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
                {t('Cycle (days)')}
              </Text>
              <Input inputMode="decimal" value={cycleDays} onChange={(event) => setCycleDays(event.target.value)} />
            </Box>
          </>
        ) : (
          <Box mb="16px">
            <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
              {t('Unlock Date (UTC)')}
            </Text>
            <Input type="datetime-local" value={unlockDate} onChange={(event) => setUnlockDate(event.target.value)} />
          </Box>
        )}

        <Flex justifyContent="space-between" mb="24px">
          <Text color="textSubtle">{t('Fee')}</Text>
          <Text bold>{t('%fee% PLAX', { fee: formatUnits(LOCK_FEE, 18) })}</Text>
        </Flex>

        {!account ? (
          <ConnectWalletButton width="100%" />
        ) : !isFeeApproved ? (
          <Button
            width="100%"
            onClick={handleApproveFee}
            disabled={!hasTokenLockerAddress || isApprovingFee}
            endIcon={isApprovingFee ? <AutoRenewIcon spin color="currentColor" /> : undefined}
          >
            {t('Enable PLAX')}
          </Button>
        ) : !isTokenApproved ? (
          <Button
            width="100%"
            onClick={handleApproveToken}
            disabled={!canCreate || isApprovingToken}
            endIcon={isApprovingToken ? <AutoRenewIcon spin color="currentColor" /> : undefined}
          >
            {t('Enable Token')}
          </Button>
        ) : (
          <Button
            width="100%"
            onClick={handleCreateLock}
            disabled={!canCreate || isCreating}
            endIcon={isCreating ? <AutoRenewIcon spin color="currentColor" /> : undefined}
          >
            {t('Create Lock')}
          </Button>
        )}

        {createdLockId ? (
          <Message variant="success" mt="24px">
            <MessageText>{t('Created lock ID: %id%', { id: createdLockId })}</MessageText>
          </Message>
        ) : null}
      </CardBody>
    </Card>
  )
}

const LocksList: React.FC<{ view: 'my-locks' | 'all-locks' }> = ({ view }) => {
  const { t } = useTranslation()
  const { address: account } = useAccount()
  const { chainId } = useActiveChainId()
  const { callWithGasPrice } = useCallWithGasPrice()
  const { toastError, toastSuccess } = useToast()
  const tokenLockerAddress = useMemo(() => getTokenLockerAddress(chainId), [chainId])
  const hasTokenLockerAddress = Boolean(tokenLockerAddress)
  const tokenLockerContract = useTokenLockerContract()
  const [withdrawingLockId, setWithdrawingLockId] = useState('')

  const { data: locks, mutate } = useSWR(
    tokenLockerContract && hasTokenLockerAddress && (view === 'all-locks' || account)
      ? ['tokenLockerLocks', view, account, tokenLockerAddress]
      : null,
    () =>
      view === 'my-locks'
        ? tokenLockerContract.getLocksByOwner(account, 0, LOCKS_PAGE_SIZE)
        : tokenLockerContract.getLocks(0, LOCKS_PAGE_SIZE),
  )

  const handleWithdraw = useCallback(
    async (lock: LockInfo) => {
      if (!tokenLockerContract) return
      const withdrawable = getWithdrawableAmount(lock)
      if (withdrawable.lte(0)) return

      setWithdrawingLockId(lock.id.toString())
      try {
        const tx = await callWithGasPrice(tokenLockerContract, 'withdraw', [lock.id, withdrawable])
        const receipt = await tx.wait()
        toastSuccess(t('Tokens Withdrawn'), <ToastDescriptionWithTx txHash={receipt.transactionHash} />)
        mutate()
      } catch (error) {
        console.error(error)
        toastError(t('Error'), t('Unable to withdraw tokens. Please try again.'))
      } finally {
        setWithdrawingLockId('')
      }
    },
    [callWithGasPrice, mutate, t, toastError, toastSuccess, tokenLockerContract],
  )

  if (!hasTokenLockerAddress) {
    return (
      <Message variant="warning">
        <MessageText>{t('Token locker contract address is not configured for this network yet.')}</MessageText>
      </Message>
    )
  }

  if (view === 'my-locks' && !account) {
    return <ConnectWalletButton />
  }

  return (
    <Card>
      <CardBody>
        <Heading scale="lg" mb="24px">
          {view === 'my-locks' ? t('My Locks') : t('All Locks')}
        </Heading>
        {locks?.length ? (
          <Flex flexDirection="column" style={{ gap: '12px' }}>
            {locks.map((lock: LockInfo) => (
              <LockRow
                key={lock.id.toString()}
                lock={lock}
                view={view}
                withdrawingLockId={withdrawingLockId}
                onWithdraw={handleWithdraw}
              />
            ))}
          </Flex>
        ) : (
          <Text color="textSubtle">{t('No locks found.')}</Text>
        )}
      </CardBody>
    </Card>
  )
}

const TokenLocker: React.FC<{ view: TokenLockerView }> = ({ view }) => {
  return (
    <Page>
      <Box maxWidth={view === 'create' ? '560px' : '920px'} mx="auto" width="100%">
        <TokenLockerTabs activeView={view} />
        {view === 'create' ? <CreateLock /> : <LocksList view={view} />}
      </Box>
    </Page>
  )
}

export default TokenLocker
