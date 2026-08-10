import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Field } from "../components/Field";
import { FormError } from "../components/FormError";
import { Modal } from "../components/Modal";
import { Select } from "../components/Select";
import { Spinner } from "../components/Spinner";
import { Stat } from "../components/Stat";
import { api, ApiError } from "../lib/apiClient";
import { invalidateLedger, useCategories } from "../lib/hooks";
import { formatMoney, formatPercent, toAmountInput } from "../lib/money";

function BudgetForm({ budget, currency, onDone, onCancel }) {
  const queryClient = useQueryClient();
  const isEdit = Boolean(budget);

  // Only expense categories: a cap on money coming in is a target, not a
  // limit, and the API rejects it outright.
  const { data: categories = [] } = useCategories({ kind: "EXPENSE" });

  const [form, setForm] = useState(() => ({
    categoryId: budget?.category?.id ?? "",
    amount: toAmountInput(budget?.amountMinor, currency),
    period: budget?.period ?? "MONTHLY",
    rollover: budget?.rollover ?? false,
  }));

  const update = (key) => (event) =>
    setForm((f) => ({
      ...f,
      [key]: event.target.type === "checkbox" ? event.target.checked : event.target.value,
    }));

  const mutation = useMutation({
    mutationFn: (payload) =>
      isEdit ? api.patch(`/api/budgets/${budget.id}`, payload) : api.post("/api/budgets", payload),
    onSuccess: () => {
      invalidateLedger(queryClient);
      onDone();
    },
  });

  const fieldErrors = mutation.error instanceof ApiError ? mutation.error.byField : {};

  function onSubmit(event) {
    event.preventDefault();
    mutation.mutate({
      ...(isEdit ? {} : { categoryId: form.categoryId }),
      amount: Number(form.amount),
      period: form.period,
      rollover: form.rollover,
    });
  }

  return (
    <form onSubmit={onSubmit} className="stack" noValidate>
      <FormError error={mutation.error} />

      {isEdit ? (
        <p className="muted">
          {budget.category.icon} {budget.category.name}
        </p>
      ) : (
        <Select
          label="Category"
          value={form.categoryId}
          onChange={update("categoryId")}
          error={fieldErrors.categoryId}
          required
        >
          <option value="">Choose a category…</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.icon} {category.name}
            </option>
          ))}
        </Select>
      )}

      <div className="field-row">
        <Field
          label="Amount"
          type="number"
          step="any"
          min="0"
          inputMode="decimal"
          value={form.amount}
          onChange={update("amount")}
          error={fieldErrors.amount}
          required
        />

        <Select label="Period" value={form.period} onChange={update("period")} error={fieldErrors.period}>
          <option value="WEEKLY">Weekly</option>
          <option value="MONTHLY">Monthly</option>
          <option value="YEARLY">Yearly</option>
        </Select>
      </div>

      <label className="checkline">
        <input type="checkbox" checked={form.rollover} onChange={update("rollover")} />
        Carry unspent budget into the next period
      </label>
      <p className="field-hint">
        With rollover on, overspending also carries — it leaves you less to spend
        next period rather than being forgiven.
      </p>

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>
          {mutation.isPending ? "Saving…" : isEdit ? "Save changes" : "Add budget"}
        </button>
      </div>
    </form>
  );
}

export function BudgetsPage() {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState(null);

  const { data, isPending, error } = useQuery({
    queryKey: ["budgets", "overview"],
    queryFn: () => api.get("/api/budgets/overview"),
  });

  const remove = useMutation({
    mutationFn: (budget) => api.delete(`/api/budgets/${budget.id}`),
    onSuccess: () => invalidateLedger(queryClient),
  });

  if (isPending) return <Spinner label="Loading budgets" />;
  if (error)
    return (
      <p className="alert alert-error" role="alert">
        {error.message}
      </p>
    );

  const { budgets, currency } = data;

  return (
    <div className="stack">
      <div className="page-head">
        <h1 className="page-title">Budgets</h1>
        <button type="button" className="btn btn-primary" onClick={() => setDialog({})}>
          Add budget
        </button>
      </div>

      {data.budgetCount > 0 ? (
        <div className="stat-grid">
          <Stat label="Budgeted" value={formatMoney(data.budgetedMinor, currency)} />
          <Stat label="Spent" value={formatMoney(data.spentMinor, currency)} />
          <Stat
            label="Remaining"
            value={formatMoney(data.remainingMinor, currency)}
            tone={data.remainingMinor < 0 ? "negative" : "positive"}
          />
          <Stat
            label="Used"
            value={formatPercent(data.usedPct)}
            footnote={`${data.overBudgetCount} over · ${data.atRiskCount} at risk`}
          />
        </div>
      ) : null}

      {remove.error ? (
        <p className="alert alert-error" role="alert">
          {remove.error.message}
        </p>
      ) : null}

      {budgets.length === 0 ? (
        <div className="panel">
          <p className="empty">
            No budgets yet. Set a cap on a category to see how the month is tracking.
          </p>
        </div>
      ) : (
        <div className="card-grid">
          {budgets.map((budget) => {
            // Clamped so a large overspend does not run the bar off the card;
            // the figures beneath it carry the real number.
            const width = Math.min(100, budget.usedPct ?? 0);

            return (
              <article key={budget.id} className="panel budget-card">
                <div className="budget-head">
                  <h2>
                    {budget.category.icon} {budget.category.name}
                  </h2>
                  <span className={`badge is-${budget.status.toLowerCase()}`}>{budget.status}</span>
                </div>

                <div
                  className="meter"
                  role="progressbar"
                  aria-valuenow={Math.round(budget.usedPct ?? 0)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${budget.category.name} budget used`}
                >
                  <span
                    className={`meter-fill is-${budget.status.toLowerCase()}`}
                    style={{ width: `${width}%` }}
                  />
                </div>

                <p className="budget-figures">
                  <strong>{formatMoney(budget.spentMinor, budget.currency)}</strong>
                  <span className="muted"> of {formatMoney(budget.availableMinor, budget.currency)}</span>
                  <span className="muted"> · {formatPercent(budget.usedPct)}</span>
                </p>

                <dl className="budget-detail">
                  <div>
                    <dt>{budget.remainingMinor < 0 ? "Over by" : "Left"}</dt>
                    <dd className={budget.remainingMinor < 0 ? "tone-negative" : ""}>
                      {formatMoney(Math.abs(budget.remainingMinor), budget.currency)}
                    </dd>
                  </div>
                  <div>
                    <dt>Per day</dt>
                    <dd>{formatMoney(budget.dailyAllowanceMinor, budget.currency)}</dd>
                  </div>
                  <div>
                    <dt>Days left</dt>
                    <dd>{budget.daysRemaining}</dd>
                  </div>
                </dl>

                {budget.rollover && budget.rolloverMinor !== 0 ? (
                  <p className="note muted">
                    {budget.rolloverMinor > 0 ? "Carried in" : "Carried over from overspend"}:{" "}
                    {formatMoney(budget.rolloverMinor, budget.currency, { sign: true })}
                  </p>
                ) : null}

                <div className="account-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setDialog({ budget })}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      if (window.confirm(`Delete the ${budget.category.name} budget?`)) {
                        remove.mutate(budget);
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Modal
        open={Boolean(dialog)}
        onClose={() => setDialog(null)}
        title={dialog?.budget ? "Edit budget" : "Add budget"}
      >
        {dialog ? (
          <BudgetForm
            key={dialog.budget?.id ?? "new"}
            budget={dialog.budget}
            currency={currency}
            onDone={() => setDialog(null)}
            onCancel={() => setDialog(null)}
          />
        ) : null}
      </Modal>
    </div>
  );
}
