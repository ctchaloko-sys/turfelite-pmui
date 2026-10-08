-- Activer l'extension pgcrypto pour le hashage
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. TABLES
CREATE TABLE settings (
    id serial PRIMARY KEY,
    key text UNIQUE NOT NULL,
    value text NOT NULL
);

CREATE TABLE profiles (
    id uuid REFERENCES auth.users(id) PRIMARY KEY,
    email text NOT NULL,
    full_name text,
    country text,
    role text DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    is_suspended boolean DEFAULT false,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE access_codes (
    id serial PRIMARY KEY,
    code_hash text NOT NULL,
    plan text NOT NULL CHECK (plan IN ('week', 'month', 'year')),
    is_active boolean DEFAULT true,
    expires_at timestamptz,
    usage_type text DEFAULT 'single' CHECK (usage_type IN ('single', 'multi')),
    used_count int DEFAULT 0,
    assigned_user_id uuid REFERENCES profiles(id),
    created_by uuid REFERENCES profiles(id),
    created_at timestamptz DEFAULT now()
);

CREATE TABLE subscriptions (
    id serial PRIMARY KEY,
    user_id uuid REFERENCES profiles(id) NOT NULL,
    plan text NOT NULL,
    start_date timestamptz DEFAULT now(),
    end_date timestamptz NOT NULL,
    status text DEFAULT 'active',
    created_at timestamptz DEFAULT now()
);

CREATE TABLE free_picks (
    id serial PRIMARY KEY,
    discipline text CHECK (discipline IN ('quinte', 'quarte', 'pmu', 'trio')),
    race_date date NOT NULL,
    favorites text, -- JSON array of strings
    analysis text,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE vip_picks (
    id serial PRIMARY KEY,
    race_info text NOT NULL,
    favorite text,
    tuyau text,
    outsider text,
    tokard text,
    tierce text,
    quarte text,
    quinte_plus text,
    couple text,
    multi text,
    trio text,
    synthesis text,
    status text DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'scheduled')),
    publish_at timestamptz,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE results (
    id serial PRIMARY KEY,
    race_info text,
    starters text,
    finishers text,
    non_runners text,
    is_published boolean DEFAULT false,
    date date DEFAULT CURRENT_DATE
);

CREATE TABLE testimonials (
    id serial PRIMARY KEY,
    pseudo text NOT NULL,
    country text,
    avatar text,
    comment text,
    stars int CHECK (stars BETWEEN 1 AND 5),
    is_demo boolean DEFAULT false,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE faq (
    id serial PRIMARY KEY,
    question text NOT NULL,
    answer text NOT NULL,
    order_index int DEFAULT 0
);

CREATE TABLE access_logs (
    id serial PRIMARY KEY,
    user_id uuid REFERENCES profiles(id),
    action text,
    details text,
    ip_address text,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE messages (
    id serial PRIMARY KEY,
    name text,
    email text,
    content text,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE vip_requests (
    id serial PRIMARY KEY,
    name text,
    country text,
    plan text,
    phone text,
    created_at timestamptz DEFAULT now()
);

-- 2. ROW LEVEL SECURITY (RLS)
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE free_picks ENABLE ROW LEVEL SECURITY;
ALTER TABLE vip_picks ENABLE ROW LEVEL SECURITY;
ALTER TABLE results ENABLE ROW LEVEL SECURITY;
ALTER TABLE testimonials ENABLE ROW LEVEL SECURITY;
ALTER TABLE faq ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE vip_requests ENABLE ROW LEVEL SECURITY;

-- Fonctions utilitaires
CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin' AND is_suspended = false
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION has_active_vip() RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM subscriptions 
    WHERE user_id = auth.uid() 
    AND status = 'active' 
    AND end_date > now()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Politiques (Policies)
-- Settings, FAQ, Testimonials: Public read
CREATE POLICY "Public read settings" ON settings FOR SELECT USING (true);
CREATE POLICY "Public read faq" ON faq FOR SELECT USING (true);
CREATE POLICY "Public read testimonials" ON testimonials FOR SELECT USING (true);
CREATE POLICY "Public read results" ON results FOR SELECT USING (is_published = true);

-- Free picks: Anyone can read analysis, but favorites are filtered in frontend or via specific RPC if needed (simplified here to authenticated read)
CREATE POLICY "Authenticated read free picks" ON free_picks FOR SELECT USING (auth.role() = 'authenticated');

-- VIP picks: Only VIP users or admins
CREATE POLICY "VIP read vip picks" ON vip_picks FOR SELECT USING (
  has_active_vip() OR is_admin()
);

-- Profiles: Users read own, Admin read all
CREATE POLICY "Users read own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Admin read all profiles" ON profiles FOR SELECT USING (is_admin());

-- Admin full access to all tables
DO $$ 
DECLARE
    t text;
BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE format('CREATE POLICY "Admin full access %I" ON %I FOR ALL USING (is_admin());', t, t);
    END LOOP;
END $$;

-- 3. FONCTIONS RPC (Logique Métier)
CREATE OR REPLACE FUNCTION redeem_vip_code(p_code text)
RETURNS text AS $$
DECLARE
    v_user_id uuid;
    v_code_record record;
    v_days int;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN RETURN 'invalid'; END IF;

    -- Chercher le code (hash simple pour l'exemple, à renforcer avec pepper en prod)
    SELECT * INTO v_code_record FROM access_codes 
    WHERE code_hash = encode(digest(p_code, 'sha256'), 'hex');

    IF NOT FOUND THEN
        INSERT INTO access_logs (user_id, action, details) VALUES (v_user_id, 'redeem_failed', 'Invalid code');
        RETURN 'invalid';
    END IF;

    IF v_code_record.is_active = false THEN RETURN 'disabled'; END IF;
    IF v_code_record.expires_at IS NOT NULL AND v_code_record.expires_at < now() THEN RETURN 'expired'; END IF;
    IF v_code_record.usage_type = 'single' AND v_code_record.used_count > 0 THEN RETURN 'used'; END IF;

    -- Attribuer VIP
    v_days := CASE v_code_record.plan WHEN 'week' THEN 7 WHEN 'month' THEN 30 WHEN 'year' THEN 365 ELSE 0 END;
    
    INSERT INTO subscriptions (user_id, plan, end_date) 
    VALUES (v_user_id, v_code_record.plan, now() + (v_days || ' days')::interval);

    UPDATE access_codes SET used_count = used_count + 1 WHERE id = v_code_record.id;
    INSERT INTO access_logs (user_id, action, details) VALUES (v_user_id, 'redeem_success', 'Plan: ' || v_code_record.plan);

    RETURN 'ok';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger création profil auto
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (new.id, new.email);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 4. DONNÉES DE DÉMO
INSERT INTO settings (key, value) VALUES 
('whatsapp', '22646553556'),
('email', 'emmabrn888@gmail.com'),
('facebook', ''),
('instagram', ''),
('price_week', '25000'),
('price_month', '95000'),
('price_year', '250000');

INSERT INTO faq (question, answer, order_index) VALUES
('Comment obtenir un code d''accès ?', 'Les codes d''accès sont délivrés uniquement via notre assistance WhatsApp après le choix de votre formule d''abonnement.', 1),
('Qu''est-ce que l''abonnement VIP ?', 'Le VIP vous donne un accès complet aux analyses expertes et aux synthèses poussées pour vous aider à mieux lire chaque course.', 2),
('Garantissez-vous des gains ?', 'Non. Les pronostics sont des analyses et ne garantissent aucun gain. Jouez de manière responsable.', 3);

INSERT INTO testimonials (pseudo, country, comment, stars, is_demo) VALUES
('Koffi', '🇨🇮 Côte d''Ivoire', 'Une excellente plateforme numérique. Les analyses m''aident à mieux comprendre les courses.', 5, true),
('Ousmane', '🇸🇳 Sénégal', 'L''interface VIP est très propre et les informations sont pointues.', 5, true);

INSERT INTO free_picks (discipline, race_date, favorites, analysis) VALUES
('quinte', CURRENT_DATE, '["3", "8", "12"]', 'Une course ouverte sur le gazon, favorisant les attentistes.');