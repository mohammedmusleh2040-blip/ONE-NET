OneNet ERP – FINAL CLEAN (A)
===========================

What’s fixed in this release
- ✅ Settings now loaded with select('*') to avoid 400 errors when columns differ.
- ✅ Added missing CSS variable: --card (dropdowns & menus now light).
- ✅ Fixed Layout crash: appSettings is now defined and loaded from Supabase settings (with localStorage fallback).
- ✅ Network name Arabic + English supported:
  - company_name (Arabic)
  - company_name_en (English)
- ✅ PaymentPrint + Ledger use company_name/company_name_en (no more shop_name mismatch).

Supabase – Settings table (IMPORTANT)
1) Open Supabase -> SQL Editor and run the updated schema in /supabase/schema.sql
2) Ensure you have ONE row in settings:
   insert into public.settings (company_name, company_name_en, low_stock_threshold)
   select 'شبكة ون نت اللاسلكية', 'Network One Net Wireless', 10
   where not exists (select 1 from public.settings);

Run locally
- npm install
- npm run dev

Deploy online (Vercel/Netlify)
- npm run build
- upload 'dist' folder

