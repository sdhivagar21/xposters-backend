function generateOrderId() {
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `XP-${Date.now().toString(36).toUpperCase()}-${rand}`;
}

module.exports = { generateOrderId };
