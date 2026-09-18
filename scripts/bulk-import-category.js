// Marks a few products in every category as "featured" so the homepage's
// scrolling poster wall has something to show. Run once after a bulk
// import (which always creates products as featured: false by default).
//
// Requires Node 18+ (uses the built-in fetch/FormData globals).
//
// Usage:
//   node scripts/mark-random-featured.js [count-per-category]
//   (count-per-category defaults to 3 if not given)

const fs = require("fs");
const path = require("path");

const envFile = path.join(__dirname, ".env.import");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}

const BACKEND_URL = process.env.BACKEND_URL;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

async function login() {
  const res = await fetch(`${BACKEND_URL}/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login failed (${res.status}): ${await res.text()}`);
  return (await res.json()).token;
}

async function fetchAllProducts(token) {
  const res = await fetch(`${BACKEND_URL}/admin/products`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Fetching products failed (${res.status}): ${await res.text()}`);
  return res.json();
}

async function markFeatured(token, id) {
  const form = new FormData();
  form.append("featured", "true");
  const res = await fetch(`${BACKEND_URL}/admin/products/${id}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Update failed (${res.status}): ${await res.text()}`);
  return res.json();
}

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function main() {
  const perCategory = Number(process.argv[2]) || 3;

  if (!BACKEND_URL || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error(
      "Missing BACKEND_URL / ADMIN_EMAIL / ADMIN_PASSWORD.\n" +
        "Set them as environment variables, or create scripts/.env.import."
    );
    process.exit(1);
  }

  console.log(`Marking up to ${perCategory} product(s) per category as featured...`);
  console.log("Logging in...");
  const token = await login();
  console.log("Logged in. Fetching all products...");
  const products = await fetchAllProducts(token);
  console.log(`Found ${products.length} total product(s).\n`);

  const byCategory = {};
  for (const p of products) {
    if (!byCategory[p.category]) byCategory[p.category] = [];
    byCategory[p.category].push(p);
  }

  let count = 0;
  for (const [category, list] of Object.entries(byCategory)) {
    const notYetFeatured = list.filter((p) => !p.featured);
    const toFeature = shuffle(notYetFeatured).slice(0, perCategory);

    for (const p of toFeature) {
      try {
        await markFeatured(token, p.id);
        count++;
        console.log(`OK   ${category}  ->  "${p.name}"`);
      } catch (err) {
        console.log(`FAIL ${category}  ->  "${p.name}"  ->  ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  console.log(`\nDone. ${count} product(s) marked featured across ${Object.keys(byCategory).length} categories.`);
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
