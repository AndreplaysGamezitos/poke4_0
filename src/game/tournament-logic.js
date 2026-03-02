/**
 * @module game/tournament-logic
 * @description Bracket generation, match management, gym leader team building.
 */

const gymLeaders = require('../data/gym-leaders.json');
const { query } = require('../db');

/**
 * Generate tournament brackets for a round.
 *
 * Rules:
 *  - Sort players by badges (desc)
 *  - If not all equal: top 2 badge holders are paired together, rest randomized
 *  - If all equal: fully random pairings
 *  - Odd player count: last unpaired fights gym leader NPC
 *
 * @param {Object[]} players - Array of player rows (must have id, badges)
 * @param {number}   route   - Current route number (for NPC gym leader)
 * @param {boolean}  [isTiebreaker=false]
 * @returns {Array<{player1_id:number|null, player2_id:number|null, is_npc_battle:boolean, npc_route:number|null}>}
 */
function generateBrackets(players, route, isTiebreaker = false) {
  if (players.length < 2 && !isTiebreaker) {
    throw new Error('Not enough players for a tournament');
  }

  const sorted = [...players].sort((a, b) => b.badges - a.badges);
  const allEqual = sorted.every((p) => p.badges === sorted[0].badges);

  let ordered;
  if (allEqual) {
    // Fully random
    ordered = shuffleArray([...sorted]);
  } else {
    // Top 2 badge holders paired first, rest randomized
    const top2 = sorted.slice(0, 2);
    const rest = shuffleArray(sorted.slice(2));
    ordered = [...top2, ...rest];
  }

  const matches = [];
  let matchIndex = 0;

  for (let i = 0; i < ordered.length - 1; i += 2) {
    matches.push({
      match_index: matchIndex++,
      player1_id: ordered[i].id,
      player2_id: ordered[i + 1].id,
      is_npc_battle: false,
      npc_route: null,
      is_tiebreaker: isTiebreaker,
    });
  }

  // Odd player → NPC battle
  if (ordered.length % 2 === 1) {
    const lastPlayer = ordered[ordered.length - 1];
    matches.push({
      match_index: matchIndex,
      player1_id: lastPlayer.id,
      player2_id: null,
      is_npc_battle: true,
      npc_route: route,
      is_tiebreaker: isTiebreaker,
    });
  }

  return matches;
}

/**
 * Get gym leader data for a given route.
 * @param {number} route
 * @returns {Object}
 */
function getGymLeader(route) {
  const clamped = Math.min(route, 9);
  const leader = gymLeaders.find((l) => l.route === clamped);
  return leader || gymLeaders[gymLeaders.length - 1]; // fallback to Lance
}

/**
 * Build a gym leader team from the database.
 * Looks up Pokémon by name to get their dex IDs and stats.
 * @param {number} route
 * @returns {Promise<Object[]>} Array of pokemon_dex rows
 */
async function buildGymLeaderTeam(route) {
  const leader = getGymLeader(route);
  const names = leader.team;

  // Look up each Pokémon by name
  const placeholders = names.map(() => '?').join(',');
  const [rows] = await query(
    `SELECT * FROM pokemon_dex WHERE name IN (${placeholders})`,
    names
  );

  // Maintain team order (names may repeat, e.g., Brock has 2 Geodudes)
  const byName = {};
  for (const row of rows) {
    byName[row.name] = row;
  }

  return names.map((n) => {
    const p = byName[n];
    if (!p) throw new Error(`Gym leader Pokémon "${n}" not found in pokemon_dex`);
    return { ...p };
  });
}

/**
 * Check win condition after tournament round.
 * @param {Object[]} players - player rows with badges
 * @param {number}   badgesToWin
 * @returns {{ hasWinner: boolean, winners: Object[] }}
 */
function checkWinCondition(players, badgesToWin) {
  const winners = players.filter((p) => p.badges >= badgesToWin);
  return { hasWinner: winners.length > 0, winners };
}

/**
 * Fisher-Yates shuffle (in-place).
 * @template T
 * @param {T[]} arr
 * @returns {T[]}
 */
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

module.exports = {
  generateBrackets,
  getGymLeader,
  buildGymLeaderTeam,
  checkWinCondition,
  shuffleArray,
};
