import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Field } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { Select } from "../../components/Select";
import { api, ApiError } from "../../lib/apiClient";
import { invalidateLedger, useAccounts, useCategories } from "../../lib/hooks";
import { toAmountInput } from "../../lib/money";

const todayInput = () => new Date().toISOString().slice(0, 10);

/**
 * Create or edit one income/expense row.
 *
 * Amounts go to the server as `amount` in major units. The server converts,
 * because only it knows the account's currency and therefore how many decimal
 * places it has — a flat x100 here would turn 1000 in a yen account into
 * ¥100,000.
 */
export function TransactionForm({ transaction, onDone, onCancel }) {
  const queryClient = useQueryClient();
  const isEdit = Boolean(transaction);

  const [form, setForm] = useState(() => ({
    type: transaction?.type ?? "EXPENSE",
    accountId: transaction?.account?.id ?? transaction?.account ?? "",
    categoryId: transaction?.category?.id ?? transaction?.category ?? "",
    amount: toAmountInput(transaction?.amountMinor, transaction?.currency),
    date: transaction?.date ? transaction.date.slice(0, 10) : todayInput(),
    description: transaction?.description ?? "",
    notes: transaction?.notes ?? "",
  }));

  const { data: accounts = [] } = useAccounts();
  // A category belongs to one side of the ledger, so the list follows the
  // chosen type — offering "Salary" on an expense would only create bad data.
  const { data: categories = [] } = useCategories({ kind: form.type });

  const update = (key) => (event) => {
    const { value } = event.target;
    setForm((f) => ({
      ...f,
      [key]: value,
      // Switching type invalidates the category, so clear it rather than
      // submitting one the server will reject.
      ...(key === "type" && { categoryId: "" }),
    }));
  };

  const mutation = useMutation({
    mutationFn: (payload) =>
      isEdit
        ? api.patch(`/api/transactions/${transaction.id}`, payload)
        : api.post("/api/transactions", payload),
    onSuccess: () => {
      invalidateLedger(queryClient);
      onDone();
    },
  });

  const fieldErrors = mutation.error instanceof ApiError ? mutation.error.byField : {};

  function onSubmit(event) {
    event.preventDefault();
    mutation.mutate({
      type: form.type,
      accountId: form.accountId,
      categoryId: form.categoryId,
      amount: Number(form.amount),
      date: form.date,
      description: form.description.trim(),
      notes: form.notes.trim(),
    });
  }

  return (
    <form onSubmit={onSubmit} className="stack" noValidate>
      <FormError error={mutation.error} />

      <div className="field-row">
        <Select label="Type" value={form.type} onChange={update("type")} error={fieldErrors.type}>
          <option value="EXPENSE">Expense</option>
          <option value="INCOME">Income</option>
        </Select>

        <Field
          label="Amount"
          type="number"
          step="any"
          min="0"
          inputMode="decimal"
          value={form.amount}
          onChange={update("amount")}
          error={fieldErrors.amount ?? fieldErrors.amountMinor}
          required
        />
      </div>

      <div className="field-row">
        <Select
          label="Account"
          value={form.accountId}
          onChange={update("accountId")}
          error={fieldErrors.accountId}
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
        error={fieldErrors.description}
        placeholder="Weekly groceries"
      />

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>
          {mutation.isPending ? "Saving…" : isEdit ? "Save changes" : "Add transaction"}
        </button>
      </div>
    </form>
  );
}
