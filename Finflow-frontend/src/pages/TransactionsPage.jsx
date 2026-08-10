import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Modal } from "../components/Modal";
import { Select } from "../components/Select";
import { Spinner } from "../components/Spinner";
import { api } from "../lib/apiClient";
import { invalidateLedger, useAccounts, useCategories } from "../lib/hooks";
import { formatDate, formatMoney } from "../lib/money";
import { queryString } from "../lib/queryString";
import { TransactionForm } from "./transactions/TransactionForm";
import { TransferForm } from "./transactions/TransferForm";

const EMPTY_FILTERS = {
  search: "",
  type: "",
  accountId: "",
  categoryId: "",
  from: "",
  to: "",
};

export function TransactionsPage() {
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(null); // {mode:"transaction"|"transfer", transaction?}

  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();

  const { data, isPending, error, isFetching } = useQuery({
    queryKey: ["transactions", { ...filters, page }],
    queryFn: () => api.get(`/api/transactions${queryString({ ...filters, page, limit: 25 })}`),
    // Keeps the previous page on screen while the next loads, so paging does
    // not flash an empty table.
    placeholderData: (previous) => previous,
  });

  const remove = useMutation({
    mutationFn: (transaction) => api.delete(`/api/transactions/${transaction.id}`),
    onSuccess: () => invalidateLedger(queryClient),
  });

  const setFilter = (key) => (event) => {
    setFilters((f) => ({ ...f, [key]: event.target.value }));
    setPage(1); // a new filter invalidates the current page number
  };

  const hasFilters = Object.values(filters).some(Boolean);

  function onDelete(transaction) {
    const isTransfer = transaction.type === "TRANSFER";
    const message = isTransfer
      ? "Delete this transfer? Both sides of it will be removed."
      : "Delete this transaction?";
    if (window.confirm(message)) remove.mutate(transaction);
  }

  return (
    <div className="stack">
      <div className="page-head">
        <h1 className="page-title">Transactions</h1>
        <div className="page-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setDialog({ mode: "transfer" })}
          >
            Transfer
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setDialog({ mode: "transaction" })}
          >
            Add transaction
          </button>
        </div>
      </div>

      <div className="panel filters">
        <div className="field">
          <label htmlFor="txn-search">Search</label>
          <input
            id="txn-search"
            type="search"
            value={filters.search}
            onChange={setFilter("search")}
            placeholder="Description or notes"
          />
        </div>

        <Select label="Type" value={filters.type} onChange={setFilter("type")}>
          <option value="">All types</option>
          <option value="EXPENSE">Expense</option>
          <option value="INCOME">Income</option>
          <option value="TRANSFER">Transfer</option>
        </Select>

        <Select label="Account" value={filters.accountId} onChange={setFilter("accountId")}>
          <option value="">All accounts</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </Select>

        <Select label="Category" value={filters.categoryId} onChange={setFilter("categoryId")}>
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.icon} {category.name}
            </option>
          ))}
        </Select>

        <div className="field">
          <label htmlFor="txn-from">From</label>
          <input id="txn-from" type="date" value={filters.from} onChange={setFilter("from")} />
        </div>

        <div className="field">
          <label htmlFor="txn-to">To</label>
          <input id="txn-to" type="date" value={filters.to} onChange={setFilter("to")} />
        </div>

        {hasFilters ? (
          <button
            type="button"
            className="btn btn-ghost filters-clear"
            onClick={() => {
              setFilters(EMPTY_FILTERS);
              setPage(1);
            }}
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="alert alert-error" role="alert">
          {error.message}
        </p>
      ) : null}

      {remove.error ? (
        <p className="alert alert-error" role="alert">
          {remove.error.message}
        </p>
      ) : null}

      {isPending ? (
        <Spinner label="Loading transactions" />
      ) : (
        <div className="panel">
          <div className="panel-head">
            <p className="muted">
              {data.pagination.total} transaction{data.pagination.total === 1 ? "" : "s"}
              {isFetching ? " · updating…" : ""}
            </p>
          </div>

          {data.items.length === 0 ? (
            <p className="empty">
              {hasFilters ? "Nothing matches those filters." : "No transactions yet."}
            </p>
          ) : (
            <div className="table-scroll">
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
                    <th scope="col" className="right">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((transaction) => {
                    const isTransfer = transaction.type === "TRANSFER";
                    const isIncome = transaction.type === "INCOME";
                    const incoming = isIncome || transaction.transferDirection === "IN";

                    return (
                      <tr key={transaction.id}>
                        <td>{formatDate(transaction.date)}</td>
                        <td>{transaction.description || <span className="muted">—</span>}</td>
                        <td>
                          {isTransfer ? (
                            <span className="pill">
                              {transaction.transferDirection === "IN" ? "Transfer in" : "Transfer out"}
                            </span>
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
                          {incoming ? "+" : "−"}
                          {formatMoney(transaction.amountMinor, transaction.currency)}
                        </td>
                        <td className="right nowrap">
                          {/* Editing a transfer needs its own two-sided form,
                              so only deletion is offered here — which the API
                              correctly applies to both legs. */}
                          {!isTransfer ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => setDialog({ mode: "transaction", transaction })}
                            >
                              Edit
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => onDelete(transaction)}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {data.pagination.totalPages > 1 ? (
            <div className="pager">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                Previous
              </button>
              <span className="muted">
                Page {data.pagination.page} of {data.pagination.totalPages}
              </span>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setPage((p) => p + 1)}
                disabled={!data.pagination.hasNext}
              >
                Next
              </button>
            </div>
          ) : null}
        </div>
      )}

      <Modal
        open={dialog?.mode === "transaction"}
        onClose={() => setDialog(null)}
        title={dialog?.transaction ? "Edit transaction" : "Add transaction"}
      >
        {dialog?.mode === "transaction" ? (
          <TransactionForm
            // Remount per row so the form state starts from the right record.
            key={dialog.transaction?.id ?? "new"}
            transaction={dialog.transaction}
            onDone={() => setDialog(null)}
            onCancel={() => setDialog(null)}
          />
        ) : null}
      </Modal>

      <Modal
        open={dialog?.mode === "transfer"}
        onClose={() => setDialog(null)}
        title="Record a transfer"
      >
        {dialog?.mode === "transfer" ? (
          <TransferForm onDone={() => setDialog(null)} onCancel={() => setDialog(null)} />
        ) : null}
      </Modal>
    </div>
  );
}
