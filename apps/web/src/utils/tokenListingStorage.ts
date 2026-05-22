import fs from 'fs'
import path from 'path'
import { getAddress } from '@ethersproject/address'

export type ListedToken = {
  chainId: number
  address: string
  name: string
  symbol: string
  decimals: number
  logoURI: string
  listedAt: string
  paymentTxHash: string
  liquidityUSD: number
}

const DATA_DIR = path.join(process.cwd(), 'data')
const LOGO_DIR = path.join(process.cwd(), 'public', 'images', 'listed-tokens')
const LISTINGS_PATH = path.join(DATA_DIR, 'token-listings.json')

export const ensureListingStorage = () => {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.mkdirSync(LOGO_DIR, { recursive: true })
  if (!fs.existsSync(LISTINGS_PATH)) {
    fs.writeFileSync(LISTINGS_PATH, '[]\n')
  }
}

export const readListedTokens = (): ListedToken[] => {
  ensureListingStorage()
  try {
    return JSON.parse(fs.readFileSync(LISTINGS_PATH, 'utf8')) as ListedToken[]
  } catch {
    return []
  }
}

export const writeListedToken = (token: ListedToken) => {
  ensureListingStorage()
  const tokens = readListedTokens()
  const tokenAddress = getAddress(token.address)
  const nextTokens = [token, ...tokens.filter((item) => getAddress(item.address) !== tokenAddress)]
  fs.writeFileSync(LISTINGS_PATH, `${JSON.stringify(nextTokens, null, 2)}\n`)
}

export const saveTokenLogo = (address: string, logoDataUrl: string) => {
  ensureListingStorage()
  const [, mimeType, base64Data] = logoDataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=]+)$/) ?? []

  if (!mimeType || !base64Data) {
    throw new Error('Invalid logo image')
  }

  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg'
  const checksumAddress = getAddress(address)
  const filename = `${checksumAddress}.${extension}`
  fs.writeFileSync(path.join(LOGO_DIR, filename), Buffer.from(base64Data, 'base64'))

  return `/images/listed-tokens/${filename}`
}
