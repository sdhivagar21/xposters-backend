import { useEffect, useState } from "react";
import AdminLayout from "../../components/admin/AdminLayout.jsx";
import { fetchAdminOrders, updateOrderStatus } from "../../api/admin.js";

const STATUSES = ["placed", "processing", "shipped", "delivered", "cancelled"];

const STATUS_LABELS = {
  placed: "Placed",
  processing: "Processing",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const STATUS_COLORS = {
  placed: "text-white/70",
  processing: "text-amber-400",
  shipped: "text-sky-400",
  delivered: "text-emerald-400",
  cancelled: "text-red-400",
};

export default function AdminOrders() {
  const [orders, setOrders] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);

  useEffect(() => {
    fetchAdminOrders()
      .then(setOrders)
      .catch(() => setError("Couldn't load orders."))
      .finally(() => setLoading(false));
  }, []);

  async function handleStatusChange(order, newStatus) {
    if (newStatus === order.status) return;
    const prevStatus = order.status;
    setUpdatingId(order.id);
    // Optimistic update so the dropdown reflects the change right away.
    setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status: newStatus } : o)));
    try {
      await updateOrderStatus(order.id, newStatus);
    } catch {
      setError("Couldn't update that order's status - try again.");
      setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status: prevStatus } : o)));
    } finally {
      setUpdatingId(null);
    }
  }

  const visibleOrders = statusFilter ? orders.filter((o) => o.status === statusFilter) : orders;

  return (
    <AdminLayout>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-3xl">Orders</h1>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-[var(--xp-border-strong)] bg-transparent px-3 py-2 text-sm text-white/80"
        >
          <option value="" className="bg-[#0c0b09]">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s} className="bg-[#0c0b09]">
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="mt-6 text-sm text-white/50">{error}</p>}
      {loading && <p className="mt-6 text-sm text-white/40">Loading...</p>}

      {!loading && visibleOrders.length === 0 && (
        <p className="mt-10 text-sm text-white/40">
          {statusFilter ? "No orders with that status." : "No orders placed yet."}
        </p>
      )}

      {!loading && visibleOrders.length > 0 && (
        <div className="mt-8 space-y-4">
          {visibleOrders.map((order) => (
            <div key={order.id} className="border border-[var(--xp-border)] p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-display text-lg tracking-wide">{order.orderId}</p>
                <div className="flex items-center gap-3">
                  <p className="text-xs text-white/40">{new Date(order.createdAt).toLocaleString()}</p>
                  <select
                    value={order.status}
                    onChange={(e) => handleStatusChange(order, e.target.value)}
                    disabled={updatingId === order.id}
                    className={`border border-[var(--xp-border-strong)] bg-transparent px-2 py-1.5 text-xs disabled:opacity-50 ${STATUS_COLORS[order.status]}`}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s} className="bg-[#0c0b09] text-white">
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <div className="text-sm text-white/70">
                  <p>{order.customer.name}</p>
                  <p className="text-white/40">{order.customer.email}</p>
                  <p className="text-white/40">{order.customer.phone}</p>
                  <p className="text-white/40">{order.customer.address}</p>
                </div>
                <div>
                  <ul className="space-y-1 text-sm">
                    {order.items.map((item, i) => (
                      <li key={i} className="flex justify-between text-white/70">
                        <span>
                          {item.name} × {item.qty}
                        </span>
                        <span>₹{item.qty * item.price}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 flex justify-between border-t border-[var(--xp-border)] pt-2 text-sm font-medium">
                    <span>Subtotal</span>
                    <span>₹{order.subtotal}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminLayout>
  );
}