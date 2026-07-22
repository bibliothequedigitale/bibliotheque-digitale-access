const app = document.getElementById("app");
const authTemplate = document.getElementById("auth-template");
const signOutButton = document.querySelector("[data-sign-out]");
const adminLink = document.querySelector("[data-admin-link]");
const sidebarAccount = document.querySelector("[data-sidebar-account]");
const profileNameNode = document.querySelector("[data-profile-name]");
const profileInitialNode = document.querySelector("[data-profile-initial]");
const brandLink = document.querySelector(".brand");
const publicLoginLink = document.querySelector(".public-login");

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

let passwordRecoveryMode = false;

const fallbackProducts = [
  {
    id: "branding-planner-plr",
    slug: "branding-planner-plr",
    name: "Branding Planner & Workbook PLR",
    short_description: "A4, A5, and US Letter planner files with bonus strategy resources.",
    status: "active",
    display_order: 1
  }
];

function isAdmin() {
  const email = state.session?.user?.email?.toLowerCase();
  const configured = (config.adminEmails || []).map((item) => item.toLowerCase());
  return Boolean(email && configured.includes(email));
}

function setAdminVisibility() {
  const current = route().split("?")[0];
  const viewingPublicSite = current === "/home" || current === "/";
  if (adminLink) adminLink.hidden = !isAdmin();
  if (signOutButton) signOutButton.hidden = !state.session;
  if (sidebarAccount) sidebarAccount.hidden = !state.session || viewingPublicSite;
  document.body.classList.toggle("has-session", Boolean(state.session) && !viewingPublicSite);
  document.body.classList.toggle("public-site", !state.session || viewingPublicSite);
  if (brandLink) brandLink.href = "#/home";
  if (publicLoginLink) {
    publicLoginLink.href = state.session ? "#/library" : "#/login";
    publicLoginLink.textContent = state.session ? "Mon espace client" : "Espace client";
  }

  if (state.session) {
    const firstName = customerFirstName();
    if (profileNameNode) profileNameNode.textContent = `${firstName} 👋`;
    if (profileInitialNode) profileInitialNode.textContent = firstName.charAt(0).toUpperCase();
  }

  document.querySelectorAll(".portal-nav a[href^='#/']").forEach((link) => {
    const destination = link.getAttribute("href").replace("#", "");
    const active = destination === current || (destination === "/products" && current.startsWith("/product/"));
    link.classList.toggle("active", active);
  });
}

function route() {
  return location.hash.replace("#", "") || "/home";
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

function customerFirstName() {
  const metadata = state.session?.user?.user_metadata || {};
  const savedName = String(metadata.first_name || metadata.given_name || metadata.name || "").trim();
  const emailName = String(state.session?.user?.email || "")
    .split("@")[0]
    .split(/[._-]/)[0]
    .replace(/\d+/g, "")
    .trim();
  const firstName = savedName.split(/\s+/)[0] || emailName || "there";
  return firstName.charAt(0).toUpperCase() + firstName.slice(1);
}

function shouldStartWithAccessRequest() {
  return !isAdmin() && state.access.length === 0 && state.requests.length === 0;
}

function renderAuth(message = "") {
  const fragment = authTemplate.content.cloneNode(true);
  app.replaceChildren(fragment);
  const form = app.querySelector("[data-auth-form]");
  const messageNode = app.querySelector("[data-auth-message]");
  const forgotPasswordButton = app.querySelector("[data-forgot-password]");
  const recoveryPanel = app.querySelector("[data-password-recovery-request]");
  const recoveryEmail = app.querySelector('[name="recovery_email"]');
  const sendRecoveryButton = app.querySelector("[data-send-recovery]");
  const recoveryMessage = app.querySelector("[data-recovery-message]");
  messageNode.textContent = message;

  const onboardingForm = app.querySelector("[data-onboarding-form]");
  const productSelect = onboardingForm.querySelector("[data-onboarding-products]");
  const availableProducts = fallbackProducts.filter((product) => product.status === "active");
  productSelect.innerHTML = availableProducts
    .map((product) => `<option value="${escapeHtml(product.slug)}">${escapeHtml(product.name)}</option>`)
    .join("");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const email = formData.get("email");
    const password = formData.get("password");

    messageNode.textContent = "Working...";

    if (!supabaseReady) {
      messageNode.textContent = "Supabase is not configured yet. Add your project URL and anon key in assets/supabase-config.js.";
      return;
    }

    const result = await db.auth.signInWithPassword({ email, password });

    if (result.error) {
      messageNode.textContent = result.error.message;
      return;
    }

    messageNode.textContent = "Signed in.";

    await init();
  });

  onboardingForm.addEventListener("submit", submitOnboardingRequest);

  forgotPasswordButton.addEventListener("click", () => {
    recoveryPanel.hidden = !recoveryPanel.hidden;
    forgotPasswordButton.textContent = recoveryPanel.hidden ? "Forgot your password?" : "Close password reset";
    if (!recoveryPanel.hidden) {
      recoveryEmail.value = form.querySelector('[name="email"]').value;
      recoveryEmail.focus();
    }
  });

  sendRecoveryButton.addEventListener("click", async () => {
    const email = recoveryEmail.value.trim();
    if (!email) {
      recoveryMessage.textContent = "Please enter your email address.";
      return;
    }

    sendRecoveryButton.disabled = true;
    recoveryMessage.textContent = "Sending your secure link...";
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo });
    sendRecoveryButton.disabled = false;

    recoveryMessage.textContent = error
      ? error.message
      : "Email sent. Check your inbox and spam folder, then click the link to choose a new password.";
  });
}

function renderPasswordReset() {
  setAdminVisibility();
  app.innerHTML = html`
    <section class="password-reset-shell">
      <div class="password-reset-card">
        <p class="eyebrow">Secure customer access</p>
        <h1>Choose your new password</h1>
        <p>Create a password of at least 8 characters, then return to your Bibliothèque Digitale space.</p>
        <form data-new-password-form>
          <label>New password
            <input name="new_password" type="password" autocomplete="new-password" minlength="8" required>
          </label>
          <label>Confirm new password
            <input name="confirm_password" type="password" autocomplete="new-password" minlength="8" required>
          </label>
          <button class="rose full-button" type="submit">Save my new password</button>
          <p class="form-note" data-new-password-message></p>
        </form>
      </div>
    </section>
  `;

  const form = app.querySelector("[data-new-password-form]");
  const message = app.querySelector("[data-new-password-message]");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const password = String(data.get("new_password") || "");
    const confirmation = String(data.get("confirm_password") || "");
    if (password !== confirmation) {
      message.textContent = "The two passwords do not match.";
      return;
    }

    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    message.textContent = "Saving...";
    const { error } = await db.auth.updateUser({ password });
    button.disabled = false;
    if (error) {
      message.textContent = error.message;
      return;
    }

    passwordRecoveryMode = false;
    message.textContent = "Your password has been updated. Opening your customer space...";
    window.setTimeout(() => {
      location.hash = "#/library";
      renderRoute();
    }, 900);
  });
}

async function submitOnboardingRequest(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = form.querySelector("[data-onboarding-message]");
  const button = form.querySelector('button[type="submit"]');
  const formData = new FormData(form);
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const firstName = String(formData.get("first_name") || "").trim();
  const productSlug = String(formData.get("product_slug") || "");

  message.textContent = "Creating your account and request...";
  button.disabled = true;

  if (!supabaseReady) {
    message.textContent = "The customer library is temporarily unavailable. Please contact Bibliotheque Digitale.";
    button.disabled = false;
    return;
  }

  const { data: signUpData, error: signUpError } = await db.auth.signUp({
    email,
    password,
    options: { data: { first_name: firstName } }
  });
  if (signUpError) {
    message.textContent = signUpError.message.toLowerCase().includes("already")
      ? "An account already exists for this email. Please use the sign-in form below."
      : signUpError.message;
    button.disabled = false;
    return;
  }

  if (!signUpData.session) {
    message.textContent = "Your account was created but email confirmation is still enabled. Please contact Bibliotheque Digitale so we can activate it.";
    button.disabled = false;
    return;
  }

  state.session = signUpData.session;
  await loadData();
  const product = state.products.find((item) => item.slug === productSlug);

  if (!product) {
    message.textContent = "Your account is ready, but this product could not be found. Please use Request Access from your library.";
    button.disabled = false;
    return;
  }

  const payload = {
    user_id: state.session.user.id,
    customer_email: state.session.user.email,
    product_id: product.id,
    etsy_order_number: String(formData.get("etsy_order_number") || "").trim(),
    etsy_buyer_info: String(formData.get("etsy_buyer_info") || "").trim(),
    notes: String(formData.get("notes") || "").trim(),
    status: "pending"
  };

  const { error: requestError } = await db.from("access_requests").insert(payload);
  if (requestError) {
    message.textContent = `Your account is ready, but the request could not be sent: ${requestError.message}`;
    button.disabled = false;
    return;
  }

  location.hash = "/library";
  await init();
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

function productCardMarkup(product, compact = false) {
  const unlocked = hasAccess(product.id);
  const pending = hasPendingRequest(product.id);
  const statusBadge = unlocked
    ? `<span class="badge unlocked">Unlocked</span>`
    : pending
      ? `<span class="badge pending">Pending approval</span>`
      : `<span class="badge locked">Locked</span>`;
  const action = unlocked
    ? `<a class="button rose" href="#/product/${escapeHtml(product.slug)}">Open product</a>`
    : pending
      ? `<span class="pending-note">We are checking your purchase.</span>`
      : `<a class="button secondary" href="#/request-access?product=${escapeHtml(product.slug)}">Request access</a>`;
  const image = productImage(product);

  return html`
    <article class="card product-card ${compact ? "compact" : ""} ${unlocked ? "" : "locked"}">
      <div class="product-cover ${image ? "has-image" : "placeholder-cover"}">
        ${image ? `<img class="product-image" src="${escapeHtml(image)}" alt="${escapeHtml(product.name)} preview" loading="lazy">` : `<span>BD</span>`}
        <div class="cover-badge">${statusBadge}</div>
      </div>
      <div class="product-card-body">
        <p class="card-kicker">Digital product</p>
        <h3>${escapeHtml(product.name)}</h3>
        <p>${escapeHtml(product.short_description || "")}</p>
        ${action}
      </div>
    </article>
  `;
}

function renderDashboard() {
  const firstName = customerFirstName();
  const unlockedProducts = state.products.filter((product) => hasAccess(product.id));
  const pendingProducts = state.products.filter((product) => hasPendingRequest(product.id));
  const nextProduct = unlockedProducts[0];
  const primaryAction = nextProduct
    ? `<a class="button portal-primary" href="#/product/${escapeHtml(nextProduct.slug)}">Continue with my product <span>\u2192</span></a>`
    : pendingProducts.length
      ? `<a class="button portal-secondary" href="#/products">View my pending request</a>`
      : `<a class="button portal-primary" href="#/request-access">Request product access <span>\u2192</span></a>`;
  const featuredProducts = state.products
    .sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
    .slice(0, 3)
    .map((product) => productCardMarkup(product, true))
    .join("");

  app.innerHTML = html`
    <section class="portal-welcome">
      <div class="welcome-copy">
        <p class="eyebrow">Your private customer space</p>
        <h1>Hello ${escapeHtml(firstName)} 👋<br><em>welcome back.</em></h1>
        <p>Everything you purchased from Bibliotheque Digitale lives here: your products, guided resources and exclusive bonuses.</p>
        <div class="welcome-actions">
          ${primaryAction}
          <a class="text-link" href="#/profile">Manage my account</a>
        </div>
      </div>
      <div class="welcome-summary">
        <span class="summary-monogram">${escapeHtml(firstName.charAt(0).toUpperCase())}</span>
        <p>Member library</p>
        <strong>${unlockedProducts.length}</strong>
        <span>product${unlockedProducts.length === 1 ? "" : "s"} unlocked</span>
        <div class="summary-divider"></div>
        <small>${pendingProducts.length ? `${pendingProducts.length} request pending` : "All caught up"}</small>
      </div>
    </section>

    <section class="portal-section">
      <div class="section-title-row">
        <div><p class="eyebrow">Your collection</p><h2>My products</h2></div>
        <a class="text-link" href="#/products">View all products \u2192</a>
      </div>
      <div class="dashboard-products">${featuredProducts}</div>
    </section>

    <section class="quick-space-grid">
      <a class="space-card dark" href="#/shop">
        <span class="space-number">01</span><p class="eyebrow">Coming next</p>
        <h2>The Digital Shop</h2><p>Discover new planners, business resources and ready-to-use digital products selected for your next idea.</p>
        <strong>Preview the shop \u2192</strong>
      </a>
      <a class="space-card blush" href="#/community">
        <span class="space-number">02</span><p class="eyebrow">Customer club</p>
        <h2>A space to feel supported</h2><p>Updates, inspiration and thoughtful guidance around your digital products will soon live here.</p>
        <strong>Discover the community space \u2192</strong>
      </a>
      <a class="space-card paper" href="#/profile">
        <span class="space-number">03</span><p class="eyebrow">Personal space</p>
        <h2>My account</h2><p>Keep your first name and account details up to date so your customer space always feels like yours.</p>
        <strong>Open my profile \u2192</strong>
      </a>
    </section>

    <section class="dashboard-aia-teaser">
      <img src="assets/aia-funnel/aina-editorial-closeup.png" alt="A\u00efna, AI influencer and brand muse" loading="lazy">
      <div><p class="eyebrow">From digital product to digital presence</p><h2>Ready to give your brand a face?</h2><p>Meet THE A.I.A and discover how an AI influencer can embody your universe, create content and support your business.</p><a class="button aia-button" href="#/discover-the-aia">Meet THE A.I.A</a></div>
    </section>
  `;
}

function renderProductsLibrary() {
  const cards = state.products
    .sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
    .map((product) => productCardMarkup(product))
    .join("");

  renderShell(
    "My Product Library",
    `Hello ${customerFirstName()}. Find every product you purchased, see what is pending and open your exclusive bonuses.`,
    html`
      <section class="grid">${cards}</section>
      <section class="aia-library-bridge">
        <div class="aia-library-image">
          <img src="assets/aia-funnel/aina-editorial-closeup.png" alt="Aïna embodying a premium editorial brand" loading="lazy">
        </div>
        <div class="aia-library-copy">
          <p class="eyebrow">Your next chapter</p>
          <h2>You built the brand. Now bring it to life.</h2>
          <p>Your positioning, identity and offer are the foundation. Discover how an AI influencer or digital twin can embody your universe, create content and help your digital business grow—without putting you in front of the camera.</p>
          <a class="button aia-button" href="#/discover-the-aia">Discover THE A.I.A</a>
        </div>
      </section>
    `
  );
}

function renderDiscoverAia() {
  const salesPage = "https://the-aicon-academy.vercel.app/pages/vente-b.html?utm_source=bibliotheque_digitale&utm_medium=customer_library&utm_campaign=branding_planner_bridge&utm_content=discover_aia";

  app.innerHTML = html`
    <section class="aia-page">
      <div class="aia-hero">
        <div class="aia-hero-copy">
          <a class="aia-back" href="#/library">← Back to my library</a>
          <p class="eyebrow">From brand foundation to living presence</p>
          <h1>Your brand deserves more than a beautiful product. <em>It deserves a presence.</em></h1>
          <p class="aia-lead">You now have the foundations: your positioning, message, identity and offer. The next step is turning that strategy into a recognizable world people can see, feel and remember.</p>
          <div class="button-row">
            <a class="button aia-button" href="${salesPage}" target="_blank" rel="noopener">Meet THE A.I.A</a>
            <a class="button aia-outline" href="#aia-possibilities">See what becomes possible</a>
          </div>
          <p class="aia-language-note">THE A.I.A is currently delivered in French. Text lessons can be translated into your preferred language directly in Google Chrome.</p>
        </div>
        <div class="aia-hero-visual">
          <img src="assets/aia-funnel/aina-hero.png" alt="Aïna, the AI influencer behind THE A.I.A">
          <span>Meet Aïna · AI influencer · brand muse</span>
        </div>
      </div>

      <section class="aia-manifesto">
        <p class="eyebrow">The missing bridge</p>
        <h2>You do not need to become the influencer.<br><em>You can create the influencer your brand needs.</em></h2>
        <p>A strong brand still needs visibility, consistent content and a way to connect with the right audience. THE A.I.A shows you how to build an AI influencer or digital twin capable of embodying your universe, presenting your products and supporting a monetizable online presence—without filming yourself every day.</p>
      </section>

      <section class="aia-possibilities" id="aia-possibilities">
        <div class="aia-editorial-image tall">
          <img src="assets/aia-funnel/aina-editorial-full.png" alt="Editorial campaign created with an AI brand muse" loading="lazy">
        </div>
        <div class="aia-possibilities-copy">
          <p class="eyebrow">What you can build</p>
          <h2>One identity. A complete content and revenue universe.</h2>
          <div class="aia-point-grid">
            <article><strong>01</strong><h3>Create your AI muse</h3><p>Design an ultra-realistic influencer or digital twin aligned with your brand identity.</p></article>
            <article><strong>02</strong><h3>Produce without filming</h3><p>Create editorial, lifestyle, UGC, video, podcast and social content without showing your face.</p></article>
            <article><strong>03</strong><h3>Promote your offers</h3><p>Give your digital products, expertise or signature offer a recognizable face and story.</p></article>
            <article><strong>04</strong><h3>Choose your revenue path</h3><p>Explore digital products, affiliate income, paid UGC, brand collaborations and your own offer.</p></article>
          </div>
        </div>
      </section>

      <section class="aia-proof-strip">
        <div><strong>3</strong><span>strategic transformation phases</span></div>
        <div><strong>25+</strong><span>missions, workshops and resources</span></div>
        <div><strong>6</strong><span>possible monetization paths</span></div>
        <div><strong>1</strong><span>private learning community</span></div>
      </section>

      <section class="aia-final-cta">
        <div class="aia-final-image">
          <img src="assets/aia-funnel/aina-editorial-closeup.png" alt="Aïna in a premium editorial beauty campaign" loading="lazy">
        </div>
        <div>
          <p class="eyebrow">Your brand is ready for a face</p>
          <h2>Turn your strategy into a presence people remember.</h2>
          <p>Discover the complete path to create your AI influencer, build content around your universe and connect it to the revenue model that fits your business.</p>
          <a class="button aia-button" href="${salesPage}" target="_blank" rel="noopener">Discover THE A.I.A</a>
          <p class="aia-language-note">You will open the full French sales page in a new tab. Chrome can translate its text automatically.</p>
        </div>
      </section>
    </section>
  `;
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
          <h3>The Brand Blueprint Course</h3>
          <p>Follow twelve premium modules with examples, strategic workshops, saved progress and a complete Brand Book project.</p>
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
          <h3>Canva PLR Customization Studio</h3>
          <p>Copy the editable text into Canva, then adapt the strategy, audience, examples and design to create your own branded version.</p>
          ${fileButton("Open Customization Studio", copyPack)}
        </article>
      </div>
    </section>

    <section class="aia-product-bridge">
      <div>
        <p class="eyebrow">After your brand strategy</p>
        <h2>Ready to turn your brand into content?</h2>
        <p>Your planner gives you the strategy. THE A.I.A shows you how to create an AI face for your brand, produce content without filming yourself and connect that presence to real monetization paths.</p>
        <a class="button aia-button" href="#/discover-the-aia">See the next step</a>
      </div>
      <img src="assets/aia-funnel/aina-editorial-full.png" alt="Aïna in a premium AI editorial campaign" loading="lazy">
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
            <li>Use the Canva PLR Customization Studio to adapt the text, positioning, examples and visual direction to your own brand.</li>
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
  showFileStatus("Preparing your secure resource...", "loading");

  if (!path) {
    showFileStatus("This resource is not configured yet. Please contact Bibliotheque Digitale.", "error");
    return;
  }

  const extension = path.split(".").pop().toLowerCase();
  const isBrowserText = ["html", "htm", "md", "markdown", "txt"].includes(extension);
  const resourceTab = window.open("", "_blank");

  if (!resourceTab) {
    showFileStatus("Please allow pop-ups for this site, then click Open again.", "error");
    return;
  }

  resourceTab.document.title = "Loading secure resource...";
  resourceTab.document.body.textContent = "Loading your secure resource...";

  if (isBrowserText) {
    const { data: htmlFile, error: downloadError } = await db
      .storage
      .from(config.storageBucket || "product-files")
      .download(path);

    if (downloadError) {
      resourceTab.close();
      showFileStatus(
        downloadError.message || "Your file could not be opened. Please sign out, sign in again, and retry.",
        "error"
      );
      return;
    }

    const fileContent = await htmlFile.text();
    const htmlContent = ["md", "markdown", "txt"].includes(extension)
      ? createTextResourceViewer(fileContent, path)
      : fileContent;
    const displayFile = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
    const displayUrl = URL.createObjectURL(displayFile);
    resourceTab.location.replace(displayUrl);
    setTimeout(() => URL.revokeObjectURL(displayUrl), 60000);

    showFileStatus("Secure resource opened in a new tab.", "success");
    return;
  }

  const { data, error } = await db
    .storage
    .from(config.storageBucket || "product-files")
    .createSignedUrl(path, 600);

  if (error) {
    resourceTab.close();
    showFileStatus(
      error.message || "Your file could not be opened. Please sign out, sign in again, and retry.",
      "error"
    );
    return;
  }

  showFileStatus("Secure resource opened in a new tab.", "success");
  resourceTab.location.replace(data.signedUrl);
}

function showFileStatus(text, type = "loading") {
  const message = app.querySelector("[data-file-message]");
  if (message) message.textContent = text;

  let toast = document.querySelector("[data-resource-toast]");
  if (!toast) {
    toast = document.createElement("div");
    toast.dataset.resourceToast = "";
    toast.className = "resource-toast";
    toast.setAttribute("role", "status");
    document.body.appendChild(toast);
  }

  toast.className = `resource-toast ${type} visible`;
  toast.textContent = text;
  window.clearTimeout(showFileStatus.timeoutId);
  showFileStatus.timeoutId = window.setTimeout(() => toast.classList.remove("visible"), type === "error" ? 9000 : 3500);
}

function createTextResourceViewer(content, path) {
  const title = path.includes("bonus_worksheets") ? "Bonus Worksheets" : "Bibliotheque Digitale Resource";
  const lines = String(content).replaceAll("\r\n", "\n").split("\n");
  const output = [];
  let listOpen = false;

  const closeList = () => {
    if (listOpen) output.push("</ul>");
    listOpen = false;
  };

  const inline = (value) => escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>");

  lines.forEach((line) => {
    const trimmed = line.trim();

    if (!trimmed) {
      closeList();
      return;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = Math.min(heading[1].length + 1, 5);
      output.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      return;
    }

    const checklist = trimmed.match(/^-\s+\[([ xX])\]\s+(.+)$/);
    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (checklist || bullet) {
      if (!listOpen) output.push("<ul>");
      listOpen = true;
      const item = checklist
        ? `<span class="check">${checklist[1].toLowerCase() === "x" ? "☑" : "☐"}</span>${inline(checklist[2])}`
        : inline(bullet[1]);
      output.push(`<li>${item}</li>`);
      return;
    }

    closeList();
    output.push(`<p>${inline(trimmed)}</p>`);
  });
  closeList();

  return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${escapeHtml(title)}</title>
        <style>
          :root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#fbf3ef;color:#241817;font-family:Arial,sans-serif;line-height:1.7}.top{padding:18px 24px;background:#17100f;color:#fff8f4;border-bottom:3px solid #d79a88}.top strong{font-family:Georgia,serif;font-size:20px}.wrap{width:min(860px,calc(100% - 32px));margin:32px auto;padding:clamp(24px,6vw,64px);background:#fff;border:1px solid #e7c4b9;box-shadow:0 18px 45px rgba(69,35,30,.09)}h1,h2,h3,h4,h5{font-family:Georgia,serif;line-height:1.15;margin:1.5em 0 .55em}h2{font-size:clamp(34px,7vw,58px);margin-top:0}h3{font-size:28px;color:#8f574b}h4{font-size:21px}p{margin:.55em 0 1.1em}ul{padding-left:0;list-style:none;margin:0 0 1.4em}li{padding:10px 12px;margin:6px 0;background:#fff8f4;border-left:3px solid #d79a88}.check{display:inline-block;width:28px;color:#9a5f52;font-size:19px}code{padding:2px 5px;background:#f5e3dc;border-radius:3px}@media print{.top{display:none}.wrap{width:100%;margin:0;border:0;box-shadow:none}}
        </style>
      </head>
      <body>
        <header class="top"><strong>Bibliotheque Digitale</strong> · Private Customer Resource</header>
        <main class="wrap">${output.join("")}</main>
      </body>
    </html>`;
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

function renderPublicHome() {
  const etsyShop = "https://www.etsy.com/shop/BibliothequeDigitale";
  const launchMap = "https://shop.beacons.ai/aina_icon/e65f7d06-4739-4cc0-9b1f-c48b499e5f97";
  app.innerHTML = html`
    <section class="bd-brand-banner" aria-label="Bibliothèque Digitale, boutique de produits digitaux PLR premium">
      <img src="assets/banniere-bibliotheque-digitale-qr.png" alt="Bibliothèque Digitale par Cécilia : produits digitaux premium sous licence PLR, templates Canva, visuels IA et ressources pour développer un business faceless">
      <a href="${launchMap}" target="_blank" rel="noopener" aria-label="Télécharger gratuitement The A.I.A Launch Map">Recevoir ma Launch Map gratuite <span>↗</span></a>
    </section>
    <section class="bd-home-hero">
      <div class="bd-home-copy">
        <p class="eyebrow">La boutique PLR premium des créatrices ambitieuses</p>
        <h1>Créez moins.<br><em>Lancez mieux.</em></h1>
        <p class="bd-home-lead">Des produits digitaux avec droits de revente, des visuels IA haut de gamme et des ressources Canva pensées pour transformer vos idées en une marque prête à vendre.</p>
        <div class="bd-home-actions">
          <a class="button bd-primary" href="#/shop">Explorer la Bibliothèque</a>
          <a class="bd-arrow-link" href="#/login">Accéder à mes achats <span>→</span></a>
        </div>
        <div class="bd-trust-row"><span><strong>678+</strong> ventes Etsy</span><span><strong>4,8/5</strong> satisfaction</span><span><strong>100 %</strong> digital</span></div>
      </div>
      <div class="bd-hero-collage" aria-label="Sélection de produits Bibliothèque Digitale">
        <figure class="bd-cover-main"><img src="assets/shop/faceless-guide.jpg" alt="Guide marketing faceless PLR"><figcaption>Créer · personnaliser · revendre</figcaption></figure>
        <figure class="bd-cover-small top"><img src="assets/shop/canva-course.jpg" alt="Formation Canva avec licence PLR"></figure>
        <figure class="bd-cover-small bottom"><img src="assets/branding-planner-preview.png" alt="Branding Planner et Workbook PLR"></figure>
        <span class="bd-seal">PLR<br>Premium</span>
      </div>
    </section>

    <section class="bd-marquee" aria-label="Catégories de la boutique"><span>PLR & MRR</span><i>✦</i><span>Canva Templates</span><i>✦</i><span>Faceless Content</span><i>✦</i><span>Business Tools</span><i>✦</i><span>AI Visuals</span></section>

    <section class="bd-intro">
      <div><p class="eyebrow">Votre raccourci créatif</p><h2>Une bibliothèque pensée pour <em>faire grandir vos idées.</em></h2></div>
      <div><p>Chaque ressource est choisie ou créée pour les femmes, mamans, coachs et créatrices qui souhaitent développer une activité digitale élégante — sans repartir de zéro.</p><p>Personnalisez dans Canva, adaptez à votre univers et utilisez les droits indiqués pour créer votre prochaine offre.</p></div>
    </section>

    <section class="bd-category-grid">
      <a href="#/shop" class="bd-category-card rose"><span>01</span><p>Guides & formations</p><h3>Apprendre et lancer</h3><small>Marketing digital, Etsy, Canva et stratégie faceless →</small></a>
      <a href="#/shop" class="bd-category-card cream"><span>02</span><p>Produits PLR</p><h3>Personnaliser et revendre</h3><small>Workbooks, ebooks et ressources prêtes à transformer →</small></a>
      <a href="#/shop" class="bd-category-card wine"><span>03</span><p>Visuels premium</p><h3>Créer sans vous montrer</h3><small>Photos, vidéos, mockups et univers IA haut de gamme →</small></a>
    </section>

    <section class="bd-featured">
      <div class="bd-section-heading"><div><p class="eyebrow">La sélection du moment</p><h2>À découvrir dans la Bibliothèque</h2></div><a href="#/shop">Voir toute la collection →</a></div>
      <div class="bd-featured-grid">
        <article><img src="assets/shop/faceless-guide.jpg" alt="Formation marketing faceless PLR" loading="lazy"><p>Business & marketing</p><h3>Formation Marketing Digital Faceless</h3><a href="${etsyShop}?search_query=faceless%20marketing" target="_blank" rel="noopener">Découvrir sur Etsy ↗</a></article>
        <article><img src="assets/branding-planner-preview.png" alt="Branding Planner et Workbook PLR" loading="lazy"><p>Branding & stratégie</p><h3>Branding Planner & Workbook PLR</h3><a href="${etsyShop}?search_query=branding%20planner" target="_blank" rel="noopener">Découvrir sur Etsy ↗</a></article>
        <article><img src="assets/shop/melanin-stock.jpg" alt="Collection de visuels faceless Melanin" loading="lazy"><p>Photos & vidéos faceless</p><h3>Collection Visuelle Melanin</h3><a href="${etsyShop}?search_query=melanin%20faceless" target="_blank" rel="noopener">Découvrir sur Etsy ↗</a></article>
      </div>
    </section>

    <section class="bd-library-story">
      <div class="bd-library-visual"><span>BD</span><p>Votre collection,<br>toujours à portée de main.</p></div>
      <div class="bd-library-copy"><p class="eyebrow">Après votre achat</p><h2>Vos produits vivent désormais dans <em>votre bibliothèque.</em></h2><p>Retrouvez au même endroit les produits achetés dans la boutique, leurs bonus, vos ressources exclusives et les futures mises à jour. Un espace personnel, simple et beau, accessible sur ordinateur comme sur téléphone.</p><div class="bd-home-actions"><a class="button bd-primary" href="#/login">Ouvrir mon espace client</a><a class="bd-arrow-link" href="#/shop">Découvrir la Bibliothèque <span>→</span></a></div></div>
    </section>

    <section class="bd-freebie">
      <div class="bd-freebie-visual"><img src="assets/aia-launch-map.png" alt="The A.I.A Launch Map, plan d'action gratuit pour lancer un business faceless de produits digitaux" loading="lazy"></div>
      <div class="bd-freebie-copy"><p class="eyebrow">Votre cadeau de bienvenue</p><h2>Lancez votre business faceless avec <em>un plan clair.</em></h2><p>Téléchargez gratuitement The A.I.A Launch Map : une feuille de route étape par étape pour trouver votre niche, créer une offre digitale, produire du contenu avec une influenceuse IA et automatiser vos premières ventes.</p><ul><li>Positionnement et niche</li><li>Création de votre offre</li><li>Contenu et audience</li><li>Automatisation et revenus</li></ul><a class="button bd-primary" href="${launchMap}" target="_blank" rel="noopener">Recevoir gratuitement la Launch Map ↗</a></div>
    </section>

    <section class="bd-values">
      <article><strong>✦</strong><h3>Prêt à personnaliser</h3><p>Des fichiers pensés pour Canva et les outils que vous utilisez déjà.</p></article>
      <article><strong>◇</strong><h3>Droits clairement indiqués</h3><p>PLR, MRR ou usage commercial : chaque fiche précise ce que vous pouvez faire.</p></article>
      <article><strong>♡</strong><h3>Créé avec attention</h3><p>Des tendances étudiées, des visuels raffinés et une vraie valeur ajoutée.</p></article>
      <article><strong>↻</strong><h3>Bonus & mises à jour</h3><p>Votre espace client rassemble les ressources qui accompagnent vos achats.</p></article>
    </section>

    <section class="bd-final-cta"><p class="eyebrow">Bienvenue dans Bibliothèque Digitale</p><h2>Votre prochaine idée mérite<br><em>une longueur d’avance.</em></h2><a class="button bd-light" href="#/shop">Entrer dans la Bibliothèque</a></section>
  `;
}

function renderShop() {
  const salesPage = "https://the-aicon-academy.vercel.app/pages/vente-b.html?utm_source=bibliotheque_digitale&utm_medium=customer_shop&utm_campaign=shop_preview";
  app.innerHTML = html`
    <section class="editorial-page-head">
      <p class="eyebrow">The Digital Shop</p>
      <h1>Beautiful tools for<br><em>your next idea.</em></h1>
      <p>A curated boutique of planners, business resources and ready-to-use digital products is being prepared for you.</p>
    </section>
    <section class="shop-grid">
      <article class="shop-card shop-coming">
        <span class="shop-label">Coming soon</span><div class="shop-art shop-art-one"><span>BD</span></div>
        <p class="eyebrow">Planners & workbooks</p><h2>Plan beautifully.</h2><p>Thoughtful tools to turn ideas into clear, elegant action plans.</p>
      </article>
      <article class="shop-card shop-coming">
        <span class="shop-label">Coming soon</span><div class="shop-art shop-art-two"><i></i><i></i><i></i></div>
        <p class="eyebrow">Business resources</p><h2>Create with confidence.</h2><p>Templates and resources designed to make digital creation feel lighter.</p>
      </article>
      <article class="shop-card aia-shop-card">
        <img src="assets/aia-funnel/aina-editorial-full.png" alt="A\u00efna from THE A.I.A" loading="lazy">
        <div><p class="eyebrow">Featured experience</p><h2>THE A.I.A</h2><p>Create the AI influencer or digital twin that brings your brand to life.</p><a class="button aia-button" href="${salesPage}" target="_blank" rel="noopener">Discover the academy</a></div>
      </article>
    </section>
    <section class="shop-note"><span>✦</span><div><h2>Your customer library and shop will work together.</h2><p>Future purchases can appear directly inside My Products after approval, using the same simple access system.</p></div></section>
  `;
}

function renderInteractiveShop() {
  const etsyShop = "https://www.etsy.com/shop/BibliothequeDigitale";
  const shopProducts = [
    { category: "instagram", label: "Instagram & Canva", title: "100 modèles de Stories Instagram", description: "Un pack de stories faceless et business à personnaliser dans Canva pour publier plus rapidement.", badge: "Canva editable", image: "assets/shop/plr/stories-instagram.jpg" },
    { category: "instagram", label: "Instagram & Canva", title: "138 maquettes de profils Instagram", description: "Des maquettes de profils, feeds, Reels et stories pour présenter une identité Instagram professionnelle.", badge: "Pack créateur", image: "assets/shop/plr/profils-instagram.jpg?v=20260722-2" },
    { category: "faceless", label: "Photos faceless", title: "2 200 photos faceless", description: "Une vaste collection de photos esthétiques pour créer du contenu, des produits digitaux et des campagnes sans montrer son visage.", badge: "Spécialité BD", image: "assets/shop/plr/photos-faceless.jpg?v=20260722-2" },
    { category: "planners", label: "Planners & bien-être", title: "Beauty Planner", description: "Un planificateur beauté élégant à personnaliser pour organiser routines, soins et objectifs bien-être.", badge: "Planner", image: "assets/shop/plr/beauty-planner.png" },
    { category: "business", label: "Branding & business", title: "Branding Planner & Workbook PLR", description: "Un système complet pour définir une identité de marque, son positionnement, ses couleurs et sa stratégie.", badge: "Formation premium", image: "assets/shop/plr/branding-planner.png" },
    { category: "business", label: "Templates business", title: "Business Newspaper", description: "Un modèle de journal éditorial Canva pour raconter une marque, annoncer un lancement ou présenter une offre.", badge: "Choix éditorial", image: "assets/shop/plr/business-newspaper.jpg" },
    { category: "instagram", label: "Instagram & Canva", title: "Carrousels aesthetic scrapbook & stickers", description: "Des carrousels et stories façon scrapbook rose, accompagnés d’éléments et stickers coordonnés.", badge: "Aesthetic pack", image: "assets/shop/plr/carousel-scrapbook.png?v=20260722-2" },
    { category: "seasonal", label: "Collections saisonnières", title: "Cliparts de Noël aquarelle", description: "Une collection de cliparts de Noël en PNG pour planners, cartes, décorations et produits digitaux.", badge: "Collection Noël", image: "assets/shop/plr/clipart-noel.jpg" },
    { category: "business", label: "Formations & guides", title: "Cours accéléré Canva PLR", description: "Une formation Canva en français destinée aux débutantes avec tutoriels, ressources et bonus.", badge: "Cours en français", image: "assets/shop/plr/cours-canva.jpg" },
    { category: "marketing", label: "Marketing digital", title: "Ebook Comment vendre en Story", description: "Une méthode pour structurer des stories Instagram qui créent du lien et conduisent naturellement vers une vente.", badge: "Guide pratique", image: "assets/shop/plr/vendre-story.jpg?v=20260722-2" },
    { category: "business", label: "Templates Etsy", title: "Etsy Listing Mockup Templates", description: "Des modèles Canva pour créer rapidement des visuels d’annonces Etsy cohérents et professionnels.", badge: "Kit Etsy", image: "assets/shop/plr/mockups-etsy.jpg?v=20260722-2" },
    { category: "seasonal", label: "Événements & invitations", title: "Galentine’s Party", description: "Des invitations Canva raffinées pour brunchs, dîners et célébrations entre amies.", badge: "Invitation Canva", image: "assets/shop/plr/galentines.jpg" },
    { category: "marketing", label: "Marketing faceless", title: "Guide complet Faceless Marketing", description: "Un guide en français pour créer une marque anonyme, produire du contenu et développer une offre digitale.", badge: "Guide PLR", image: "assets/shop/plr/guide-faceless-fr.jpg" },
    { category: "marketing", label: "Etsy & produits digitaux", title: "Guide Etsy Produits Digitaux", description: "Un système complet pour ouvrir, organiser et développer une boutique Etsy de produits digitaux.", badge: "Système Etsy", image: "assets/shop/plr/guide-etsy.png?v=20260722-2" },
    { category: "marketing", label: "Marketing digital", title: "Guide du Marketing d’Affiliation", description: "Une ressource pour comprendre l’affiliation, choisir ses offres et construire une stratégie de revenus.", badge: "Débutantes", image: "assets/shop/plr/guide-affiliation.jpg?v=20260722-2" },
    { category: "planners", label: "Mindset & bien-être", title: "L’Art de la Manifestation PLR", description: "Un bundle autour de la manifestation, de la gratitude, des affirmations et de l’amour de soi.", badge: "Bundle complet", image: "assets/shop/plr/manifestation.jpg" },
    { category: "business", label: "Templates Etsy", title: "Modèles d’instructions & téléchargement Etsy", description: "Des modèles pour guider les clientes après leur achat et professionnaliser l’expérience de téléchargement.", badge: "80 templates", image: "assets/shop/plr/instructions-etsy.jpg?v=20260722-2" },
    { category: "planners", label: "Mindset & finances", title: "Money Mindset Workbook", description: "Un workbook pour travailler les habitudes financières, la confiance et une relation plus sereine à l’argent.", badge: "Workbook PLR", image: "assets/shop/plr/money-mindset.jpg" },
    { category: "business", label: "Pages de vente", title: "Pages de vente Beacons & Stan Store", description: "Des pages de vente Canva pour présenter une offre digitale sur Beacons, Stan Store ou une page de lien en bio.", badge: "Sales page kit", image: "assets/shop/plr/sales-page.jpg?v=20260722-2" },
    { category: "marketing", label: "Marketing faceless", title: "The Ultimate Guide to Faceless Marketing", description: "Une formation complète pour créer du contenu faceless, développer une audience et vendre des produits digitaux.", badge: "Guide complet", image: "assets/shop/plr/ultimate-faceless.png" },
    { category: "business", label: "Templates de site", title: "VA Canva Website Template", description: "Un site Canva destiné aux assistantes virtuelles, OBM, freelances et social media managers.", badge: "Website template", image: "assets/shop/plr/va-website.jpg?v=20260722-2" }
  ];
  const productsMarkup = shopProducts.map((product) => {
    const url = etsyShop;
    return html`
      <article class="store-product" data-shop-product data-category="${escapeHtml(product.category)}" data-search="${escapeHtml(`${product.title} ${product.label}`.toLowerCase())}">
        <div class="store-product-visual">
          <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.title)}" loading="lazy">
          <span class="store-product-badge">${escapeHtml(product.badge)}</span>
          <button class="store-favorite" type="button" aria-label="Add ${escapeHtml(product.title)} to favorites" aria-pressed="false" data-shop-favorite>\u2661</button>
          <a class="store-quick-view" href="${url}" target="_blank" rel="noopener">Voir la boutique Etsy \u2197</a>
        </div>
        <div class="store-product-copy"><p class="store-category">${escapeHtml(product.label)}</p><h2>${escapeHtml(product.title)}</h2><p>${escapeHtml(product.description)}</p><a class="store-card-link" href="${url}" target="_blank" rel="noopener">Retrouver sur Etsy \u2192</a></div>
      </article>`;
  }).join("");

  app.innerHTML = html`
    <section class="store-hero">
      <div><p class="eyebrow">La Bibliothèque PLR</p><h1>Créez, personnalisez<br><em>& lancez plus vite.</em></h1><p>Explorez une collection de produits digitaux PLR, templates Canva, formations, planners et ressources faceless conçue pour les créatrices ambitieuses.</p><div class="store-proof"><span><strong>25</strong> collections PLR</span><span><strong>Canva</strong> facile à personnaliser</span><span><strong>Digital</strong> accessible immédiatement</span></div></div>
      <a class="store-hero-card" href="${etsyShop}" target="_blank" rel="noopener"><span>Découvrir la collection complète</span><strong>Visiter la boutique Etsy</strong><em>\u2197</em></a>
    </section>
    <section class="store-controls" aria-label="Shop filters">
      <div class="store-filter-row"><button class="store-filter active" type="button" data-shop-filter="all">Tous les produits</button><button class="store-filter faceless-filter" type="button" data-shop-filter="faceless">📸 Photos faceless</button><button class="store-filter" type="button" data-shop-filter="marketing">Marketing</button><button class="store-filter" type="button" data-shop-filter="instagram">Instagram & Canva</button><button class="store-filter" type="button" data-shop-filter="business">Business & Etsy</button><button class="store-filter" type="button" data-shop-filter="planners">Planners & Mindset</button><button class="store-filter" type="button" data-shop-filter="seasonal">Saisonnier</button></div>
      <label class="store-search"><span>Rechercher dans la Bibliothèque</span><input type="search" placeholder="Canva, faceless, planner..." data-shop-search></label>
    </section>
    <div class="store-results-line"><strong data-shop-count>${shopProducts.length}</strong> produits de la Bibliothèque <span>\u00b7 De nouvelles collections seront ajoutées régulièrement</span></div>
    <section class="store-grid" data-shop-grid>${productsMarkup}</section>
    <div class="store-empty" data-shop-empty hidden><span>\u2726</span><h2>Aucun produit trouvé.</h2><p>Essayez une autre catégorie ou visitez la boutique Etsy complète.</p></div>
    <section class="store-footer-cta"><div><p class="eyebrow">La collection complète</p><h2>Plus qu’une boutique.<br>Une bibliothèque pour vos idées.</h2><p>Retrouvez sur Etsy les ebooks, planners, templates, visuels, mockups et produits PLR prêts à personnaliser.</p></div><a class="button portal-primary" href="${etsyShop}" target="_blank" rel="noopener">Explorer la boutique Etsy \u2197</a></section>
  `;
  bindShopInteractions();
}

function bindShopInteractions() {
  const filters = [...app.querySelectorAll("[data-shop-filter]")];
  const products = [...app.querySelectorAll("[data-shop-product]")];
  const search = app.querySelector("[data-shop-search]");
  const count = app.querySelector("[data-shop-count]");
  const empty = app.querySelector("[data-shop-empty]");
  let activeCategory = "all";
  const update = () => {
    const term = String(search.value || "").trim().toLowerCase();
    let visible = 0;
    products.forEach((product) => {
      const matchesCategory = activeCategory === "all" || product.dataset.category === activeCategory;
      const matchesSearch = !term || product.dataset.search.includes(term);
      product.hidden = !(matchesCategory && matchesSearch);
      if (!product.hidden) visible += 1;
    });
    count.textContent = String(visible);
    empty.hidden = visible !== 0;
  };
  filters.forEach((filter) => filter.addEventListener("click", () => {
    activeCategory = filter.dataset.shopFilter;
    filters.forEach((item) => item.classList.toggle("active", item === filter));
    update();
  }));
  search.addEventListener("input", update);
  app.querySelectorAll("[data-shop-favorite]").forEach((button) => button.addEventListener("click", () => {
    const selected = button.getAttribute("aria-pressed") === "true";
    button.setAttribute("aria-pressed", String(!selected));
    button.textContent = selected ? "\u2661" : "\u2665";
  }));
}

function renderCommunity() {
  app.innerHTML = html`
    <section class="community-preview">
      <div class="community-orbit"><span>${escapeHtml(customerFirstName().charAt(0))}</span><i></i><i></i><i></i></div>
      <div>
        <p class="eyebrow">Bibliotheque Digitale Customer Club</p>
        <h1>A warm corner for<br><em>creative customers.</em></h1>
        <p>This future space will bring together product updates, inspiration, helpful ideas and gentle guidance to get more from your digital purchases.</p>
        <div class="coming-pill">Community opening later</div>
        <a class="text-link" href="#/library">\u2190 Back to my home</a>
      </div>
    </section>
  `;
}

function renderProfile() {
  const firstName = customerFirstName();
  const email = state.session?.user?.email || "";
  const createdAt = state.session?.user?.created_at
    ? new Date(state.session.user.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    : "Member";

  app.innerHTML = html`
    <section class="profile-page">
      <div class="profile-identity-card">
        <span class="profile-avatar-large">${escapeHtml(firstName.charAt(0).toUpperCase())}</span>
        <p class="eyebrow">My customer profile</p>
        <h1>${escapeHtml(firstName)}</h1>
        <p>${escapeHtml(email)}</p>
        <div class="profile-member-since"><small>Member since</small><strong>${escapeHtml(createdAt)}</strong></div>
      </div>
      <div class="profile-settings">
        <p class="eyebrow">Personal details</p><h2>Make this space yours.</h2>
        <p>Your first name appears in your welcome message and throughout your customer space.</p>
        <form data-profile-form>
          <label>First name
            <input name="first_name" type="text" autocomplete="given-name" required maxlength="60" value="${escapeHtml(firstName === "There" ? "" : firstName)}">
          </label>
          <label>Email address
            <input type="email" value="${escapeHtml(email)}" disabled>
          </label>
          <button type="submit" class="rose">Save my profile</button>
          <p class="form-note" data-profile-message></p>
        </form>
        <div class="profile-access-summary">
          <div><strong>${state.access.length}</strong><span>Unlocked products</span></div>
          <div><strong>${state.requests.filter((item) => item.status === "pending").length}</strong><span>Pending requests</span></div>
        </div>
      </div>
    </section>
  `;

  app.querySelector("[data-profile-form]").addEventListener("submit", saveCustomerProfile);
}

async function saveCustomerProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = form.querySelector("[data-profile-message]");
  const firstName = String(new FormData(form).get("first_name") || "").trim();
  const button = form.querySelector('button[type="submit"]');

  if (!firstName) {
    message.textContent = "Please enter your first name.";
    return;
  }

  button.disabled = true;
  message.textContent = "Saving...";
  const { data, error } = await db.auth.updateUser({ data: { first_name: firstName } });
  button.disabled = false;

  if (error) {
    message.textContent = error.message;
    return;
  }

  if (data.user && state.session) state.session.user = data.user;
  setAdminVisibility();
  message.textContent = `Saved. Hello ${firstName}!`;
  window.setTimeout(() => renderProfile(), 700);
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
  state.products = (productResult.data?.length ? productResult.data : fallbackProducts)
    .filter((product) => product.slug !== "faceless-photo-pack");

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

  if (passwordRecoveryMode) {
    renderPasswordReset();
    return;
  }

  if (!supabaseReady) {
    app.innerHTML = html`
      <section class="notice">
        <strong>Supabase is not configured yet</strong>
        <p>Add your Supabase URL and anon key in <code>assets/supabase-config.js</code>, then run the SQL schema in Supabase.</p>
      </section>
    `;
    return;
  }

  const current = route().split("?")[0];

  if (!state.session) {
    if (current === "/home" || current === "/") renderPublicHome();
    else if (current === "/shop") renderInteractiveShop();
    else renderAuth();
    return;
  }

  await loadData();
  setAdminVisibility();

  if (current.startsWith("/product/")) renderProductPage(current.replace("/product/", ""));
  else if (current === "/home" || current === "/") renderPublicHome();
  else if (current === "/library") renderDashboard();
  else if (current === "/products") renderProductsLibrary();
  else if (current === "/request-access") renderRequestAccess();
  else if (current === "/shop") renderInteractiveShop();
  else if (current === "/community") renderCommunity();
  else if (current === "/profile") renderProfile();
  else if (current === "/admin") renderAdmin();
  else if (current === "/discover-the-aia") renderDiscoverAia();
  else renderDashboard();
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
  db.auth.onAuthStateChange((event, session) => {
    state.session = session;
    if (event === "PASSWORD_RECOVERY") {
      passwordRecoveryMode = true;
      renderPasswordReset();
      return;
    }
    renderRoute();
  });
}

init();
