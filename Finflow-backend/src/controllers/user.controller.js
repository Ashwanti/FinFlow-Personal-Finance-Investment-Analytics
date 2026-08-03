const authService = require("../services/auth.service");

/** GET /api/me — the profile of whoever owns the access token. */
async function getMe(req, res) {
  res.status(200).json({ success: true, data: { user: req.user.toJSON() } });
}

/** PATCH /api/me — update display name, base currency or timezone. */
async function updateMe(req, res) {
  const user = await authService.updateProfile(req.user._id, req.validated.body);
  res.status(200).json({ success: true, data: { user } });
}

module.exports = { getMe, updateMe };
