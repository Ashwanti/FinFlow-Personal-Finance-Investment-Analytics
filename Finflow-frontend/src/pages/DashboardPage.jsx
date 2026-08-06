import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Spinner } from "../components/Spinner";
import { Stat } from "../components/Stat";
import { api } from "../lib/apiClient";
import {
  formatDate,
  formatMoney,
  formatMonth,
  formatPercent,
  toMajor,
} from "../lib/money";

export function DashboardPage() {
  // One request for the whole page — the endpoint exists precisely so this is
  // not six round trips.
  const { data, isPending, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get("/api/analytics/dashboard"),
  });

  if (isPending) return <Spinner label="Loading your dashboard" />;

  if (error) {
    return (
      <p className="alert alert-error" role="alert">
        {error.message}
      </p>
    );
  }

  const { summary, netWorth, budgets, investments, cashflow, topCategories, recentTransactions } =
    data;
  const currency = summary.currency;

  const flow = cashflow.map((point) => ({
    label: formatMonth(point.period),
    income: toMajor(point.incomeMinor, currency),
    expense: toMajor(point.expenseMinor, currency),
  }));

  return (
    <div className="stack-lg">
      <section>
        <h1 className="page-title">Overview</h1>
        <div className="stat-grid">
          <Stat
            label="Net worth"
            value={formatMoney(netWorth.totalMinor, currency)}
            footnote={`${formatMoney(netWorth.cashMinor, currency, { compact: true })} cash · ${formatMoney(
              netWorth.investmentsMinor,
              currency,
              { compact: true }
            )} invested`}
          />
          <Stat
            label="Income this month"
            value={formatMoney(summary.incomeMinor, currency)}
            footnote={`${summary.transactionCount} transactions`}
          />
          <Stat
            label="Spent this month"
            value={formatMoney(summary.expenseMinor, currency)}
            footnote={`${formatMoney(summary.averageDailySpendMinor, currency)} a day`}
          />
          <Stat
            label="Saved"
            value={formatMoney(summary.netMinor, currency)}
            delta={formatPercent(summary.savingsRatePct)}
            tone={summary.netMinor >= 0 ? "positive" : "negative"}
            footnote="of income kept"
          />
        </div>

        {/* Transfers are excluded from every figure above. Saying so turns a
            number the user might think is missing into one they can trust. */}
        {summary.transferVolumeMinor > 0 ? (
          <p className="note muted">
            {formatMoney(summary.transferVolumeMinor, currency)} moved between your own accounts
            this month — excluded from income and spending.
          </p>
        ) : null}

        {netWorth.staleRates?.length ? (
          <p className="alert alert-warn">
            Converted using {netWorth.staleRates.length} exchange rate
            {netWorth.staleRates.length === 1 ? "" : "s"} more than two days old.
          </p>
        ) : null}

        {netWorth.unconverted?.length ? (
          <p className="alert alert-warn">
            Some balances have no exchange rate and are excluded from the total:{" "}
            {netWorth.unconverted.map((entry) => entry.currency).join(", ")}.
          </p>
        ) : null}
      </section>

      <section className="panel-grid">
        <article className="panel">
          <h2>Income vs spending</h2>
          {flow.some((point) => point.income || point.expense) ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={flow} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--grid)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={64}
                  tickFormatter={(value) =>
                    new Intl.NumberFormat(undefined, { notation: "compact" }).format(value)
                  }
                />
                <Tooltip
                  formatter={(value, name) => [
                    formatMoney(Math.round(value * 10 ** 2), currency),
                    name === "income" ? "Income" : "Spending",
                  ]}
                  contentStyle={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                  }}
                />
                <Bar dataKey="income" fill="var(--positive)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expense" fill="var(--negative)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="empty">No activity in the last six months.</p>
          )}
        </article>

        <article className="panel">
          <h2>Where the money went</h2>
          {topCategories.length ? (
            <div className="split">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={topCategories}
                    dataKey="totalMinor"
                    nameKey="name"
                    innerRadius={52}
                    outerRadius={82}
                    paddingAngle={2}
                  >
                    {topCategories.map((category) => (
                      <Cell key={category.categoryId} fill={category.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value, name) => [formatMoney(value, currency), name]}
                    contentStyle={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>

              <ul className="legend">
                {topCategories.map((category) => (
                  <li key={category.categoryId}>
                    <span className="swatch" style={{ background: category.color }} />
                    <span className="legend-name">
                      {category.icon} {category.name}
                    </span>
                    <span className="legend-value">
                      {formatMoney(category.totalMinor, currency)}
                      <span className="muted"> · {formatPercent(category.sharePct)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="empty">No spending recorded this month.</p>
          )}
        </article>
      </section>

      <section className="panel-grid">
        <article className="panel">
          <h2>Budgets</h2>
          {budgets.alerts?.length ? (
            <ul className="alert-list">
              {budgets.alerts.map((alert) => (
                <li key={alert.budgetId} className={`budget-alert is-${alert.status.toLowerCase()}`}>
                  <span>{alert.category?.name ?? "Budget"}</span>
                  <span>
                    {formatMoney(alert.spentMinor, currency)} of{" "}
                    {formatMoney(alert.availableMinor, currency)}
                    <span className="muted"> · {formatPercent(alert.usedPct)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">
              {budgets.budgetedMinor > 0
                ? "Every budget is on track."
                : "No budgets set yet."}
            </p>
          )}
          {budgets.budgetedMinor > 0 ? (
            <p className="note muted">
              {formatMoney(budgets.spentMinor, currency)} of{" "}
              {formatMoney(budgets.budgetedMinor, currency)} budgeted ·{" "}
              {formatPercent(budgets.usedPct)} used
            </p>
          ) : null}
        </article>

        <article className="panel">
          <h2>Portfolio</h2>
          {investments.positionCount > 0 ? (
            <>
              <div className="stat-row">
                <Stat
                  label="Market value"
                  value={formatMoney(investments.marketValueMinor, currency)}
                />
                <Stat
                  label="Unrealised"
                  value={formatMoney(investments.unrealizedPnlMinor, currency, { sign: true })}
                  delta={formatPercent(investments.unrealizedPnlPct, { sign: true })}
                  tone={investments.unrealizedPnlMinor >= 0 ? "positive" : "negative"}
                />
              </div>
              <ul className="legend">
                {investments.allocation.map((slice) => (
                  <li key={slice.assetClass}>
                    <span className="legend-name">{slice.assetClass.replace("_", " ")}</span>
                    <span className="legend-value">
                      {formatMoney(slice.marketValueMinor, currency)}
                      <span className="muted"> · {formatPercent(slice.sharePct)}</span>
                    </span>
                  </li>
                ))}
              </ul>
              {investments.unpricedCount > 0 ? (
                <p className="note muted">
                  {investments.unpricedCount} position
                  {investments.unpricedCount === 1 ? "" : "s"} could not be priced and are excluded.
                </p>
              ) : null}
            </>
          ) : (
            <p className="empty">No holdings yet.</p>
          )}
        </article>
      </section>

      <section className="panel">
        <h2>Recent activity</h2>
        {recentTransactions.length ? (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Description</th>
                <th scope="col">Category</th>
                <th scope="col">Account</th>
                <th scope="col" className="right">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {recentTransactions.map((transaction) => {
                const isTransfer = transaction.type === "TRANSFER";
                const isIncome = transaction.type === "INCOME";
                const sign = isIncome || transaction.transferDirection === "IN" ? "+" : "−";

                return (
                  <tr key={transaction.id}>
                    <td>{formatDate(transaction.date)}</td>
                    <td>{transaction.description || <span className="muted">—</span>}</td>
                    <td>
                      {isTransfer ? (
                        <span className="pill">Transfer</span>
                      ) : (
                        <>
                          {transaction.category?.icon} {transaction.category?.name}
                        </>
                      )}
                    </td>
                    <td className="muted">{transaction.account?.name}</td>
                    <td
                      className={`right ${
                        isTransfer ? "" : isIncome ? "tone-positive" : "tone-negative"
                      }`}
                    >
                      {sign}
                      {formatMoney(transaction.amountMinor, transaction.currency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="empty">Nothing recorded yet.</p>
        )}
      </section>
    </div>
  );
}
