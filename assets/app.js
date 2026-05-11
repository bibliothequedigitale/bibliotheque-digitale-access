const app = document.getElementById("app");
const authTemplate = document.getElementById("auth-template");
const signOutButton = document.querySelector("[data-sign-out]");
const adminLink = document.querySelector("[data-admin-link]");

const config = window.BD_CONFIG || {};
const supabaseReady = Boolean(
  config.supabaseUrl &&
  config.supabaseAnonKey &&
  !config.supabaseUrl.includes("PASTE_") &&
  !config.supabaseAnonKey.includes("PASTE_")
);

const db = supabaseReady
  ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey)
  : null;

const state = {
  session: null,
  products: [],
  access: [],
  requests: [],
  profile: null
};

const fallbackProducts = [
  {
    id: "branding-planner-plr",
    slug: "branding-planner-plr",
    name: "Branding Planner & Workbook PLR",
    short_description: "A4, A5, and US Letter planner files with bonus strategy resources.",
    status: "active",
    display_order: 1
  },
  {
    id: "faceless-photo-pack",
    slug: "faceless-photo-pack",
    name: "Faceless Photo Pack",
    short_description: "Coming soon. This product will unlock here after purchase.",
    status: "coming_soon",
    display_order: 2
  }
];

function isAdmin() {
  const email = state.session?.user?.email?.toLowerCase();
  const configured = (config.adminEmails || []).map((item) => item.toLowerCase());
  return Boolean(email && configured.includes(email));
}

function setAdminVisibility() {
  if (adminLink) adminLink.hidden = !isAdmin();
  if (signOutButton) signOutButton.hidden = !state.session;
}

function route() {
  return location.hash.replace("#", "") || "/library";
}

function html(strings, ...values) {
  return strings.map((string, index) => `${string}${values[index] ?? ""}`).join("");
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function productImage(product) {
  const images = {
    "branding-planner-plr": "assets/branding-planner-preview.png"
  };
  return images[product.slug] || "";
}

function fileButton(label, path, className = "") {
  return `<button class="${className}" type="button" data-open-file="${escapeHtml(path)}">${escapeHtml(label)}</button>`;
}

function hasAccess(productId) {
  if (isAdmin()) return true;
  return state.access.some((item) => item.product_id === productId);
}

function hasPendingRequest(productId) {
  return state.requests.some((item) => item.product_id === productId && item.status === "pending");
}

function shouldStartWithAccessRequest() {
  return !isAdmin() && state.access.length === 0 && state.requests.length === 0;
}

function renderAuth(message = "") {
  const fragment = authTemplate.content.cloneNode(true);
  app.replaceChildren(fragment);
  const form = app.querySelector("[data-auth-form]");
  const messageNode = app.querySelector("[data-auth-message]");
  messageNode.textContent = message;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitter = event.submitter;
    const mode = submitter?.dataset.authMode || "sign-in";
    const formData = new FormData(form);
    const email = formData.get("email");
    const password = formData.get("password");

    messageNode.textContent = "Working...";

    if (!supabaseReady) {
      messageNode.textContent = "Supabase is not configured yet. Add your project URL and anon key in assets/supabase-config.js.";
      return;
    }

    const result = mode === "sign-up"
      ? await db.auth.signUp({ email, password })
      : await db.auth.signInWithPassword({ email, password });

    if (result.error) {
      messageNode.textContent = result.error.message;
      return;
    }

    messageNode.textContent = mode === "sign-up"
      ? "Account created. Check your email if confirmation is enabled, then sign in."
      : "Signed in.";

    await init();
  });
}

function renderShell(title, subtitle, body) {
  app.innerHTML = html`
    <section class="hero">
      <div class="hero-banner">
        <p class="eyebrow">Customer Access</p>
        <h1>${escapeHtml(title)}</h1>
      </div>
      <div class="hero-content">
        <div>
          <p>${escapeHtml(subtitle)}</p>
          <div class="stat-strip">
            <div class="stat"><strong>${state.products.length}</strong><br>Products</div>
            <div class="stat"><strong>${state.access.length}</strong><br>Unlocked</div>
            <div class="stat"><strong>${state.requests.filter((request) => request.status === "pending").length}</strong><br>Pending</div>
          </div>
        </div>
        <div class="notice">
          <strong>How access works</strong>
          <p>Buy on Etsy, create your account here, submit your order details, then your product unlocks after approval.</p>
        </div>
      </div>
    </section>
    ${body}
  `;
}

function renderLibrary() {
  const cards = state.products
    .sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
    .map((product) => {
      const unlocked = hasAccess(product.id);
      const pending = hasPendingRequest(product.id);
      const statusBadge = unlocked
        ? `<span class="badge unlocked">Unlocked</span>`
        : pending
          ? `<span class="badge pending">Pending approval</span>`
          : `<span class="badge locked">Locked</span>`;

      const action = unlocked
        ? `<a class="button rose" href="#/product/${escapeHtml(product.slug)}">Open Product</a>`
        : `<a class="button secondary" href="#/request-access?product=${escapeHtml(product.slug)}">Request access</a>`;
      const image = productImage(product);
      const imageMarkup = image
        ? `<img class="product-image" src="${escapeHtml(image)}" alt="${escapeHtml(product.name)} preview" loading="lazy">`
        : "";

      return html`
        <article class="card ${unlocked ? "" : "locked"}">
          ${imageMarkup}
          <div class="badge-row">${statusBadge}<span class="badge">${escapeHtml(product.status || "active")}</span></div>
          <h3>${escapeHtml(product.name)}</h3>
          <p>${escapeHtml(product.short_description || "")}</p>
          ${action}
        </article>
      `;
    })
    .join("");

  renderShell(
    "My Product Library",
    "Access every digital product you purchased from Bibliotheque Digitale. Locked products can be requested after purchase.",
    `<section class="grid">${cards}</section>`
  );
}

function renderProductPage(slug) {
  const product = state.products.find((item) => item.slug === slug);
  if (!product) {
    renderShell(
      "Product not found",
      "This product does not exist in your Bibliotheque Digitale library.",
      `<section class="notice"><a class="button" href="#/library">Back to library</a></section>`
    );
    return;
  }

  if (!hasAccess(product.id)) {
    renderShell(
      "Product Locked",
      "This product is not unlocked on your account yet.",
      `<section class="notice"><p>Request access after your Etsy purchase, then return here after approval.</p><a class="button rose" href="#/request-access?product=${escapeHtml(product.slug)}">Request access</a></section>`
    );
    return;
  }

  const files = config.productFiles?.[product.slug] || [];

  if (product.slug === "branding-planner-plr") {
    renderBrandingPlannerProduct(product, files);
    return;
  }

  renderShell(
    product.name,
    "Your product is unlocked. Open each file from here. Links are generated securely and expire automatically.",
    html`
      <section class="panel product-files">
        <div class="button-row">
          <a class="button secondary" href="#/library">Back to library</a>
        </div>
        <div class="file-list">${fileList || `<div class="empty-state">No files configured yet.</div>`}</div>
        <p class="form-note" data-file-message></p>
      </section>
    `
  );

  app.querySelectorAll("[data-open-file]").forEach((button) => {
    button.addEventListener("click", () => openSecureFile(button.dataset.openFile));
  });
}

function findFile(files, includes) {
  return files.find((file) => includes.every((part) => file.path.includes(part)))?.path || "";
}

function renderBrandingPlannerProduct(product, files) {
  const a4 = findFile(files, ["a4"]);
  const a5 = findFile(files, ["a5"]);
  const us = findFile(files, ["us-letter"]);
  const course = findFile(files, ["bonus_course"]);
  const worksheets = findFile(files, ["bonus_worksheets"]);
  const guide = findFile(files, ["branding_strategy_guide"]);
  const copyPack = findFile(files, ["customer-ready-copy-pack"]);

  app.innerHTML = html`
    <section class="product-hub">
      <div class="product-banner">
        <p class="eyebrow">Customer Product Library</p>
        <h1>Branding Planner PLR Access Hub</h1>
      </div>
      <div class="product-hero-content">
        <div>
          <p class="intro">Welcome to your private access page for the Branding Planner & Workbook PLR pack. Start by opening the planner format you need, then open the bonus course and strategy resources when you are ready to customize, brand, and prepare your product.</p>
          <div class="badge-row">
            <span class="badge">A4 PDF</span>
            <span class="badge">A5 PDF</span>
            <span class="badge">US Letter PDF</span>
            <span class="badge">Bonus Course</span>
            <span class="badge">Strategy Guide</span>
          </div>
          <div class="button-row">
            <a class="button secondary" href="#/library">Back to Library</a>
            <a class="button secondary" href="#planner-files">Planner Files</a>
            <a class="button secondary" href="#bonus-library">Bonuses</a>
          </div>
        </div>
        <div class="product-scene" aria-hidden="true">
          <div class="planner-stack">
            <div class="planner-sheet">
              <strong>A5 Planner</strong>
              <p>Compact format for smaller printable workbooks.</p>
            </div>
            <div class="planner-sheet">
              <strong>Branding Planner & Workbook</strong>
              <p>Brand foundation, positioning, visual identity, content direction, and launch planning.</p>
            </div>
            <div class="planner-sheet">
              <strong>US Letter</strong>
              <p>Ready for standard digital product buyers.</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="product-section" id="planner-files">
      <p class="eyebrow">Start Here</p>
      <h2>Your Branding Planner Files</h2>
      <p class="section-intro">Choose the size that fits your project. You can open one format or keep all three for your own product preparation.</p>
      <div class="grid">
        <article class="card featured">
          <span class="icon">A4</span>
          <h3>A4 Planner PDF</h3>
          <p>Use this format for international A4 printable workbooks and digital planning resources.</p>
          ${fileButton("Open A4 PDF", a4, "rose")}
        </article>
        <article class="card featured">
          <span class="icon">A5</span>
          <h3>A5 Planner PDF</h3>
          <p>Use this compact format for smaller printable planners, inserts, and workbook versions.</p>
          ${fileButton("Open A5 PDF", a5, "rose")}
        </article>
        <article class="card featured">
          <span class="icon">US</span>
          <h3>US Letter Planner PDF</h3>
          <p>Use this format for US Letter buyers and standard 8.5 x 11 inch printable resources.</p>
          ${fileButton("Open US Letter PDF", us, "rose")}
        </article>
      </div>
      <div class="format-note">Tip: open the format you want, then download or save it from your browser. If your browser opens the file in a new tab, use the download icon in the PDF viewer.</div>
    </section>

    <section class="product-section" id="bonus-library">
      <p class="eyebrow">Bonus Library</p>
      <h2>Your Strategy Bonuses</h2>
      <p class="section-intro">Use these resources after downloading the planner to clarify your brand direction, prepare your listing, and turn the workbook into a stronger digital product offer.</p>
      <div class="grid">
        <article class="card">
          <span class="icon">01</span>
          <h3>Mini Brand Strategy Course</h3>
          <p>Open the course with seven guided lessons, examples, and writable “Your turn” sections.</p>
          ${fileButton("Open Course", course)}
        </article>
        <article class="card">
          <span class="icon">02</span>
          <h3>Bonus Worksheets</h3>
          <p>Use the positioning, faceless brand voice, launch checklist, Instagram bio, and content pillar prompts.</p>
          ${fileButton("Open Worksheets", worksheets)}
        </article>
        <article class="card">
          <span class="icon">03</span>
          <h3>Brand Strategy Guide PDF</h3>
          <p>Download the extra branding strategy guide for additional direction as you customize your offer.</p>
          ${fileButton("Open PDF Guide", guide)}
        </article>
        <article class="card">
          <span class="icon">04</span>
          <h3>Customer-Ready Copy Pack</h3>
          <p>Copy the bonus text into your own Canva design, customize it, and export your finished bonus pages as flat PDFs.</p>
          ${fileButton("Open Copy Pack", copyPack)}
        </article>
      </div>
    </section>

    <section class="product-section">
      <p class="eyebrow">Suggested Flow</p>
      <h2>How To Use Your Files</h2>
      <div class="steps">
        <div class="step"><strong>1. Download</strong>Choose A4, A5, or US Letter depending on your product format.</div>
        <div class="step"><strong>2. Study</strong>Open the strategy guide and mini-course before editing your product.</div>
        <div class="step"><strong>3. Customize</strong>Adapt your brand direction, product promise, visuals, and buyer journey.</div>
        <div class="step"><strong>4. Publish</strong>Use the launch checklist before uploading your final files and listing images.</div>
      </div>
    </section>

    <section class="notice">
      <strong>Important access note</strong>
      <p>This private page is for customers who purchased the Branding Planner PLR pack. Secure file links are generated only from inside your approved account and expire automatically.</p>
      <p class="form-note" data-file-message></p>
    </section>

    <section class="notice">
      <strong>License reminder</strong>
      <p>This access page is for you, the direct customer. Your customers should receive your finished flat files only. Do not send your customers this private site link.</p>
      <div class="license-grid">
        <div class="license-card">
          <h3>You can</h3>
          <ul>
            <li>Customize the main Branding Planner & Workbook for your own brand.</li>
            <li>Sell your finished flattened planner files as PDF, PNG, or JPEG.</li>
            <li>Use the bonus resources to prepare, improve, and package your offer.</li>
            <li>Export or recreate bonus pages as finished flat PDFs for your customers.</li>
            <li>Copy the Customer-Ready Copy Pack text into your own Canva design.</li>
          </ul>
        </div>
        <div class="license-card">
          <h3>You cannot</h3>
          <ul>
            <li>Transfer PLR/resale rights to your customers.</li>
            <li>Sell the main planner or bonuses as a new PLR pack.</li>
            <li>Share this private access site with your customers.</li>
            <li>Give away editable source files, raw templates, or private links.</li>
            <li>Claim your customers can resell or redistribute the files with PLR rights.</li>
          </ul>
        </div>
      </div>
    </section>
  `;

  app.querySelectorAll("[data-open-file]").forEach((button) => {
    button.addEventListener("click", () => openSecureFile(button.dataset.openFile));
  });
}

async function openSecureFile(path) {
  const message = app.querySelector("[data-file-message]");
  if (message) message.textContent = "Preparing secure link...";

  const { data, error } = await db
    .storage
    .from(config.storageBucket || "product-files")
    .createSignedUrl(path, 600);

  if (error) {
    if (message) message.textContent = error.message;
    return;
  }

  if (message) message.textContent = "Secure link ready. It opens in a new tab and expires automatically.";
  window.open(data.signedUrl, "_blank", "noopener");
}

function renderRequestAccess() {
  const params = new URLSearchParams(route().split("?")[1] || "");
  const requestedSlug = params.get("product") || "";
  const options = state.products
    .filter((product) => product.status !== "archived")
    .map((product) => {
      const checked = product.slug === requestedSlug || (!requestedSlug && product.slug === "branding-planner-plr");
      const disabled = hasAccess(product.id) ? "disabled" : "";
      const badge = hasAccess(product.id) ? "Already unlocked" : hasPendingRequest(product.id) ? "Pending" : product.status;
      return html`
        <label class="choice-card">
          <input type="checkbox" name="product_ids" value="${escapeHtml(product.id)}" ${checked ? "checked" : ""} ${disabled}>
          <span>
            <strong>${escapeHtml(product.name)}</strong>
            <small>${escapeHtml(product.short_description || "")}</small>
            <em>${escapeHtml(badge || "active")}</em>
          </span>
        </label>
      `;
    })
    .join("");

  app.innerHTML = html`
    <section class="hero">
      <div class="hero-banner">
        <p class="eyebrow">Request Access</p>
        <h1>Unlock your purchased product.</h1>
      </div>
      <div class="hero-content">
        <div>
          <p>Select the product or products you purchased, then send your Etsy order details. Access is approved manually after a quick Etsy check.</p>
          <p class="form-note">For testing, you can enter TEST as the order number. For real customers, ask them to enter their Etsy order number or buyer information.</p>
        </div>
        <form class="panel" data-request-form>
          <div class="choice-group" role="group" aria-label="Products requested">${options}</div>
          <label>Etsy order number
            <input name="etsy_order_number" placeholder="Example: 1234567890 or TEST">
          </label>
          <label>Etsy email or buyer name
            <input name="etsy_buyer_info" required placeholder="Email, username, or buyer name">
          </label>
          <label>Notes
            <textarea name="notes" placeholder="Anything that helps verify the purchase"></textarea>
          </label>
          <button type="submit" class="rose">Submit request</button>
          <p class="form-note" data-request-message></p>
        </form>
      </div>
    </section>
  `;

  app.querySelector("[data-request-form]").addEventListener("submit", submitAccessRequest);
}

async function submitAccessRequest(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = form.querySelector("[data-request-message]");
  const formData = new FormData(form);
  message.textContent = "Submitting...";

  const productIds = formData.getAll("product_ids");
  if (!productIds.length) {
    message.textContent = "Choose at least one product to request.";
    return;
  }

  const orderNumber = String(formData.get("etsy_order_number") || "").trim() || "Not provided";
  const buyerInfo = String(formData.get("etsy_buyer_info") || "").trim();
  const notes = String(formData.get("notes") || "").trim();

  const payload = productIds.map((productId) => ({
    user_id: state.session.user.id,
    customer_email: state.session.user.email,
    product_id: productId,
    etsy_order_number: orderNumber,
    etsy_buyer_info: buyerInfo,
    notes,
    status: "pending"
  }));

  const { error } = await db.from("access_requests").insert(payload);
  if (error) {
    message.textContent = error.message;
    return;
  }

  message.textContent = "Request submitted. It will appear in the admin dashboard for approval.";
  form.reset();
  await loadData();
}

function renderAdmin() {
  if (!isAdmin()) {
    renderShell(
      "Admin Access",
      "This page is only available to the Bibliotheque Digitale admin account.",
      `<section class="notice"><strong>Access denied</strong><p>Sign in with the admin email configured for this site.</p></section>`
    );
    return;
  }

  const rows = state.requests
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .map((request) => {
      const product = state.products.find((item) => item.id === request.product_id);
      const actions = request.status === "pending"
        ? html`
          <button class="success" type="button" data-approve="${escapeHtml(request.id)}">Approve</button>
          <button class="danger" type="button" data-reject="${escapeHtml(request.id)}">Reject</button>
        `
        : `<span class="badge ${request.status === "approved" ? "unlocked" : "locked"}">${escapeHtml(request.status)}</span>`;

      return html`
        <tr>
          <td>${escapeHtml(request.customer_email || request.user_email || "")}</td>
          <td>${escapeHtml(product?.name || request.product_id)}</td>
          <td>${escapeHtml(request.etsy_order_number)}</td>
          <td>${escapeHtml(request.etsy_buyer_info || "")}</td>
          <td>${escapeHtml(request.notes || "")}</td>
          <td>${escapeHtml(request.status)}</td>
          <td><div class="button-row">${actions}</div></td>
        </tr>
      `;
    })
    .join("");

  renderShell(
    "Admin Dashboard",
    "Compare the request with Etsy, then approve the product access in one click.",
    html`
      <section class="panel">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Product</th>
                <th>Etsy order</th>
                <th>Buyer info</th>
                <th>Notes</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>${rows || `<tr><td colspan="7"><div class="empty-state">No access requests yet.</div></td></tr>`}</tbody>
          </table>
        </div>
      </section>
    `
  );

  app.querySelectorAll("[data-approve]").forEach((button) => {
    button.addEventListener("click", () => approveRequest(button.dataset.approve));
  });

  app.querySelectorAll("[data-reject]").forEach((button) => {
    button.addEventListener("click", () => rejectRequest(button.dataset.reject));
  });
}

async function approveRequest(requestId) {
  const request = state.requests.find((item) => item.id === requestId);
  if (!request) return;

  const accessPayload = {
    user_id: request.user_id,
    product_id: request.product_id,
    source: "etsy_manual_approval",
    source_reference: request.etsy_order_number,
    granted_by: state.session.user.id
  };

  const { error: accessError } = await db.from("user_products").upsert(accessPayload, {
    onConflict: "user_id,product_id"
  });

  if (accessError) {
    alert(accessError.message);
    return;
  }

  const { error: requestError } = await db
    .from("access_requests")
    .update({
      status: "approved",
      reviewed_by: state.session.user.id,
      reviewed_at: new Date().toISOString()
    })
    .eq("id", requestId);

  if (requestError) {
    alert(requestError.message);
    return;
  }

  await loadData();
  renderAdmin();
}

async function rejectRequest(requestId) {
  const { error } = await db
    .from("access_requests")
    .update({
      status: "rejected",
      reviewed_by: state.session.user.id,
      reviewed_at: new Date().toISOString()
    })
    .eq("id", requestId);

  if (error) {
    alert(error.message);
    return;
  }

  await loadData();
  renderAdmin();
}

async function loadData() {
  const productResult = await db
    .from("products")
    .select("*")
    .order("display_order", { ascending: true });
  state.products = productResult.data?.length ? productResult.data : fallbackProducts;

  const accessResult = await db
    .from("user_products")
    .select("*")
    .eq("user_id", state.session.user.id);
  state.access = accessResult.data || [];

  if (isAdmin()) {
    const requestResult = await db
      .from("access_requests")
      .select("*")
      .order("created_at", { ascending: false });
    state.requests = requestResult.data || [];
  } else {
    const requestResult = await db
      .from("access_requests")
      .select("*")
      .eq("user_id", state.session.user.id)
      .order("created_at", { ascending: false });
    state.requests = requestResult.data || [];
  }
}

async function renderRoute() {
  setAdminVisibility();

  if (!supabaseReady) {
    app.innerHTML = html`
      <section class="notice">
        <strong>Supabase is not configured yet</strong>
        <p>Add your Supabase URL and anon key in <code>assets/supabase-config.js</code>, then run the SQL schema in Supabase.</p>
      </section>
    `;
    return;
  }

  if (!state.session) {
    renderAuth();
    return;
  }

  await loadData();
  setAdminVisibility();

  const current = route().split("?")[0];
  if (current === "/library" && shouldStartWithAccessRequest()) {
    renderRequestAccess();
    return;
  }
  if (current.startsWith("/product/")) renderProductPage(current.replace("/product/", ""));
  else if (current === "/request-access") renderRequestAccess();
  else if (current === "/admin") renderAdmin();
  else renderLibrary();
}

async function init() {
  if (!supabaseReady) {
    renderRoute();
    return;
  }

  const { data } = await db.auth.getSession();
  state.session = data.session;
  await renderRoute();
}

signOutButton?.addEventListener("click", async () => {
  await db.auth.signOut();
  state.session = null;
  state.access = [];
  state.requests = [];
  location.hash = "#/library";
  await renderRoute();
});

window.addEventListener("hashchange", renderRoute);

if (db) {
  db.auth.onAuthStateChange((_event, session) => {
    state.session = session;
    renderRoute();
  });
}

init();
