/**
 * @module game/town-logic
 * @description Town-phase logic: buying, selling, evolution, mega evolution.
 */

const config = require('../config');
const { sellPrice } = require('./formulas');

/** Shop item definitions keyed by item code. */
const SHOP_ITEMS = {
  evo_soda:     { price: config.PRICE_EVO_SODA,     label: 'Evo Soda' },
  ultra_ball:   { price: config.PRICE_ULTRA_BALL,    label: 'Ultra Ball' },
  mega_stone:   { price: config.PRICE_MEGA_STONE,    label: 'Mega Stone' },
  hp_boost:     { price: config.PRICE_HP_BOOST,      label: 'HP Boost' },
  attack_boost: { price: config.PRICE_ATTACK_BOOST,  label: 'Attack Boost' },
  speed_boost:  { price: config.PRICE_SPEED_BOOST,   label: 'Speed Boost' },
};

/**
 * Validate a purchase. Returns an error string or null if valid.
 * @param {string} item
 * @param {Object} player   - player row
 * @param {Object} [activePokemon] - active player_pokemon joined with dex (needed for evo_soda, mega_stone, boosts)
 * @param {number} teamSize
 * @returns {string|null} Error message or null
 */
function validatePurchase(item, player, activePokemon, teamSize) {
  const shopItem = SHOP_ITEMS[item];
  if (!shopItem) return 'Invalid item';
  if (player.money < shopItem.price) return 'Not enough money';

  if (item === 'mega_stone') {
    if (player.has_used_mega_stone) return 'Already used Mega Stone this game';
    if (!activePokemon) return 'No active Pokémon';
    if (!activePokemon.has_mega) return 'This Pokémon cannot Mega Evolve';
    if (activePokemon.mega_evolution_id === null) return 'This Pokémon cannot Mega Evolve';
  }

  if (item === 'evo_soda' || item === 'hp_boost' || item === 'attack_boost' || item === 'speed_boost') {
    if (!activePokemon) return 'No active Pokémon';
  }

  return null;
}

/**
 * Validate a sell. Returns error string or null.
 * @param {number} teamSize
 * @returns {string|null}
 */
function validateSell(teamSize) {
  if (teamSize <= 1) return 'Cannot sell last Pokémon';
  return null;
}

/**
 * Calculate the sell price for a Pokémon.
 * @param {number} evolutionNumber
 * @returns {number}
 */
function getSellPrice(evolutionNumber) {
  return sellPrice(evolutionNumber, config.SELL_BASE_PRICE);
}

/**
 * Check if buying evo_soda triggers an evolution.
 * @param {number} currentExp  - Current EXP (BEFORE adding 1)
 * @param {number|null} evolutionId
 * @returns {boolean}
 */
function willEvolve(currentExp, evolutionId) {
  return (currentExp + 1) >= config.EXP_TO_EVOLVE && evolutionId !== null;
}

module.exports = {
  SHOP_ITEMS,
  validatePurchase,
  validateSell,
  getSellPrice,
  willEvolve,
};
