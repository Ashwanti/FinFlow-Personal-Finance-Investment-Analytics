const { z } = require("zod");

const { CATEGORY_KINDS } = require("../constants");

const name = z.string().trim().min(1, "Name is required").max(60);
const kind = z.enum(Object.values(CATEGORY_KINDS));
const icon = z.string().trim().min(1).max(8);
const color = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #16a34a");

const createCategorySchema = z.object({
  name,
  kind,
  icon: icon.optional(),
  color: color.optional(),
});

const updateCategorySchema = z
  .object({
    name: name.optional(),
    kind: kind.optional(),
    icon: icon.optional(),
    color: color.optional(),
    isArchived: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update",
  });

const listCategoriesSchema = z.object({
  kind: kind.optional(),
  includeArchived: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

module.exports = { createCategorySchema, updateCategorySchema, listCategoriesSchema };
