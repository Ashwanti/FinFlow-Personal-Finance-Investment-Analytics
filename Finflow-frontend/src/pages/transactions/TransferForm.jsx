import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { Field } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { Select } from "../../components/Select";
import { api, ApiError } from "../../lib/apiClient";
import { invalidateLedger, useAccounts } from "../../lib/hooks";

const todayInput = () => new Date().toISOString().slice(0, 10);

/**
 * Moving money between two accounts you own.
 *
 * Separate from the transaction form because it is a genuinely different
 * thing: it writes two linked rows, and it is neither income nor expense. The
 * server refuses `type: "TRANSFER"` on the ordinary endpoint for the same
 * reason — one row cannot express a two-sided movement.
 */
export function TransferForm({ onDone, onCancel }) {
  const queryClient = useQueryClient();
  const { data: accounts = [] } = useAccounts();

  const [form, setForm] = useState({
    fromAccountId: "",
    toAccountId: "",
    amount: "",
    toAmount: "",
    date: todayInput(),
    description: "",
  });

  const update = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  const from = accounts.find((a) => a.id === form.fromAccountId);
  const to = accounts.find((a) => a.id === form.toAccountId);

  // Across currencies the server will not invent an exchange rate — a wrong
  // guess silently corrupts net worth — so the landing amount is asked for.
  const crossCurrency = useMemo(
    () => Boolean(from && to && from.currency !== to.currency),
    [from, to]
  );

  const mutation = useMutation({
    mutationFn: (payload) => api.post("/api/transactions/transfer", payload),
    onSuccess: () => {
      invalidateLedger(queryClient);
      onDone();
    },
  });

  const fieldErrors = mutation.error instanceof ApiError ? mutation.error.byField : {};

  function onSubmit(event) {
    event.preventDefault();
    mutation.mutate({
      fromAccountId: form.fromAccountId,
      toAccountId: form.toAccountId,
      amount: Number(form.amount),
      ...(crossCurrency && form.toAmount !== "" && { toAmount: Number(form.toAmount) }),
      date: form.date,
      description: form.description.trim(),
    });
  }

  return (
    <form onSubmit={onSubmit} className="stack" noValidate>
      <FormError error={mutation.error} />

      <div className="field-row">
        <Select
          label="From"
          value={form.fromAccountId}
          onChange={update("fromAccountId")}
          error={fieldErrors.fromAccountId}
          required
        >
          <option value="">Choose an account…</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name} ({account.currency})
            </option>
          ))}
        </Select>

        <Select
          label="To"
          value={form.toAccountId}
          onChange={update("toAccountId")}
          error={fieldErrors.toAccountId}
          required
        >
          <option value="">Choose an account…</option>
          {accounts
            .filter((account) => account.id !== form.fromAccountId)
            .map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} ({account.currency})
              </option>
            ))}
        </Select>
      </div>

      <div className="field-row">
        <Field
          label={crossCurrency ? `Amount leaving (${from.currency})` : "Amount"}
          type="number"
          step="any"
          min="0"
          inputMode="decimal"
          value={form.amount}
          onChange={update("amount")}
          error={fieldErrors.amount}
          required
        />

        {crossCurrency ? (
          <Field
            label={`Amount arriving (${to.currency})`}
            type="number"
            step="any"
            min="0"
            inputMode="decimal"
            value={form.toAmount}
            onChange={update("toAmount")}
            error={fieldErrors.toAmount}
            hint="What actually landed — not a converted estimate"
            required
          />
        ) : null}
      </div>

      <Field
        label="Date"
        type="date"
        value={form.date}
        onChange={update("date")}
        error={fieldErrors.date}
        required
      />

      <Field
        label="Description"
        value={form.description}
        onChange={update("description")}
        placeholder="ATM withdrawal"
      />

      <p className="field-hint">
        A transfer is not income or spending — it will not appear in either
        report, or consume a budget.
      </p>

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>
          {mutation.isPending ? "Saving…" : "Record transfer"}
        </button>
      </div>
    </form>
  );
}
