/**
 * @module game/state-machine
 * @description Central game state machine.
 * ALL phase transitions go through `transitionTo()` — no scattered UPDATEs.
 */

const { getConnection } = require('../db');
const { broadcast } = require('../websocket/broadcaster');

/**
 * Valid state transitions.
 * Key = current state, value = set of allowed next states.
 */
const TRANSITIONS = {
  lobby:      new Set(['initial']),
  initial:    new Set(['catching']),
  catching:   new Set(['town']),
  town:       new Set(['tournament']),
  tournament: new Set(['battle', 'catching', 'finished']),
  battle:     new Set(['tournament']),
  finished:   new Set(), // terminal
};

/**
 * Check whether a transition is valid.
 * @param {string} current
 * @param {string} next
 * @returns {boolean}
 */
function isValidTransition(current, next) {
  return TRANSITIONS[current]?.has(next) ?? false;
}

/**
 * Perform an atomic state transition on a room.
 *
 * 1. Acquires a connection and starts a transaction.
 * 2. Locks the room row with SELECT … FOR UPDATE.
 * 3. Validates the transition.
 * 4. Calls `setupFn(conn, room)` for phase-specific setup.
 * 5. Updates `rooms.game_state`.
 * 6. Commits.
 * 7. Broadcasts `phase_changed`.
 *
 * @param {number}   roomId    - Room ID
 * @param {string}   nextState - Target game state
 * @param {Function} [setupFn] - `async (conn, roomRow) => extraBroadcastData`
 * @returns {Promise<Object>}  The updated room row
 * @throws Will throw and rollback on any error.
 */
async function transitionTo(roomId, nextState, setupFn) {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();

    // Lock room row
    const [rooms] = await conn.execute(
      'SELECT * FROM rooms WHERE id = ? FOR UPDATE',
      [roomId]
    );
    if (rooms.length === 0) {
      throw Object.assign(new Error('Room not found'), { code: 'ROOM_NOT_FOUND' });
    }
    const room = rooms[0];

    // Validate
    if (!isValidTransition(room.game_state, nextState)) {
      throw Object.assign(
        new Error(`Invalid transition: ${room.game_state} → ${nextState}`),
        { code: 'INVALID_PHASE' }
      );
    }

    // Phase-specific setup
    let extraData = {};
    if (setupFn) {
      extraData = (await setupFn(conn, room)) || {};
    }

    // Update state
    await conn.execute(
      'UPDATE rooms SET game_state = ? WHERE id = ?',
      [nextState, roomId]
    );

    await conn.commit();

    // Broadcast after commit
    broadcast(room.room_code, 'phase_changed', {
      new_phase: nextState,
      ...extraData,
    });

    return { ...room, game_state: nextState };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { isValidTransition, transitionTo };
