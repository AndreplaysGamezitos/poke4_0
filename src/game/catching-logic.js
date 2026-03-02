/**
 * @module game/catching-logic
 * @description Catching-phase logic: spawning, catching, attacking wild Pokémon.
 */

const { wildPokemonHp, catchingDamage } = require('./formulas');
const config = require('../config');

/**
 * Spawn a random wild Pokémon from the current route's pool.
 * Avoids previously encountered Pokémon when possible.
 *
 * @param {import('mysql2/promise').PoolConnection} conn
 * @param {number} roomId
 * @param {number} routeNumber
 * @returns {Promise<Object>} The new wild_pokemon row joined with pokemon_dex
 */
async function spawnWildPokemon(conn, roomId, routeNumber) {
  // Get route id
  const [routes] = await conn.execute(
    'SELECT id FROM routes WHERE route_number = ?',
    [routeNumber]
  );
  if (routes.length === 0) {
    throw new Error(`Route ${routeNumber} not found`);
  }
  const routeId = routes[0].id;

  // Get all Pokémon on this route
  const [routePokemon] = await conn.execute(
    `SELECT rp.pokemon_id, pd.name, pd.base_hp, pd.sprite_url,
            pd.type_defense, pd.type_attack, pd.catch_rate
     FROM route_pokemon rp
     JOIN pokemon_dex pd ON pd.id = rp.pokemon_id
     WHERE rp.route_id = ?`,
    [routeId]
  );

  // Get already-encountered Pokémon this catching phase
  const [encountered] = await conn.execute(
    'SELECT pokemon_id FROM encountered_pokemon WHERE room_id = ? AND route_number = ?',
    [roomId, routeNumber]
  );
  const encounteredIds = new Set(encountered.map((e) => e.pokemon_id));

  // Filter to un-encountered Pokémon
  let pool = routePokemon.filter((p) => !encounteredIds.has(p.pokemon_id));
  // If all exhausted, allow repeats
  if (pool.length === 0) {
    pool = routePokemon;
  }

  // Pick random
  const chosen = pool[Math.floor(Math.random() * pool.length)];
  const hp = wildPokemonHp(chosen.base_hp);

  // Deactivate any current wild Pokémon
  await conn.execute(
    'UPDATE wild_pokemon SET is_active = FALSE WHERE room_id = ? AND is_active = TRUE',
    [roomId]
  );

  // Insert new wild Pokémon
  const [result] = await conn.execute(
    'INSERT INTO wild_pokemon (room_id, pokemon_id, current_hp, max_hp) VALUES (?, ?, ?, ?)',
    [roomId, chosen.pokemon_id, hp, hp]
  );

  // Track as encountered
  await conn.execute(
    'INSERT INTO encountered_pokemon (room_id, route_number, pokemon_id) VALUES (?, ?, ?)',
    [roomId, routeNumber, chosen.pokemon_id]
  );

  return {
    wild_pokemon_id: result.insertId,
    pokemon_id: chosen.pokemon_id,
    pokemon_name: chosen.name,
    sprite_url: chosen.sprite_url,
    hp,
    max_hp: hp,
    type_defense: chosen.type_defense,
    type_attack: chosen.type_attack,
    catch_rate: chosen.catch_rate,
  };
}

/**
 * Attempt to catch a wild Pokémon.
 * @param {number} catchRate - Percentage (0-100)
 * @param {boolean} useUltraBall
 * @returns {{ caught: boolean, diceRoll: number }}
 */
function attemptCatch(catchRate, useUltraBall) {
  if (useUltraBall) {
    return { caught: true, diceRoll: -1 };
  }
  const diceRoll = Math.floor(Math.random() * 100);
  return { caught: diceRoll < catchRate, diceRoll };
}

/**
 * Calculate attack result against a wild Pokémon.
 * @param {Object} attackerPokemon - player_pokemon joined with pokemon_dex
 * @param {Object} wildPokemon - wild_pokemon joined with pokemon_dex
 * @returns {{ damage: number, multiplier: number, newHp: number, defeated: boolean }}
 */
function calculateWildAttack(attackerPokemon, wildPokemon) {
  const { damage, multiplier } = catchingDamage(
    attackerPokemon.base_attack,
    attackerPokemon.type_attack,
    wildPokemon.type_defense
  );
  const newHp = Math.max(0, wildPokemon.current_hp - damage);
  return { damage, multiplier, newHp, defeated: newHp <= 0 };
}

/**
 * Check if a Pokémon should evolve (EXP >= EXP_TO_EVOLVE).
 * @param {Object} playerPokemon - player_pokemon joined with pokemon_dex
 * @returns {boolean}
 */
function shouldEvolve(playerPokemon) {
  return (
    playerPokemon.current_exp >= config.EXP_TO_EVOLVE &&
    playerPokemon.evolution_id !== null
  );
}

module.exports = {
  spawnWildPokemon,
  attemptCatch,
  calculateWildAttack,
  shouldEvolve,
};
