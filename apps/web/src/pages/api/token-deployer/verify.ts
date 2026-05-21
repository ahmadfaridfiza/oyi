import type { NextApiRequest, NextApiResponse } from 'next'
import path from 'path'
import { readFileSync } from 'fs'
import { defaultAbiCoder } from '@ethersproject/abi'
import { z } from 'zod'

const ETHERSCAN_V2_API_ENDPOINT = 'https://api.etherscan.io/v2/api'
const COMPILER_VERSION = 'v0.8.20+commit.a1b79de6'
const CONTRACT_SOURCE_PATHS = [
  path.resolve(process.cwd(), '../../contracts/token-deployer/PlaxTokenDeployer.sol'),
  path.resolve(process.cwd(), 'contracts/token-deployer/PlaxTokenDeployer.sol'),
]

const zVerifyPayload = z.object({
  chainId: z.union([z.literal(137), z.literal(80001)]),
  tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  name: z.string().min(1),
  symbol: z.string().min(1),
  decimals: z.number().int().min(0).max(18),
  totalSupply: z.string().regex(/^\d+$/),
  mintable: z.boolean(),
  burnable: z.boolean(),
  owner: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
})

type VerifyResponse = {
  guid?: string
  message?: string
  result?: string
  error?: string
}

const getSourceCode = () => {
  const sourcePath = CONTRACT_SOURCE_PATHS.find((candidate) => {
    try {
      readFileSync(candidate, 'utf8')
      return true
    } catch {
      return false
    }
  })

  if (!sourcePath) {
    throw new Error('PlaxTokenDeployer source file not found')
  }

  return readFileSync(sourcePath, 'utf8')
}

const getStandardJsonInput = (sourceCode: string) =>
  JSON.stringify({
    language: 'Solidity',
    sources: {
      'PlaxTokenDeployer.sol': {
        content: sourceCode,
      },
    },
    settings: {
      optimizer: {
        enabled: false,
        runs: 200,
      },
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode', 'metadata'],
        },
      },
    },
  })

export default async function handler(req: NextApiRequest, res: NextApiResponse<VerifyResponse>) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const apiKey = process.env.ETHERSCAN_API_KEY || process.env.POLYGONSCAN_API_KEY || process.env.POLYGONSCAN_APIKEY
  if (!apiKey) {
    res.status(500).json({ error: 'Missing ETHERSCAN_API_KEY env variable' })
    return
  }

  const parsed = zVerifyPayload.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid verification payload' })
    return
  }

  try {
    const sourceCode = getSourceCode()
    const constructorArguments = defaultAbiCoder
      .encode(
        ['string', 'string', 'uint8', 'uint256', 'bool', 'bool', 'address'],
        [
          parsed.data.name,
          parsed.data.symbol,
          parsed.data.decimals,
          parsed.data.totalSupply,
          parsed.data.mintable,
          parsed.data.burnable,
          parsed.data.owner,
        ],
      )
      .replace(/^0x/, '')

    const params = new URLSearchParams({
      apikey: apiKey,
      chainid: String(parsed.data.chainId),
      module: 'contract',
      action: 'verifysourcecode',
      codeformat: 'solidity-standard-json-input',
      sourceCode: getStandardJsonInput(sourceCode),
      contractaddress: parsed.data.tokenAddress,
      contractname: 'PlaxTokenDeployer.sol:PlaxCreatedToken',
      compilerversion: COMPILER_VERSION,
      optimizationUsed: '0',
      runs: '200',
      constructorArguments,
      licenseType: '3',
    })

    const response = await fetch(ETHERSCAN_V2_API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })
    const body = (await response.json()) as { status?: string; message?: string; result?: string }

    if (!response.ok || body.status === '0') {
      res.status(200).json({
        message: body.message,
        result: body.result,
        error: body.result || body.message || 'Polygonscan verification submit failed',
      })
      return
    }

    res.status(200).json({
      guid: body.result,
      message: body.message,
      result: body.result,
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to submit token verification' })
  }
}
