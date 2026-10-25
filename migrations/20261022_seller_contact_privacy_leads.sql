-- ==========================================================
-- Migration: Seller Contact Privacy & Lead Dispatch System
-- Date: 2026-10-22
-- ==========================================================

-- 1. Update listings table with contact_preference column
-- Default is 'notify' (Mode B: Privacy-first callback request)
ALTER TABLE IF EXISTS public.listings
  ADD COLUMN IF NOT EXISTS contact_preference VARCHAR(20) DEFAULT 'notify';

-- Add check constraint for contact_preference if not present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_listings_contact_preference'
  ) THEN
    ALTER TABLE public.listings
      ADD CONSTRAINT chk_listings_contact_preference
      CHECK (contact_preference IN ('direct', 'notify'));
  END IF;
END $$;

-- Index for contact_preference (including JSONB data support for existing schema)
CREATE INDEX IF NOT EXISTS idx_listings_contact_preference 
  ON public.listings (contact_preference);

CREATE INDEX IF NOT EXISTS idx_listings_data_contact_pref 
  ON public.listings ((data->>'contact_preference'));

-- 2. Create listing_leads table
CREATE TABLE IF NOT EXISTS public.listing_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  buyer_id TEXT NOT NULL,
  buyer_phone VARCHAR(15) NOT NULL,
  buyer_name VARCHAR(100) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  data JSONB DEFAULT '{}'::jsonb,
  CONSTRAINT chk_listing_leads_status CHECK (status IN ('pending', 'contacted', 'dismissed')),
  CONSTRAINT uq_listing_leads_listing_buyer UNIQUE (listing_id, buyer_id)
);

-- Indexes for lightning fast seller dashboard & duplicate lead checks
CREATE INDEX IF NOT EXISTS idx_listing_leads_seller_id 
  ON public.listing_leads (seller_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_listing_leads_listing_id 
  ON public.listing_leads (listing_id);

CREATE INDEX IF NOT EXISTS idx_listing_leads_buyer_id 
  ON public.listing_leads (buyer_id);

CREATE INDEX IF NOT EXISTS idx_listing_leads_status 
  ON public.listing_leads (status);

-- 3. In-App Notifications table (for instant seller lead alerts)
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  type VARCHAR(50) DEFAULT 'lead_callback',
  title VARCHAR(150) NOT NULL,
  message TEXT NOT NULL,
  data JSONB DEFAULT '{}'::jsonb,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread 
  ON public.notifications (user_id, is_read, created_at DESC);

-- ==========================================================
-- ROW LEVEL SECURITY (RLS) FOR LEADS & NOTIFICATIONS
-- ==========================================================
ALTER TABLE public.listing_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.listing_leads FROM anon;
REVOKE ALL ON TABLE public.notifications FROM anon;

GRANT ALL ON TABLE public.listing_leads TO service_role;
GRANT ALL ON TABLE public.notifications TO service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public.listing_leads TO authenticated;
GRANT SELECT, UPDATE ON TABLE public.notifications TO authenticated;

-- Policies for listing_leads:
-- Sellers can view leads for their listings
DROP POLICY IF EXISTS "Sellers can view received leads" ON public.listing_leads;
CREATE POLICY "Sellers can view received leads"
  ON public.listing_leads FOR SELECT
  TO authenticated
  USING (seller_id = auth.uid()::text OR seller_id = auth.jwt()->>'email');

-- Buyers can insert callback requests
DROP POLICY IF EXISTS "Buyers can create callback leads" ON public.listing_leads;
CREATE POLICY "Buyers can create callback leads"
  ON public.listing_leads FOR INSERT
  TO authenticated
  WITH CHECK (buyer_id = auth.uid()::text OR buyer_id = auth.jwt()->>'email');

-- Sellers can update status of their received leads (e.g. marked as contacted)
DROP POLICY IF EXISTS "Sellers can update their lead status" ON public.listing_leads;
CREATE POLICY "Sellers can update their lead status"
  ON public.listing_leads FOR UPDATE
  TO authenticated
  USING (seller_id = auth.uid()::text OR seller_id = auth.jwt()->>'email')
  WITH CHECK (seller_id = auth.uid()::text OR seller_id = auth.jwt()->>'email');

-- Service role has full access
DROP POLICY IF EXISTS "Service Role Full Access listing_leads" ON public.listing_leads;
CREATE POLICY "Service Role Full Access listing_leads"
  ON public.listing_leads FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service Role Full Access notifications" ON public.notifications;
CREATE POLICY "Service Role Full Access notifications"
  ON public.notifications FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
