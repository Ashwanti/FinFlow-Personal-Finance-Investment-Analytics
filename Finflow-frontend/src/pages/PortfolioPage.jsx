import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { Spinner } from "../components/Spinner";
import { Stat } from "../components/Stat";
import { api } from "../lib/apiClient";
import { formatDate, formatMoney, formatPercent } from "../lib/money";

// Stable colours per asset class, so a slice does not change colour when the
// ordering shifts between loads.
const CLASS_COLORS = {
  EQUITY: "#4f46e5",
  MUTUAL_FUND: "#0ea5e9",
  ETF: "#14b8a6",
  BOND: "#84cc16",
  CRYPTO: "#f59e0b",
  OTHER: "#64748b",
};

const classLabel = (value) =>
  value.charAt(0) + value.slice(1).toLowerCase().replace("_", " ");

export function PortfolioPage() {
  const queryClient = useQueryClient();

  const portfolio = useQuery({
    queryKey: ["portfolio"],
    queryFn: () => api.get("/api/investments/portfolio"),
  });

  const performance = useQuery({
    queryKey: ["portfolio", "performance"],
    queryFn: () => api.get("/api/investments/performance"),
  });

  const refresh = useMutation({
    mutationFn: () => api.post("/api/investments/prices/refresh"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["portfolio"] }),
  });

  if (portfolio.isPending) return <Spinner label="Loading your portfolio" />;
  if (portfolio.error)
    return (
      <p className="alert alert-error" role="alert">
        {portfolio.error.message}
      </p>
    );

  const data = portfolio.data;
  const currency = data.currency;
  const open = data.positions.filter((position) => position.quantityScaled > 0);

  return (
    <div className="stack">
      <div className="page-head">
        <h1 className="page-title">Portfolio</h1>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
        >
          {refresh.isPending ? "Refreshing…" : "Refresh prices"}
        </button>
      </div>

      {data.positionCount === 0 ? (
        <div className="panel">
          <p className="empty">No holdings yet.</p>
          <p className="muted">
            Add one with <code>POST /api/investments/holdings</code>, then record trades against
            it. Buying is not spending — your net worth will only move by the fee.
          </p>
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <Stat label="Market value" value={formatMoney(data.marketValueMinor, currency)} />
            <Stat label="Invested" value={formatMoney(data.costBasisMinor, currency)} />
            <Stat
              label="Unrealised"
              value={formatMoney(data.unrealizedPnlMinor, currency, { sign: true })}
              delta={formatPercent(data.unrealizedPnlPct, { sign: true })}
              tone={data.unrealizedPnlMinor >= 0 ? "positive" : "negative"}
            />
            <Stat
              label="Annualised return"
              value={formatPercent(performance.data?.xirrPct, { sign: true })}
              tone={(performance.data?.xirrPct ?? 0) >= 0 ? "positive" : "negative"}
              // Null, not zero, when the flows cannot yield a rate — a single
              // purchase today has no annualised return to report.
              footnote={performance.data?.xirrPct === null ? "not enough history yet" : "XIRR"}
            />
          </div>

          {data.unpricedCount > 0 ? (
            <p className="alert alert-warn">
              {data.unpricedCount} position{data.unpricedCount === 1 ? " has" : "s have"} no usable
              price and {data.unpricedCount === 1 ? "is" : "are"} excluded from these totals —
              rather than counted as worth nothing.
            </p>
          ) : null}

          <div className="panel-grid">
            <article className="panel">
              <h2>Allocation</h2>
              {data.allocation.length ? (
                <div className="split">
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={data.allocation}
                        dataKey="marketValueMinor"
                        nameKey="assetClass"
                        innerRadius={52}
                        outerRadius={82}
                        paddingAngle={2}
                      >
                        {data.allocation.map((slice) => (
                          <Cell
                            key={slice.assetClass}
                            fill={CLASS_COLORS[slice.assetClass] ?? CLASS_COLORS.OTHER}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value, name) => [formatMoney(value, currency), classLabel(name)]}
                        contentStyle={{
                          background: "var(--surface)",
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>

                  <ul className="legend">
                    {data.allocation.map((slice) => (
                      <li key={slice.assetClass}>
                        <span
                          className="swatch"
                          style={{ background: CLASS_COLORS[slice.assetClass] ?? CLASS_COLORS.OTHER }}
                        />
                        <span className="legend-name">{classLabel(slice.assetClass)}</span>
                        <span className="legend-value">
                          {formatMoney(slice.marketValueMinor, currency)}
                          <span className="muted"> · {formatPercent(slice.sharePct)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="empty">Nothing priced yet.</p>
              )}
            </article>

            <article className="panel">
              <h2>Returns</h2>
              {performance.data ? (
                <dl className="budget-detail wide">
                  <div>
                    <dt>Invested</dt>
                    <dd>{formatMoney(performance.data.investedMinor, currency)}</dd>
                  </div>
                  <div>
                    <dt>Withdrawn</dt>
                    <dd>{formatMoney(performance.data.withdrawnMinor, currency)}</dd>
                  </div>
                  <div>
                    <dt>Realised</dt>
                    <dd
                      className={
                        performance.data.realizedPnlMinor >= 0 ? "tone-positive" : "tone-negative"
                      }
                    >
                      {formatMoney(performance.data.realizedPnlMinor, currency, { sign: true })}
                    </dd>
                  </div>
                  <div>
                    <dt>Unrealised</dt>
                    <dd
                      className={
                        performance.data.unrealizedPnlMinor >= 0 ? "tone-positive" : "tone-negative"
                      }
                    >
                      {formatMoney(performance.data.unrealizedPnlMinor, currency, { sign: true })}
                    </dd>
                  </div>
                  <div>
                    <dt>Fees paid</dt>
                    <dd>{formatMoney(performance.data.feesMinor, currency)}</dd>
                  </div>
                  <div>
                    <dt>Simple return</dt>
                    <dd>{formatPercent(performance.data.absoluteReturnPct, { sign: true })}</dd>
                  </div>
                </dl>
              ) : (
                <Spinner label="Loading performance" />
              )}
            </article>
          </div>

          <section className="panel">
            <h2>Positions</h2>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Symbol</th>
                    <th scope="col" className="right">
                      Quantity
                    </th>
                    <th scope="col" className="right">
                      Price
                    </th>
                    <th scope="col" className="right">
                      Cost
                    </th>
                    <th scope="col" className="right">
                      Value
                    </th>
                    <th scope="col" className="right">
                      Unrealised
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {open.map((position) => (
                    <tr key={position.id}>
                      <td>
                        <strong>{position.symbol}</strong>
                        {position.name ? <div className="muted">{position.name}</div> : null}
                      </td>
                      <td className="right">{position.quantityDisplay}</td>
                      <td className="right">
                        {formatMoney(position.price.priceMinor, position.currency)}
                        {/* Staleness is surfaced, not hidden — an old mark is
                            useful only if you know it is old. */}
                        {position.price.stale && position.price.priceMinor !== null ? (
                          <div className="muted" title={position.price.error ?? ""}>
                            as of {formatDate(position.price.asOf)}
                          </div>
                        ) : null}
                      </td>
                      <td className="right">
                        {formatMoney(position.costBasisMinor, position.currency)}
                      </td>
                      <td className="right">
                        {position.isPriced ? (
                          formatMoney(position.marketValueMinor, position.currency)
                        ) : (
                          <span className="muted" title={position.price.error ?? ""}>
                            unpriced
                          </span>
                        )}
                      </td>
                      <td
                        className={`right ${
                          !position.isPriced
                            ? ""
                            : position.unrealizedPnlMinor >= 0
                              ? "tone-positive"
                              : "tone-negative"
                        }`}
                      >
                        {position.isPriced ? (
                          <>
                            {formatMoney(position.unrealizedPnlMinor, position.currency, {
                              sign: true,
                            })}
                            <div className="muted">
                              {formatPercent(position.unrealizedPnlPct, { sign: true })}
                            </div>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
