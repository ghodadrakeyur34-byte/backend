-- ==========================================================
-- MARI MILKAT SUPABASE DATABASE SCHEMA & SECURITY POLICIES
-- Run this script in the Supabase SQL Editor:
-- Dashboard -> SQL Editor -> New Query -> Run
-- ==========================================================

-- 1. Listings Table
CREATE TABLE IF NOT EXISTS public.listings (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index for fast status, city and owner lookups
CREATE INDEX IF NOT EXISTS idx_listings_status ON public.listings ((data->>'status'));
CREATE INDEX IF NOT EXISTS idx_listings_city ON public.listings ((data->>'city'));
CREATE INDEX IF NOT EXISTS idx_listings_owner ON public.listings ((data->>'ownerEmail'));

-- 2. Users Table
CREATE TABLE IF NOT EXISTS public.users (
  email TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_status ON public.users ((data->>'status'));

-- 3. Reports Table
CREATE TABLE IF NOT EXISTS public.reports (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reports_status ON public.reports ((data->>'status'));

-- 4. Inquiries Table
CREATE TABLE IF NOT EXISTS public.inquiries (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inquiries_status ON public.inquiries ((data->>'status'));

-- 5. Categories Configuration Table
CREATE TABLE IF NOT EXISTS public.categories (
  id TEXT PRIMARY KEY DEFAULT 'main',
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. Settings Configuration Table
CREATE TABLE IF NOT EXISTS public.settings (
  id TEXT PRIMARY KEY DEFAULT 'main',
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==========================================================
-- ROW LEVEL SECURITY (RLS) & ACCESS CONTROL
-- ==========================================================

-- Enable Row Level Security on all tables
ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

-- Revoke default public/anon access
REVOKE ALL ON TABLE public.listings FROM anon;
REVOKE ALL ON TABLE public.users FROM anon;
REVOKE ALL ON TABLE public.reports FROM anon;
REVOKE ALL ON TABLE public.inquiries FROM anon;
REVOKE ALL ON TABLE public.categories FROM anon;
REVOKE ALL ON TABLE public.settings FROM anon;

-- Grant minimal necessary schema privileges
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT SELECT ON TABLE public.listings TO anon, authenticated;
GRANT SELECT ON TABLE public.categories TO anon, authenticated;
GRANT SELECT ON TABLE public.settings TO anon, authenticated;
GRANT INSERT ON TABLE public.reports TO anon, authenticated;
GRANT INSERT ON TABLE public.inquiries TO anon, authenticated;

-- Drop existing legacy policies if any
DROP POLICY IF EXISTS "Public Read Active Listings" ON public.listings;
DROP POLICY IF EXISTS "Service Role Full Access Listings" ON public.listings;
DROP POLICY IF EXISTS "Service Role Full Access Users" ON public.users;
DROP POLICY IF EXISTS "Public Read Categories" ON public.categories;
DROP POLICY IF EXISTS "Service Role Full Access Categories" ON public.categories;
DROP POLICY IF EXISTS "Public Read Settings" ON public.settings;
DROP POLICY IF EXISTS "Service Role Full Access Settings" ON public.settings;
DROP POLICY IF EXISTS "Public Insert Reports" ON public.reports;
DROP POLICY IF EXISTS "Service Role Full Access Reports" ON public.reports;
DROP POLICY IF EXISTS "Public Insert Inquiries" ON public.inquiries;
DROP POLICY IF EXISTS "Service Role Full Access Inquiries" ON public.inquiries;

-- 1. Listings Policies
-- Public can only view active listings (moderated)
CREATE POLICY "Public Read Active Listings"
ON public.listings FOR SELECT
USING ((data->>'status') = 'active' OR auth.role() = 'service_role');

-- Backend service role has unrestricted access
CREATE POLICY "Service Role Full Access Listings"
ON public.listings FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 2. Users Policies (Strict: no direct public anon access to protect hashes and sensitive PII)
CREATE POLICY "Service Role Full Access Users"
ON public.users FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 3. Categories Policies
CREATE POLICY "Public Read Categories"
ON public.categories FOR SELECT
USING (true);

CREATE POLICY "Service Role Full Access Categories"
ON public.categories FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 4. Settings Policies
CREATE POLICY "Public Read Settings"
ON public.settings FOR SELECT
USING (true);

CREATE POLICY "Service Role Full Access Settings"
ON public.settings FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 5. Reports Policies
CREATE POLICY "Public Insert Reports"
ON public.reports FOR INSERT
WITH CHECK (true);

CREATE POLICY "Service Role Full Access Reports"
ON public.reports FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 6. Inquiries Policies
CREATE POLICY "Public Insert Inquiries"
ON public.inquiries FOR INSERT
WITH CHECK (true);

CREATE POLICY "Service Role Full Access Inquiries"
ON public.inquiries FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ==========================================================
-- 7. Supabase Storage Bucket for User Uploads
-- ==========================================================
-- Creates the public 'property-images' storage bucket if it does not exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'property-images',
  'property-images',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

-- Drop old insecure storage policies
DROP POLICY IF EXISTS "Public Read Access" ON storage.objects;
DROP POLICY IF EXISTS "Allow Uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow Deletes" ON storage.objects;

-- Allow public read access to property-images
CREATE POLICY "Public Read Access"
ON storage.objects FOR SELECT
USING (bucket_id = 'property-images');

-- Only backend service_role or authenticated users can upload
CREATE POLICY "Allow Uploads"
ON storage.objects FOR INSERT
TO service_role, authenticated
WITH CHECK (bucket_id = 'property-images');

-- Only backend service_role or authenticated users can delete
CREATE POLICY "Allow Deletes"
ON storage.objects FOR DELETE
TO service_role, authenticated
USING (bucket_id = 'property-images');
