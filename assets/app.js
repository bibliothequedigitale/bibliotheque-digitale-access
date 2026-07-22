const app = document.getElementById("app");
const authTemplate = document.getElementById("auth-template");
const signOutButton = document.querySelector("[data-sign-out]");
const adminLink = document.querySelector("[data-admin-link]");
const sidebarAccount = document.querySelector("[data-sidebar-account]");
const profileNameNode = document.querySelector("[data-profile-name]");
const profileInitialNode = document.querySelector("[data-profile-initial]");

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
  if (sidebarAccount) sidebarAccount.hidden = !state.session;
  document.body.classList.toggle("has-session", Boolean(state.session));

  if (state.session) {
    const firstName = customerFirstName();
    if (profileNameNode) profileNameNode.textContent = `${firstName} 👋`;
    if (profileInitialNode) profileInitialNode.textContent = firstName.charAt(0).toUpperCase();
  }

  const current = route().split("?")[0];
  document.querySelectorAll(".portal-nav a[href^='#/']").forEach((link) => {
    const destination = link.getAttribute("href").replace("#", "");
    const active = destination === current || (destination === "/products" && current.startsWith("/product/"));
    link.classList.toggle("active", active);
  });
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
    { category: "marketing", label: "Business & Marketing", title: "Complete Faceless Marketing Guide", description: "A ready-to-use French guide with PLR rights to build and resell a faceless marketing offer.", price: "From \u20ac6.47", oldPrice: "\u20ac21.56", badge: "Bestseller style", image: "assets/shop/faceless-guide.jpg", query: "faceless marketing guide" },
    { category: "canva", label: "Canva & Instagram", title: "Accelerated Canva Course", description: "A beginner-friendly Canva course with tutorials, bonuses and PLR resale rights.", price: "From \u20ac4.68", oldPrice: "\u20ac15.59", badge: "Customer favorite", image: "assets/shop/canva-course.jpg", query: "cours Canva" },
    { category: "faceless", label: "Faceless Photos & Videos", title: "Summer Paradise Collection", description: "150+ pastel and tropical faceless images for Instagram, Pinterest and digital products.", price: "From \u20ac2.51", oldPrice: "\u20ac8.36", badge: "Trending", image: "assets/shop/tropical-stock.jpg", query: "summer paradise faceless" },
    { category: "faceless", label: "Faceless Photos & Videos", title: "Melanin Faceless Collection", description: "A premium visual library created for elegant, inclusive and high-converting content.", price: "From \u20ac3.60", oldPrice: "\u20ac11.99", badge: "Inclusive collection", image: "assets/shop/melanin-stock.jpg", query: "melanin faceless" },
    { category: "canva", label: "Canva & Instagram", title: "100 Instagram Story Templates", description: "Faceless business stories ready to customize in Canva and use for selling with ease.", price: "From \u20ac2.88", oldPrice: "\u20ac9.59", badge: "Ready to edit", image: "assets/shop/instagram-stories.jpg", query: "Instagram story templates" },
    { category: "canva", label: "Canva & Instagram", title: "138 Instagram Profile Mockups", description: "Create polished feed previews and professional Instagram presentations in minutes.", price: "Discover on Etsy", oldPrice: "", badge: "Creator toolkit", image: "assets/shop/instagram-profile.jpg", query: "Instagram profile mockup" },
    { category: "business", label: "Business Templates", title: "Business Newspaper Template", description: "An editorial Canva newspaper template for launches, brand stories and client announcements.", price: "Discover on Etsy", oldPrice: "", badge: "Editorial pick", image: "assets/shop/business-newspaper.jpg", query: "business newspaper" },
    { category: "mindset", label: "Mindset & Planners", title: "Manifestation & Law of Attraction Pack", description: "Planners, journals and affirmations bundled into one uplifting PLR collection.", price: "From \u20ac5.76", oldPrice: "\u20ac19.19", badge: "Complete bundle", image: "assets/shop/manifestation-pack.jpg", query: "manifestation loi attraction" }
  ];
  const productsMarkup = shopProducts.map((product) => {
    const url = `${etsyShop}?search_query=${encodeURIComponent(product.query)}`;
    return html`
      <article class="store-product" data-shop-product data-category="${escapeHtml(product.category)}" data-search="${escapeHtml(`${product.title} ${product.label}`.toLowerCase())}">
        <div class="store-product-visual">
          <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.title)}" loading="lazy">
          <span class="store-product-badge">${escapeHtml(product.badge)}</span>
          <button class="store-favorite" type="button" aria-label="Add ${escapeHtml(product.title)} to favorites" aria-pressed="false" data-shop-favorite>\u2661</button>
          <a class="store-quick-view" href="${url}" target="_blank" rel="noopener">View on Etsy \u2197</a>
        </div>
        <div class="store-product-copy"><p class="store-category">${escapeHtml(product.label)}</p><h2>${escapeHtml(product.title)}</h2><p>${escapeHtml(product.description)}</p><div class="store-price"><strong>${escapeHtml(product.price)}</strong>${product.oldPrice ? `<del>${escapeHtml(product.oldPrice)}</del>` : ""}</div></div>
      </article>`;
  }).join("");

  app.innerHTML = html`
    <section class="store-hero">
      <div><p class="eyebrow">Bibliotheque Digitale Shop</p><h1>Create, launch<br><em>& grow beautifully.</em></h1><p>Explore a curated selection of digital products designed for ambitious creators: PLR resources, faceless visuals, Canva templates and business tools.</p><div class="store-proof"><span><strong>678+</strong> Etsy sales</span><span><strong>4.8</strong> customer rating</span><span><strong>Instant</strong> digital download</span></div></div>
      <a class="store-hero-card" href="${etsyShop}" target="_blank" rel="noopener"><span>Visit the complete collection</span><strong>Shop all products on Etsy</strong><em>\u2197</em></a>
    </section>
    <section class="store-controls" aria-label="Shop filters">
      <div class="store-filter-row"><button class="store-filter active" type="button" data-shop-filter="all">All products</button><button class="store-filter" type="button" data-shop-filter="marketing">Business & Marketing</button><button class="store-filter" type="button" data-shop-filter="canva">Canva & Instagram</button><button class="store-filter" type="button" data-shop-filter="faceless">Faceless Photos & Videos</button><button class="store-filter" type="button" data-shop-filter="business">Business Templates</button><button class="store-filter" type="button" data-shop-filter="mindset">Mindset & Planners</button></div>
      <label class="store-search"><span>Search the shop</span><input type="search" placeholder="Try Canva, faceless, planner..." data-shop-search></label>
    </section>
    <div class="store-results-line"><strong data-shop-count>${shopProducts.length}</strong> curated products <span>\u00b7 New collections will be added regularly</span></div>
    <section class="store-grid" data-shop-grid>${productsMarkup}</section>
    <div class="store-empty" data-shop-empty hidden><span>\u2726</span><h2>No product found yet.</h2><p>Try another category or visit the complete Etsy boutique.</p></div>
    <section class="store-footer-cta"><div><p class="eyebrow">The complete Bibliotheque</p><h2>More than a shop.<br>A library for your ideas.</h2><p>Browse the full Etsy collection for ebooks, planners, templates, stock photos, videos, mockups and ready-to-resell PLR products.</p></div><a class="button portal-primary" href="${etsyShop}" target="_blank" rel="noopener">Explore all products on Etsy \u2197</a></section>
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
  if (current.startsWith("/product/")) renderProductPage(current.replace("/product/", ""));
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
  db.auth.onAuthStateChange((_event, session) => {
    state.session = session;
    renderRoute();
  });
}

init();
