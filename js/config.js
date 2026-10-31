/*
 * Runtime configuration.
 *
 * To use the included shared leaderboard server, run:
 *   node server/leaderboard-server.mjs
 * and open:
 *   http://localhost:4173/?online=1
 *
 * The online flag points the league at /api/leaderboard. You can also set it
 * explicitly before this module loads:
 *   window.PRISMA_CONFIG = { leaderboardApi: '/api/leaderboard' }
 *
 * With an empty leaderboardApi the game uses its local weekly league.
 */

const onlineFlag = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search).get('online')
  : null
const onlineRequested = onlineFlag !== null && onlineFlag !== '0' && onlineFlag !== 'false'

export const CONFIG = Object.assign(
  {
    leaderboardApi: onlineRequested ? '/api/leaderboard' : '',
    weekSalt: 'PRISMA-v1',
  },
  typeof window !== 'undefined' ? window.PRISMA_CONFIG || {} : {},
)
