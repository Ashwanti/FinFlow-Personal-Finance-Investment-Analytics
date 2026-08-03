const mongoose = require("mongoose");

const { TRANSACTION_TYPES, TRANSFER_DIRECTIONS } = require("../constants");
const Account = require("../models/account.model");
const Category = require("../models/category.model");
const Transaction = require("../models/transaction.model");
const ApiError = require("../utils/ApiError");
const { signedMinor } = require("../utils/money");
const { withTransaction } = require("../utils/withTransaction");

const POPULATE = [
  { path: "account", select: "name type currency" },
  { path: "counterAccount", select: "name type currency" },
  { path: "category", select: "name kind icon color" },
];

const applyBalance = (accountId, deltaMinor, session) =>
  Account.updateOne({ _id: accountId }, { $inc: { balanceMinor: deltaMinor } }, { session });

async function loadAccount(userId, accountId, session, label = "Account") {
  const account = await Account.findOne({ _id: accountId, user: userId }).session(session);
  if (!account) throw ApiError.notFound(`${label} not found`);
  if (account.isArchived) {
    throw ApiError.badRequest(`${label} "${account.name}" is archived`);
  }
  return account;
}

/** An expense must use an expense category, income an income category. */
async function loadCategory(userId, categoryId, type) {
  const category = await Category.findOne({ _id: categoryId, user: userId });
  if (!category) throw ApiError.notFound("Category not found");
  if (category.kind !== type) {
    throw ApiError.badRequest(
      `Category "${category.name}" is an ${category.kind.toLowerCase()} category and cannot be used on an ${type.toLowerCase()} transaction`
    );
  }
  return category;
}

const reload = (id) => Transaction.findById(id).populate(POPULATE);

// ---------------------------------------------------------------------------
// Income & expense
// ---------------------------------------------------------------------------

async function create(userId, input) {
  if (input.type === TRANSACTION_TYPES.TRANSFER) {
    throw ApiError.badRequest("Use POST /api/transactions/transfer to record a transfer");
  }

  const created = await withTransaction(async (session) => {
    const account = await loadAccount(userId, input.accountId, session);
    const category = await loadCategory(userId, input.categoryId, input.type);

    const [transaction] = await Transaction.create(
      [
        {
          user: userId,
          account: account._id,
          category: category._id,
          type: input.type,
          amountMinor: input.amountMinor,
          currency: account.currency,
          description: input.description ?? "",
          notes: input.notes ?? "",
          date: input.date,
          tags: input.tags ?? [],
        },
      ],
      { session }
    );

    await applyBalance(account._id, signedMinor(transaction), session);
    return transaction;
  });

  return (await reload(created._id)).toJSON();
}

async function update(userId, transactionId, updates) {
  const updated = await withTransaction(async (session) => {
    const transaction = await Transaction.findOne({ _id: transactionId, user: userId }).session(
      session
    );
    if (!transaction) throw ApiError.notFound("Transaction not found");

    if (transaction.type === TRANSACTION_TYPES.TRANSFER) {
      throw ApiError.badRequest(
        "Use PATCH /api/transactions/transfer/:groupId to edit a transfer"
      );
    }
    if (updates.type === TRANSACTION_TYPES.TRANSFER) {
      throw ApiError.badRequest("A transaction cannot be converted into a transfer");
    }

    // Back the old effect out before applying the new one, so any combination of
    // changed account, type and amount lands on the right balances.
    await applyBalance(transaction.account, -signedMinor(transaction), session);

    const nextType = updates.type ?? transaction.type;

    if (updates.accountId) {
      const account = await loadAccount(userId, updates.accountId, session);
      transaction.account = account._id;
      transaction.currency = account.currency;
    }

    // A type flip invalidates the existing category, so one must be supplied.
    if (updates.categoryId || nextType !== transaction.type) {
      const categoryId = updates.categoryId ?? transaction.category;
      const category = await loadCategory(userId, categoryId, nextType);
      transaction.category = category._id;
    }

    transaction.type = nextType;
    for (const field of ["amountMinor", "description", "notes", "date", "tags"]) {
      if (updates[field] !== undefined) transaction[field] = updates[field];
    }

    await transaction.save({ session });
    await applyBalance(transaction.account, signedMinor(transaction), session);

    return transaction;
  });

  return (await reload(updated._id)).toJSON();
}

/** Deleting either leg of a transfer removes both — a one-sided transfer is corruption. */
async function remove(userId, transactionId) {
  return withTransaction(async (session) => {
    const transaction = await Transaction.findOne({ _id: transactionId, user: userId }).session(
      session
    );
    if (!transaction) throw ApiError.notFound("Transaction not found");

    if (transaction.transferGroupId) {
      return removeTransferGroup(userId, transaction.transferGroupId, session);
    }

    await applyBalance(transaction.account, -signedMinor(transaction), session);
    await Transaction.deleteOne({ _id: transaction._id }, { session });

    return { deleted: 1 };
  });
}

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

/**
 * Writes both legs and moves both balances as one unit.
 *
 * Cross-currency transfers need an explicit destination amount — the server
 * will not invent an exchange rate, because a wrong guess silently corrupts
 * net worth.
 */
async function createTransfer(userId, input) {
  if (String(input.fromAccountId) === String(input.toAccountId)) {
    throw ApiError.badRequest("Source and destination accounts must be different");
  }

  const groupId = await withTransaction(async (session) => {
    const from = await loadAccount(userId, input.fromAccountId, session, "Source account");
    const to = await loadAccount(userId, input.toAccountId, session, "Destination account");

    const sameCurrency = from.currency === to.currency;
    if (!sameCurrency && input.toAmountMinor === undefined) {
      throw ApiError.badRequest(
        `Transferring ${from.currency} to ${to.currency} requires 'toAmountMinor' — the amount that lands in the destination account`
      );
    }

    const transferGroupId = new mongoose.Types.ObjectId();
    const toAmountMinor = input.toAmountMinor ?? input.amountMinor;

    const shared = {
      user: userId,
      type: TRANSACTION_TYPES.TRANSFER,
      category: null,
      description: input.description ?? "",
      notes: input.notes ?? "",
      date: input.date,
      tags: input.tags ?? [],
      transferGroupId,
    };

    await Transaction.create(
      [
        {
          ...shared,
          account: from._id,
          counterAccount: to._id,
          transferDirection: TRANSFER_DIRECTIONS.OUT,
          amountMinor: input.amountMinor,
          currency: from.currency,
        },
        {
          ...shared,
          account: to._id,
          counterAccount: from._id,
          transferDirection: TRANSFER_DIRECTIONS.IN,
          amountMinor: toAmountMinor,
          currency: to.currency,
        },
      ],
      { session, ordered: true }
    );

    await applyBalance(from._id, -input.amountMinor, session);
    await applyBalance(to._id, toAmountMinor, session);

    return transferGroupId;
  });

  return getTransfer(userId, groupId);
}

async function getTransfer(userId, groupId) {
  const legs = await Transaction.find({ user: userId, transferGroupId: groupId })
    .populate(POPULATE)
    .sort({ transferDirection: -1 }); // OUT before IN

  if (legs.length === 0) throw ApiError.notFound("Transfer not found");

  const out = legs.find((leg) => leg.transferDirection === TRANSFER_DIRECTIONS.OUT);
  const into = legs.find((leg) => leg.transferDirection === TRANSFER_DIRECTIONS.IN);

  return {
    transferGroupId: groupId,
    date: out.date,
    description: out.description,
    notes: out.notes,
    tags: out.tags,
    from: { account: out.account, amountMinor: out.amountMinor, currency: out.currency },
    to: { account: into.account, amountMinor: into.amountMinor, currency: into.currency },
    legs: legs.map((leg) => leg.toJSON()),
  };
}

async function updateTransfer(userId, groupId, updates) {
  await withTransaction(async (session) => {
    const legs = await Transaction.find({ user: userId, transferGroupId: groupId }).session(session);
    if (legs.length === 0) throw ApiError.notFound("Transfer not found");

    for (const leg of legs) {
      const isOut = leg.transferDirection === TRANSFER_DIRECTIONS.OUT;
      const nextAmount = isOut ? updates.amountMinor : updates.toAmountMinor ?? updates.amountMinor;

      if (nextAmount !== undefined && nextAmount !== leg.amountMinor) {
        await applyBalance(leg.account, -signedMinor(leg), session);
        leg.amountMinor = nextAmount;
        await applyBalance(leg.account, signedMinor(leg), session);
      }

      for (const field of ["description", "notes", "date", "tags"]) {
        if (updates[field] !== undefined) leg[field] = updates[field];
      }

      await leg.save({ session });
    }
  });

  return getTransfer(userId, groupId);
}

async function removeTransferGroup(userId, groupId, session) {
  const legs = await Transaction.find({ user: userId, transferGroupId: groupId }).session(session);
  if (legs.length === 0) throw ApiError.notFound("Transfer not found");

  for (const leg of legs) {
    await applyBalance(leg.account, -signedMinor(leg), session);
  }

  await Transaction.deleteMany({ user: userId, transferGroupId: groupId }, { session });
  return { deleted: legs.length };
}

const removeTransfer = (userId, groupId) =>
  withTransaction((session) => removeTransferGroup(userId, groupId, session));

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function buildFilter(userId, query) {
  const filter = { user: userId };

  if (query.type) filter.type = query.type;
  if (query.accountId) filter.account = query.accountId;
  if (query.categoryId) filter.category = query.categoryId;
  if (query.tags?.length) filter.tags = { $all: query.tags };

  if (query.from || query.to) {
    filter.date = {};
    if (query.from) filter.date.$gte = query.from;
    if (query.to) filter.date.$lte = query.to;
  }

  if (query.minAmountMinor !== undefined || query.maxAmountMinor !== undefined) {
    filter.amountMinor = {};
    if (query.minAmountMinor !== undefined) filter.amountMinor.$gte = query.minAmountMinor;
    if (query.maxAmountMinor !== undefined) filter.amountMinor.$lte = query.maxAmountMinor;
  }

  if (query.search) {
    // Escaped so a user searching for "a+b" does not send an invalid regex.
    const safe = query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { description: { $regex: safe, $options: "i" } },
      { notes: { $regex: safe, $options: "i" } },
    ];
  }

  return filter;
}

async function list(userId, query) {
  const filter = buildFilter(userId, query);
  const { page = 1, limit = 25 } = query;
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    Transaction.find(filter)
      .populate(POPULATE)
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Transaction.countDocuments(filter),
  ]);

  return {
    items: items.map((item) => item.toJSON()),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasNext: skip + items.length < total,
    },
  };
}

async function get(userId, transactionId) {
  const transaction = await Transaction.findOne({ _id: transactionId, user: userId }).populate(
    POPULATE
  );
  if (!transaction) throw ApiError.notFound("Transaction not found");
  return transaction.toJSON();
}

module.exports = {
  create,
  update,
  remove,
  list,
  get,
  createTransfer,
  getTransfer,
  updateTransfer,
  removeTransfer,
  buildFilter,
};
