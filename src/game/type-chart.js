/**
 * @module game/type-chart
 * @description Type effectiveness lookup. 18-type chart including Fairy.
 */

const typeChartData = require('../data/type-chart.json');

/**
 * Get the type multiplier for attacker's type vs defender's type.
 * @param {string} attackType  - Attacker's `type_attack`
 * @param {string} defenseType - Defender's `type_defense`
 * @returns {number} Multiplier (0.1 = immune, 0.5 = resist, 1.0 = neutral, 2.0 = super effective)
 */
function getTypeMultiplier(attackType, defenseType) {
  if (!attackType || !defenseType) return 1.0;
  const atk = attackType.toLowerCase();
  const def = defenseType.toLowerCase();
  if (typeChartData[atk] && typeChartData[atk][def] !== undefined) {
    return typeChartData[atk][def];
  }
  return 1.0;
}

module.exports = { getTypeMultiplier };
