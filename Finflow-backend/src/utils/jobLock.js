const crypto = require("crypto");
const os = require("os");

const JobLock = require("../models/jobLock.model");

/**
 * Acquire-or-skip leasing for background jobs.
 *
 * The whole thing rests on one atomic update: claim the lock only if nobody
 * holds it or the current lease has expired. MongoDB applies that condition and
 * the write together, so two instances racing on the same tick cannot both win
 * — the loser's filter simply matches nothing.
 */

// Distinct per process, so two instances on one host still differ.
const OWNER_ID = `${os.hostname()}:${process.pid}:${crypto.randomBytes(4).toString("hex")}`;

/**
 * @returns {Promise<string|null>} the owner token if the lease was won, or
 *   null if another process already holds it.
 */
async function acquire(name, ttlMs) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);

  try {
    const lock = await JobLock.findOneAndUpdate(
      {
        name,
        // Free if never held, or if the holder's lease has run out — the
        // clause that stops a crashed process blocking the job forever.
        $or: [{ expiresAt: { $lte: now } }, { owner: null }],
      },
      { $set: { owner: OWNER_ID, acquiredAt: now, expiresAt } },
      { new: true, upsert: true, returnDocument: "after" }
    );

    return lock?.owner === OWNER_ID ? OWNER_ID : null;
  } catch (err) {
    // Upsert racing another upsert violates the unique index. That is the
    // lock working exactly as intended: the other process won.
    if (err.code === 11000) return null;
    throw err;
  }
}

/** Extend a lease this process still holds. For runs that outlive the TTL. */
async function renew(name, owner, ttlMs) {
  const result = await JobLock.updateOne(
    { name, owner },
    { $set: { expiresAt: new Date(Date.now() + ttlMs) } }
  );
  return result.modifiedCount > 0;
}

/**
 * Release a lease, but only if this process still holds it — a lock that has
 * already expired and been taken over must not be cleared by the old owner.
 */
async function release(name, owner, { error = null } = {}) {
  await JobLock.updateOne(
    { name, owner },
    {
      $set: {
        owner: null,
        expiresAt: new Date(0),
        lastFinishedAt: new Date(),
        lastError: error,
      },
    }
  );
}

/**
 * Run `fn` if this process can win the lease; otherwise skip.
 *
 * @returns {Promise<{ran:boolean, result?:*, skipped?:boolean}>}
 */
async function withLock(name, ttlMs, fn) {
  const owner = await acquire(name, ttlMs);
  if (!owner) return { ran: false, skipped: true };

  try {
    const result = await fn({ owner, renew: () => renew(name, owner, ttlMs) });
    await release(name, owner);
    return { ran: true, result };
  } catch (err) {
    await release(name, owner, { error: err.message });
    throw err;
  }
}

module.exports = { acquire, renew, release, withLock, OWNER_ID };
