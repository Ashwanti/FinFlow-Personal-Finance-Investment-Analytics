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
 * @returns {Promise<{owner:string, fence:number}|null>} the lease if won, or
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
      {
        $set: { owner: OWNER_ID, acquiredAt: now, expiresAt },
        $inc: { fence: 1 },
      },
      { new: true, upsert: true, returnDocument: "after" }
    );

    return lock?.owner === OWNER_ID ? { owner: OWNER_ID, fence: lock.fence } : null;
  } catch (err) {
    // Upsert racing another upsert violates the unique index. That is the
    // lock working exactly as intended: the other process won.
    if (err.code === 11000) return null;
    throw err;
  }
}

/** Extend a lease this process still holds. Fails if it has moved on. */
async function renew(name, owner, ttlMs, fence = null) {
  const filter = { name, owner };
  if (fence !== null) filter.fence = fence;

  const result = await JobLock.updateOne(filter, {
    $set: { expiresAt: new Date(Date.now() + ttlMs) },
  });
  return result.matchedCount > 0;
}

/**
 * Whether this process still holds the lease it thinks it does.
 *
 * The check a long-running job should make before writing anything: expiry is
 * about wall-clock time, but the fence is about whether anyone else actually
 * took over.
 */
async function stillHolds(name, owner, fence) {
  const lock = await JobLock.findOne({ name, owner, fence }).select("_id expiresAt");
  return Boolean(lock) && lock.expiresAt > new Date();
}

/**
 * Release a lease, but only if this process still holds it — a lock that has
 * already expired and been taken over must not be cleared by the old owner.
 */
async function release(name, owner, { error = null, fence = null } = {}) {
  const filter = { name, owner };
  if (fence !== null) filter.fence = fence;

  await JobLock.updateOne(filter, {
    $set: {
      owner: null,
      expiresAt: new Date(0),
      lastFinishedAt: new Date(),
      lastError: error,
    },
  });
}

/**
 * Run `fn` if this process can win the lease; otherwise skip.
 *
 * The lease is renewed on a heartbeat for as long as `fn` runs, so a job that
 * legitimately outlives its TTL keeps the lock instead of having it stolen
 * mid-run. That closes the overlap window down to an actual stall — a process
 * frozen long enough to miss several heartbeats — and for that case `fn`
 * receives `stillHolds()` to check before doing anything it should not repeat.
 *
 * @returns {Promise<{ran:boolean, result?:*, skipped?:boolean}>}
 */
async function withLock(name, ttlMs, fn) {
  const lease = await acquire(name, ttlMs);
  if (!lease) return { ran: false, skipped: true };

  const { owner, fence } = lease;

  // Three beats per lease, so two consecutive misses still leave a margin.
  const heartbeat = setInterval(() => {
    renew(name, owner, ttlMs, fence).catch((err) =>
      console.warn(`Could not renew lease "${name}": ${err.message}`)
    );
  }, Math.max(Math.floor(ttlMs / 3), 1000));
  heartbeat.unref();

  try {
    const result = await fn({
      owner,
      fence,
      renew: () => renew(name, owner, ttlMs, fence),
      stillHolds: () => stillHolds(name, owner, fence),
    });
    await release(name, owner, { fence });
    return { ran: true, result };
  } catch (err) {
    await release(name, owner, { error: err.message, fence });
    throw err;
  } finally {
    clearInterval(heartbeat);
  }
}

module.exports = { acquire, renew, release, stillHolds, withLock, OWNER_ID };
