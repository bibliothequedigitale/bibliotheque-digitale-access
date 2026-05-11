# Bibliotheque Digitale Access App

Private customer library for Etsy buyers.

## What this app does

- Customers create an account or sign in.
- Customers see a product library with locked and unlocked products.
- New customers are sent directly to the access request form.
- Customers can request one product or multiple products at the same time.
- Admin reviews the request against Etsy and clicks Approve.
- Approved products unlock in the customer's library.
- The configured admin email automatically sees all products as unlocked.

## Files

- `index.html` - app shell.
- `assets/app.js` - auth, library, request access, and admin dashboard logic.
- `assets/styles.css` - visual design.
- `assets/supabase-config.js` - Supabase URL, anon key, admin email, private storage file list.
- `supabase/schema.sql` - database tables, policies, seed products.
- `supabase/secure-storage-upgrade.sql` - storage bucket and policies if the database already exists.

## Setup

1. Create a fresh Supabase project for Bibliotheque Digitale.
2. Open Supabase SQL Editor and run `supabase/schema.sql`.
3. In this app, edit `assets/supabase-config.js`:

```js
window.BD_CONFIG = {
  supabaseUrl: "YOUR_SUPABASE_URL",
  supabaseAnonKey: "YOUR_SUPABASE_ANON_KEY",
  adminEmails: ["bibliotheque.digitale.etsy@gmail.com"],
  storageBucket: "product-files",
  productFiles: {
    "branding-planner-plr": [
      {
        label: "Branding Planner PDF - A4",
        description: "Printable A4 planner format.",
        path: "branding-planner-plr/branding-planner-workbook-a4-plr.pdf"
      }
    ]
  }
};
```

4. Deploy the folder to Netlify as a new site.
5. Create your admin account from the app with `bibliotheque.digitale.etsy@gmail.com`.
6. In Supabase Authentication > Users, copy your admin user id.
7. Run this in Supabase SQL Editor:

```sql
insert into public.admins (user_id, email)
values ('PASTE_YOUR_AUTH_USER_ID_HERE', 'bibliotheque.digitale.etsy@gmail.com')
on conflict (user_id) do nothing;
```

## Important security note

This app protects the library interface, approval workflow, and private file links when product files are stored in the private Supabase Storage bucket.

Do not use the old public Netlify product page as the final delivery link if you want secure access. Upload product files to Supabase Storage bucket `product-files` instead.

## Storage upload paths

Create this folder inside the private `product-files` bucket:

`branding-planner-plr`

Upload these files with exactly these names:

- `branding-planner-workbook-a4-plr.pdf`
- `branding-planner-workbook-a5-plr.pdf`
- `branding-planner-workbook-us-letter-plr.pdf`
- `bonus_course.html`
- `bonus_worksheets.md`
- `branding_strategy_guide.pdf`
- `customer-ready-copy-pack.html`

## Recommended Etsy flow

1. Buyer purchases on Etsy.
2. Etsy delivery PDF says: create your account and request access.
3. Buyer submits order number and buyer info.
4. Admin compares with Etsy.
5. Admin clicks Approve.
6. Buyer sees the product unlocked in My Library.
