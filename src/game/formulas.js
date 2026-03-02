/**
 * @module game/formulas
 * @description All numerical formulas used throughout the game.
 */

const { getTypeMultiplier } = require('./type-chart');

/**
 * Calculate wild Pokémon HP: ceil(base_hp / 10 × 3)
 * @param {number} baseHp
 * @returns {number}
 */
function wildPokemonHp(baseHp) {
  return Math.ceil((baseHp / 10) * 3);
}

/**
 * Calculate battle HP: ceil((base_hp + bonus_hp) / 10 × 3)
 * @param {number} baseHp
 * @param {number} bonusHp
 * @returns {number}
 */
function battleHp(baseHp, bonusHp = 0) {
  return Math.ceil(((baseHp + bonusHp) / 10) * 3);
}

/**
 * Calculate catching-phase damage: ceil(base_attack × 0.1 × type_multiplier)
 * @param {number} baseAttack
 * @param {string} attackType
 * @param {string} defenseType
 * @returns {{ damage: number, multiplier: number }}
 */
function catchingDamage(baseAttack, attackType, defenseType) {
  const multiplier = getTypeMultiplier(attackType, defenseType);
  const damage = Math.ceil(baseAttack * 0.1 * multiplier);
  return { damage, multiplier };
}

/**
 * Calculate battle damage: ceil((base_attack + bonus_attack) × 0.1 × type_multiplier)
 * @param {number} baseAttack
 * @param {number} bonusAttack
 * @param {string} attackType
 * @param {string} defenseType
 * @returns {{ damage: number, multiplier: number }}
 */
function battleDamage(baseAttack, bonusAttack, attackType, defenseType) {
  const multiplier = getTypeMultiplier(attackType, defenseType);
  const damage = Math.ceil((baseAttack + bonusAttack) * 0.1 * multiplier);
  return { damage, multiplier };
}

/**
 * Effective speed for battle turn order: base_speed + bonus_speed
 * @param {number} baseSpeed
 * @param {number} bonusSpeed
 * @returns {number}
 */
function effectiveSpeed(baseSpeed, bonusSpeed = 0) {
  return baseSpeed + bonusSpeed;
}

/**
 * Determine who attacks first. Returns 'player1' or 'player2'.
 * Higher speed goes first; random if tied.
 * @param {number} speed1
 * @param {number} speed2
 * @returns {'player1'|'player2'}
 */
function determineTurnOrder(speed1, speed2) {
  if (speed1 > speed2) return 'player1';
  if (speed2 > speed1) return 'player2';
  return Math.random() < 0.5 ? 'player1' : 'player2';
}

/**
 * Sell price for a Pokémon: SELL_BASE_PRICE + evolution_number
 * @param {number} evolutionNumber
 * @param {number} sellBasePrice
 * @returns {number}
 */
function sellPrice(evolutionNumber, sellBasePrice = 2) {
  return sellBasePrice + evolutionNumber;
}

module.exports = {
  wildPokemonHp,
  battleHp,
  catchingDamage,
  battleDamage,
  effectiveSpeed,
  determineTurnOrder,
  sellPrice,
};
