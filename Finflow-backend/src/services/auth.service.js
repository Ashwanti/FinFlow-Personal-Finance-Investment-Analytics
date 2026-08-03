const bcrypt = require("bcryptjs");

const env = require("../config/env");
const User = require("../models/user.model");
const ApiError = require("../utils/ApiError");
const categoryService = require("./category.service");
const tokenService = require("./token.service");

// Compared against when a login hits an unknown email, so the response takes
// roughly as long as a real password check and does not leak which addresses
// are registered.
let timingGuardHash = null;
async function getTimingGuardHash() {
  if (!timingGuardHash) {
    timingGuardHash = await bcrypt.hash("finflow-timing-guard", env.bcryptRounds);
  }
  return timingGuardHash;
}

async function issueSession(user, context) {
  const accessToken = tokenService.signAccessToken(user);
  const refreshToken = await tokenService.issueRefreshToken(user, context);
  return { user: user.toJSON(), accessToken, refreshToken };
}

async function register(input, context = {}) {
  const existing = await User.exists({ email: input.email });
  if (existing) {
    throw ApiError.conflict("An account with that email already exists");
  }

  const user = await User.create({
    name: input.name,
    email: input.email,
    passwordHash: await User.hashPassword(input.password),
    ...(input.baseCurrency && { baseCurrency: input.baseCurrency }),
    ...(input.timezone && { timezone: input.timezone }),
  });

  // A user with no categories cannot record a single transaction, so the
  // defaults ship with the account. Failing to seed them is not worth losing a
  // successful registration over — they can be created by hand.
  try {
    await categoryService.seedDefaults(user._id);
  } catch (err) {
    console.error("Failed to seed default categories:", err.message);
  }

  return issueSession(user, context);
}

async function login({ email, password }, context = {}) {
  const user = await User.findOne({ email }).select("+passwordHash");

  const passwordMatches = user
    ? await user.comparePassword(password)
    : await bcrypt.compare(password, await getTimingGuardHash());

  // One message for both cases — telling the caller which half was wrong hands
  // an attacker a way to enumerate accounts.
  if (!user || !passwordMatches) {
    throw ApiError.unauthorized("Invalid email or password");
  }

  user.lastLoginAt = new Date();
  await user.save();

  return issueSession(user, context);
}

async function refresh(token, context = {}) {
  const { user, accessToken, refreshToken } = await tokenService.rotateRefreshToken(token, context);
  return { user: user.toJSON(), accessToken, refreshToken };
}

async function logout(token) {
  await tokenService.revokeRefreshToken(token);
}

async function logoutAll(userId) {
  const revoked = await tokenService.revokeAllForUser(userId);
  return { revoked };
}

/**
 * Changing a password invalidates every other session, on the assumption that
 * the reason for the change may be a suspected compromise. The caller is handed
 * a fresh pair so the current device stays logged in.
 */
async function changePassword(userId, { currentPassword, newPassword }, context = {}) {
  const user = await User.findById(userId).select("+passwordHash");
  if (!user) {
    throw ApiError.unauthorized("User no longer exists");
  }

  if (!(await user.comparePassword(currentPassword))) {
    throw ApiError.unauthorized("Current password is incorrect");
  }

  if (await user.comparePassword(newPassword)) {
    throw ApiError.badRequest("New password must be different from the current one");
  }

  user.passwordHash = await User.hashPassword(newPassword);
  await user.save();

  await tokenService.revokeAllForUser(user._id);

  return issueSession(user, context);
}

async function updateProfile(userId, updates) {
  const user = await User.findByIdAndUpdate(userId, updates, {
    returnDocument: "after",
    runValidators: true,
  });

  if (!user) {
    throw ApiError.notFound("User not found");
  }

  return user.toJSON();
}

module.exports = {
  register,
  login,
  refresh,
  logout,
  logoutAll,
  changePassword,
  updateProfile,
};
