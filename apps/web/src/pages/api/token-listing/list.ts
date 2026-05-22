import type { NextApiHandler } from 'next'
import { readListedTokens } from '../../../utils/tokenListingStorage'

const handler: NextApiHandler = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).json({
    name: 'PlaxSwap Listed Tokens',
    timestamp: new Date().toISOString(),
    version: {
      major: 1,
      minor: 0,
      patch: 0,
    },
    tokens: readListedTokens(),
  })
}

export default handler
