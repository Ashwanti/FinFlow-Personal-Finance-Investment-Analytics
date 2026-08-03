const { z } = require("zod");

// Normalise first, then validate, so " Ada@Example.COM " is accepted and
// stored as "ada@example.com".
const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address"));

const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters")
  .regex(/[a-zA-Z]/, "Password must contain at least one letter")
  .regex(/[0-9]/, "Password must contain at least one number");

const baseCurrency = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, "Use a 3-letter ISO currency code, e.g. INR")
  .transform((code) => code.toUpperCase());

const name = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters")
  .max(80, "Name cannot exceed 80 characters");

const registerSchema = z.object({
  name,
  email,
  password,
  baseCurrency: baseCurrency.optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
});

const loginSchema = z.object({
  email,
  password: z.string().min(1, "Password is required"),
});

// The refresh token normally arrives in an httpOnly cookie; the body is the
// fallback for clients that cannot use cookies (mobile apps, Postman).
const refreshSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: password,
});

const updateProfileSchema = z
  .object({
    name: name.optional(),
    baseCurrency: baseCurrency.optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update",
  });

module.exports = {
  registerSchema,
  loginSchema,
  refreshSchema,
  changePasswordSchema,
  updateProfileSchema,
};
