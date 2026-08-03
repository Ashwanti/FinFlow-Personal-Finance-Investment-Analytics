const { DEFAULT_CATEGORIES } = require("../constants");
const Category = require("../models/category.model");
const Transaction = require("../models/transaction.model");
const ApiError = require("../utils/ApiError");

/** Called once at registration so a new account is immediately usable. */
async function seedDefaults(userId, session = null) {
  const docs = DEFAULT_CATEGORIES.map((category) => ({ ...category, user: userId }));
  return Category.insertMany(docs, { session, ordered: false });
}

async function list(userId, { kind, includeArchived = false } = {}) {
  const filter = { user: userId };
  if (kind) filter.kind = kind;
  if (!includeArchived) filter.isArchived = false;

  const categories = await Category.find(filter).sort({ kind: 1, name: 1 });
  return categories.map((category) => category.toJSON());
}

async function getOwned(userId, categoryId) {
  const category = await Category.findOne({ _id: categoryId, user: userId });
  if (!category) throw ApiError.notFound("Category not found");
  return category;
}

async function create(userId, input) {
  const exists = await Category.exists({ user: userId, kind: input.kind, name: input.name });
  if (exists) {
    throw ApiError.conflict(`A ${input.kind.toLowerCase()} category named "${input.name}" already exists`);
  }

  const category = await Category.create({ ...input, user: userId });
  return category.toJSON();
}

async function update(userId, categoryId, updates) {
  const category = await getOwned(userId, categoryId);

  // Changing kind under existing transactions would silently move spending into
  // the income column, so it is only allowed while the category is unused.
  if (updates.kind && updates.kind !== category.kind) {
    const used = await Transaction.exists({ user: userId, category: categoryId });
    if (used) {
      throw ApiError.conflict(
        "Cannot change the kind of a category that already has transactions"
      );
    }
  }

  Object.assign(category, updates);
  await category.save();
  return category.toJSON();
}

/**
 * Categories are archived rather than deleted once used, because deleting one
 * would orphan its transactions and quietly change historical reports.
 */
async function remove(userId, categoryId) {
  const category = await getOwned(userId, categoryId);
  const used = await Transaction.exists({ user: userId, category: categoryId });

  if (used) {
    category.isArchived = true;
    await category.save();
    return { deleted: false, archived: true };
  }

  await category.deleteOne();
  return { deleted: true, archived: false };
}

module.exports = { seedDefaults, list, getOwned, create, update, remove };
