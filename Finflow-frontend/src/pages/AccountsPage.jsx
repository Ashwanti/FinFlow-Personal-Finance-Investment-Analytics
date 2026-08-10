import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Field } from "../components/Field";
import { FormError } from "../components/FormError";
import { Modal } from "../components/Modal";
import { Select } from "../components/Select";
import { Spinner } from "../components/Spinner";
import { Stat } from "../components/Stat";
import { api, ApiError } from "../lib/apiClient";
import { invalidateLedger } from "../lib/hooks";
import { formatMoney, toAmountInput, toMinor } from "../lib/money";

const ACCOUNT_TYPES = [
  { value: "BANK", label: "Bank" },
  { value: "CASH", label: "Cash" },
  { value: "WALLET", label: "Wallet" },
  { value: "CREDIT_CARD", label: "Credit card" },
  { value: "INVESTMENT", label: "Investment" },
];

const typeLabel = (value) => ACCOUNT_TYPES.find((t) => t.value === value)?.label ?? value;

function AccountForm({ account, baseCurrency, onDone, onCancel }) {
  const queryClient = useQueryClient();
  const isEdit = Boolean(account);

  const [form, setForm] = useState(() => ({
    name: account?.name ?? "",
    type: account?.type ?? "BANK",
    currency: account?.currency ?? baseCurrency ?? "INR",
    openingBalance: toAmountInput(account?.openingBalanceMinor ?? 0, account?.currency ?? baseCurrency),
  }));

  const update = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  const mutation = useMutation({
    mutationFn: (payload) =>
      isEdit ? api.patch(`/api/accounts/${account.id}`, payload) : api.post("/api/accounts", payload),
    onSuccess: () => {
      invalidateLedger(queryClient);
      onDone();
    },
  });

  const fieldErrors = mutation.error instanceof ApiError ? mutation.error.byField : {};

  function onSubmit(event) {
    event.preventDefault();

    // Accounts are the one endpoint that takes only minor units, so the
    // conversion happens here — against the currency chosen in this very form,
    // which is why it is safe to do client-side.
    const openingBalanceMinor = toMinor(form.openingBalance || 0, form.currency);

    mutation.mutate({
      name: form.name.trim(),
      type: form.type,
      currency: form.currency.trim().toUpperCase(),
      openingBalanceMinor,
    });
  }

  return (
    <form onSubmit={onSubmit} className="stack" noValidate>
      <FormError error={mutation.error} />

      <Field
        label="Name"
        value={form.name}
        onChange={update("name")}
        error={fieldErrors.name}
        placeholder="HDFC Savings"
        required
      />

      <div className="field-row">
        <Select label="Type" value={form.type} onChange={update("type")} error={fieldErrors.type}>
          {ACCOUNT_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </Select>

        <Field
          label="Currency"
          value={form.currency}
          onChange={update("currency")}
          error={fieldErrors.currency}
          maxLength={3}
          hint={isEdit ? "Locked once the account has transactions" : undefined}
        />
      </div>

      <Field
        label="Opening balance"
        type="number"
        step="any"
        inputMode="decimal"
        value={form.openingBalance}
        onChange={update("openingBalance")}
        error={fieldErrors.openingBalanceMinor}
        hint="What it held before you started tracking. Negative is fine for a card."
      />

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>
          {mutation.isPending ? "Saving…" : isEdit ? "Save changes" : "Add account"}
        </button>
      </div>
    </form>
  );
}

export function AccountsPage() {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState(null);
  const [showArchived, setShowArchived] = useState(false);

  const { data, isPending, error } = useQuery({
    queryKey: ["accounts", { includeArchived: showArchived }],
    queryFn: () => api.get(`/api/accounts${showArchived ? "?includeArchived=true" : ""}`),
  });

  const { data: netWorth } = useQuery({
    queryKey: ["dashboard", "net-worth"],
    queryFn: () => api.get("/api/analytics/net-worth"),
  });

  const remove = useMutation({
    mutationFn: (account) => api.delete(`/api/accounts/${account.id}`),
    onSuccess: () => invalidateLedger(queryClient),
  });

  const recalculate = useMutation({
    mutationFn: (account) => api.post(`/api/accounts/${account.id}/recalculate`),
    onSuccess: () => invalidateLedger(queryClient),
  });

  if (isPending) return <Spinner label="Loading accounts" />;
  if (error)
    return (
      <p className="alert alert-error" role="alert">
        {error.message}
      </p>
    );

  const accounts = data.accounts;

  return (
    <div className="stack">
      <div className="page-head">
        <h1 className="page-title">Accounts</h1>
        <div className="page-actions">
          <label className="checkline">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />
            Show archived
          </label>
          <button type="button" className="btn btn-primary" onClick={() => setDialog({})}>
            Add account
          </button>
        </div>
      </div>

      {netWorth ? (
        <div className="stat-grid">
          <Stat label="Net worth" value={formatMoney(netWorth.totalMinor, netWorth.currency)} />
          <Stat label="Cash" value={formatMoney(netWorth.cashMinor, netWorth.currency)} />
          <Stat
            label="Investments"
            value={formatMoney(netWorth.investmentsMinor, netWorth.currency)}
          />
          <Stat
            label="Liabilities"
            value={formatMoney(netWorth.liabilitiesMinor, netWorth.currency)}
            tone={netWorth.liabilitiesMinor < 0 ? "negative" : "neutral"}
          />
        </div>
      ) : null}

      {netWorth?.unconverted?.length ? (
        <p className="alert alert-warn">
          Excluded from the total — no exchange rate for{" "}
          {netWorth.unconverted.map((entry) => entry.currency).join(", ")}.
        </p>
      ) : null}

      {recalculate.data ? (
        <p className="alert alert-ok" role="status">
          Rebuilt from history.{" "}
          {recalculate.data.driftMinor === 0
            ? "No drift found."
            : `Corrected by ${formatMoney(
                recalculate.data.driftMinor,
                recalculate.data.account.currency
              )}.`}
        </p>
      ) : null}

      {remove.error ? (
        <p className="alert alert-error" role="alert">
          {remove.error.message}
        </p>
      ) : null}

      {accounts.length === 0 ? (
        <div className="panel">
          <p className="empty">No accounts yet. Add one to start recording transactions.</p>
        </div>
      ) : (
        <div className="card-grid">
          {accounts.map((account) => (
            <article key={account.id} className={`panel account-card ${account.isArchived ? "is-archived" : ""}`}>
              <div className="account-head">
                <div>
                  <h2>{account.name}</h2>
                  <p className="muted">
                    {typeLabel(account.type)} · {account.currency}
                    {account.isArchived ? " · archived" : ""}
                  </p>
                </div>
                <p
                  className={`account-balance ${
                    account.balanceMinor < 0 ? "tone-negative" : ""
                  }`}
                >
                  {formatMoney(account.balanceMinor, account.currency)}
                </p>
              </div>

              <div className="account-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setDialog({ account })}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => recalculate.mutate(account)}
                  disabled={recalculate.isPending}
                  title="Rebuild the balance from every transaction"
                >
                  Recalculate
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    // The API archives rather than deletes once an account has
                    // history, so the wording must not promise removal.
                    if (
                      window.confirm(
                        `Remove "${account.name}"? If it has transactions it will be archived instead, so its history is kept.`
                      )
                    ) {
                      remove.mutate(account);
                    }
                  }}
                >
                  Remove
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(dialog)}
        onClose={() => setDialog(null)}
        title={dialog?.account ? "Edit account" : "Add account"}
      >
        {dialog ? (
          <AccountForm
            key={dialog.account?.id ?? "new"}
            account={dialog.account}
            baseCurrency={netWorth?.currency}
            onDone={() => setDialog(null)}
            onCancel={() => setDialog(null)}
          />
        ) : null}
      </Modal>
    </div>
  );
}
