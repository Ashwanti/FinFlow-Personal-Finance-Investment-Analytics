/* eslint-disable no-console */
/**
 * Populates the database with a realistic demo account.
 *
 *   npm run seed
 *
 * Six months of salary, rent, groceries and transfers for
 * demo@finflow.test / Demo1234. Re-running wipes and rebuilds that user's
 * data, so it is safe to run repeatedly; no other user is touched.
 *
 * Everything is written through the real services, so account balances are
 * produced by the same code path the API uses rather than being faked.
 */
require("../src/config/env");

const { connectDB, disconnectDB } = require("../src/config/db");
const Account = require("../src/models/account.model");
const Category = require("../src/models/category.model");
const Transaction = require("../src/models/transaction.model");
const User = require("../src/models/user.model");
const accountService = require("../src/services/account.service");
const analyticsService = require("../src/services/analytics.service");
const categoryService = require("../src/services/category.service");
const transactionService = require("../src/services/transaction.service");
const { formatMinor } = require("../src/utils/money");

const DEMO_EMAIL = "demo@finflow.test";
const DEMO_PASSWORD = "Demo1234";
const MONTHS = 6;

// Seeded PRNG so every run produces the same demo data.
let seed = 42;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const between = (min, max) => Math.floor(random() * (max - min + 1)) + min;
const pick = (list) => list[Math.floor(random() * list.length)];

async function main() {
  await connectDB();

  let user = await User.findOne({ email: DEMO_EMAIL });

  if (user) {
    console.log("Existing demo user found — clearing its data...");
    await Promise.all([
      Transaction.deleteMany({ user: user._id }),
      Account.deleteMany({ user: user._id }),
      Category.deleteMany({ user: user._id }),
    ]);
  } else {
    user = await User.create({
      name: "Demo User",
      email: DEMO_EMAIL,
      passwordHash: await User.hashPassword(DEMO_PASSWORD),
      baseCurrency: "INR",
      timezone: "Asia/Kolkata",
    });
    console.log("Created demo user");
  }

  await categoryService.seedDefaults(user._id);
  const categories = await Category.find({ user: user._id });
  const byName = Object.fromEntries(categories.map((c) => [c.name, c]));

  const accounts = {};
  for (const spec of [
    { name: "HDFC Savings", type: "BANK", openingBalanceMinor: 12_50_000 },
    { name: "Cash Wallet", type: "CASH", openingBalanceMinor: 500_00 },
    { name: "ICICI Credit Card", type: "CREDIT_CARD", openingBalanceMinor: 0 },
    { name: "Zerodha", type: "INVESTMENT", openingBalanceMinor: 2_00_000 },
  ]) {
    accounts[spec.name] = await accountService.create(user, spec);
  }
  console.log(`Created ${Object.keys(accounts).length} accounts`);

  const bank = accounts["HDFC Savings"];
  const cash = accounts["Cash Wallet"];
  const card = accounts["ICICI Credit Card"];
  const broker = accounts.Zerodha;

  const now = new Date();
  // Clamped to today: a demo where "spent this month" includes money that has
  // not been spent yet would misrepresent exactly the number this app exists
  // to report.
  const dayIn = (monthsAgo, day) => {
    const date = new Date(now.getFullYear(), now.getMonth() - monthsAgo, day, 12, 0, 0);
    return date > now ? now : date;
  };

  const everyday = [
    { category: "Groceries", account: bank, min: 40_000, max: 320_000, labels: ["BigBasket", "Local market", "DMart"] },
    { category: "Food & Dining", account: card, min: 20_000, max: 150_000, labels: ["Swiggy", "Cafe", "Dinner out"] },
    { category: "Transport", account: cash, min: 5_000, max: 60_000, labels: ["Uber", "Metro card", "Fuel"] },
    { category: "Entertainment", account: card, min: 15_000, max: 90_000, labels: ["Netflix", "Cinema", "Concert"] },
    { category: "Shopping", account: card, min: 50_000, max: 400_000, labels: ["Amazon", "Clothes", "Electronics"] },
    { category: "Health", account: bank, min: 30_000, max: 200_000, labels: ["Pharmacy", "Doctor visit"] },
  ];

  let created = 0;

  for (let monthsAgo = MONTHS - 1; monthsAgo >= 0; monthsAgo -= 1) {
    // Salary on the 1st, rent on the 5th, utilities on the 10th.
    await transactionService.create(user._id, {
      type: "INCOME",
      accountId: bank.id,
      categoryId: byName.Salary._id,
      amountMinor: 85_000_00 + between(-2000, 2000) * 100,
      date: dayIn(monthsAgo, 1),
      description: "Monthly salary",
    });

    await transactionService.create(user._id, {
      type: "EXPENSE",
      accountId: bank.id,
      categoryId: byName.Rent._id,
      amountMinor: 22_000_00,
      date: dayIn(monthsAgo, 5),
      description: "Apartment rent",
    });

    await transactionService.create(user._id, {
      type: "EXPENSE",
      accountId: bank.id,
      categoryId: byName.Utilities._id,
      amountMinor: between(1500, 3500) * 100,
      date: dayIn(monthsAgo, 10),
      description: "Electricity & internet",
    });
    created += 3;

    if (monthsAgo % 2 === 0) {
      await transactionService.create(user._id, {
        type: "INCOME",
        accountId: bank.id,
        categoryId: byName.Freelance._id,
        amountMinor: between(15000, 45000) * 100,
        date: dayIn(monthsAgo, between(12, 20)),
        description: "Freelance project",
      });
      created += 1;
    }

    for (let i = 0; i < between(8, 14); i += 1) {
      const spec = pick(everyday);
      await transactionService.create(user._id, {
        type: "EXPENSE",
        accountId: spec.account.id,
        categoryId: byName[spec.category]._id,
        amountMinor: between(spec.min, spec.max),
        date: dayIn(monthsAgo, between(2, 27)),
        description: pick(spec.labels),
      });
      created += 1;
    }

    // Paying the card and topping up cash are transfers, not expenses — the
    // spending was already recorded when the card was swiped.
    await transactionService.createTransfer(user._id, {
      fromAccountId: bank.id,
      toAccountId: cash.id,
      amountMinor: between(3000, 8000) * 100,
      date: dayIn(monthsAgo, 15),
      description: "ATM withdrawal",
    });

    await transactionService.createTransfer(user._id, {
      fromAccountId: bank.id,
      toAccountId: broker.id,
      amountMinor: 10_000_00,
      date: dayIn(monthsAgo, 20),
      description: "Monthly SIP",
    });
    created += 2;
  }

  const fresh = await User.findById(user._id);
  const [summary, worth] = await Promise.all([
    analyticsService.summary(fresh, {}),
    analyticsService.netWorth(fresh),
  ]);
  const finalAccounts = await accountService.list(user._id);

  console.log(`\nSeeded ${created} transactions across ${MONTHS} months\n`);
  console.log("Accounts");
  for (const account of finalAccounts) {
    console.log(`  ${account.name.padEnd(20)} ₹${formatMinor(account.balanceMinor).padStart(12)}`);
  }
  console.log(`\nThis month`);
  console.log(`  income   ₹${formatMinor(summary.incomeMinor)}`);
  console.log(`  expense  ₹${formatMinor(summary.expenseMinor)}`);
  console.log(`  net      ₹${formatMinor(summary.netMinor)}`);
  console.log(`  savings  ${summary.savingsRatePct ?? "—"}%`);
  console.log(`  transfers excluded: ₹${formatMinor(summary.transferVolumeMinor)}`);
  console.log(`\nNet worth  ₹${formatMinor(worth.totalMinor)}`);
  console.log(`\nLog in with  ${DEMO_EMAIL} / ${DEMO_PASSWORD}\n`);

  await disconnectDB();
}

main().catch(async (err) => {
  console.error("💥 Seed failed:", err);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
