-- 수업 코칭 1단계. 앱 역할은 세션 변수가 정해진 뒤 행 보안으로만 읽는다.
-- class_coach_app 은 슈퍼유저가 아니고 BYPASSRLS 도 없다.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  slug text NOT NULL UNIQUE,
  billing_tier text NOT NULL CHECK (billing_tier IN ('free', 'paid')),
  join_policy text NOT NULL CHECK (join_policy IN ('invite_only', 'invite_or_approval')),
  retention_days integer NOT NULL DEFAULT 365 CHECK (retention_days BETWEEN 1 AND 3650),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('teacher', 'admin', 'representative')),
  status text NOT NULL CHECK (status IN ('pending', 'active', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, organization_id)
);

CREATE TABLE teacher_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  admin_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, admin_id, teacher_id)
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('teacher', 'admin', 'representative')),
  created_by uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  version text NOT NULL CHECK (char_length(version) BETWEEN 1 AND 80),
  accepted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lesson_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  month date NOT NULL,
  sport text NOT NULL,
  language_mode text NOT NULL CHECK (language_mode IN ('english', 'korean', 'mixed')),
  file_path text NOT NULL,
  extracted_text text,
  extraction_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE criteria_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 1),
  body jsonb NOT NULL,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, version)
);

CREATE TABLE uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  lesson_date date NOT NULL,
  class_name text NOT NULL CHECK (char_length(class_name) BETWEEN 1 AND 80),
  sport text NOT NULL,
  language_mode text NOT NULL CHECK (language_mode IN ('english', 'korean', 'mixed')),
  original_filename text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size > 0 AND byte_size <= 1073741824),
  media_kind text NOT NULL CHECK (media_kind IN ('video', 'audio')),
  content_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('uploading', 'queued', 'processing', 'done', 'failed')),
  failure_reason text,
  file_path text,
  audio_path text,
  duration_seconds numeric,
  expires_at timestamptz,
  chunk_size integer NOT NULL CHECK (chunk_size BETWEEN 65536 AND 8388608),
  expected_chunks integer NOT NULL CHECK (expected_chunks BETWEEN 1 AND 4096),
  received_chunks integer[] NOT NULL DEFAULT '{}',
  worker_token uuid,
  processing_started_at timestamptz,
  transcript_adapter text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transcript_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id uuid NOT NULL REFERENCES uploads (id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  start_sec integer NOT NULL CHECK (start_sec >= 0),
  text text NOT NULL,
  trusted boolean NOT NULL,
  teacher_check text NOT NULL DEFAULT 'unconfirmed' CHECK (teacher_check IN ('unconfirmed', 'confirmed', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id uuid NOT NULL UNIQUE REFERENCES uploads (id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE skills (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  description text NOT NULL,
  subject_scope text NOT NULL DEFAULT 'common'
);

CREATE TABLE skill_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  skill_id text NOT NULL REFERENCES skills (id),
  expressions text[] NOT NULL DEFAULT '{}',
  latest_new text[] NOT NULL DEFAULT '{}',
  first_upload_id uuid REFERENCES uploads (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, teacher_id, skill_id)
);

CREATE TABLE practice_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
  practice_date date NOT NULL,
  item_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (teacher_id, card_id, practice_date, item_key)
);

CREATE TABLE access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('card', 'recording')),
  target_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind text NOT NULL,
  upload_id uuid REFERENCES uploads (id) ON DELETE SET NULL,
  message text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX uploads_queue_idx ON uploads (created_at) WHERE status = 'queued';
CREATE INDEX uploads_teacher_idx ON uploads (teacher_id, lesson_date DESC);
CREATE INDEX uploads_expires_idx ON uploads (expires_at);
CREATE INDEX transcript_upload_idx ON transcript_lines (upload_id, start_sec);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);
CREATE INDEX access_log_org_idx ON access_log (organization_id, created_at DESC);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

INSERT INTO organizations (id, name, slug, billing_tier, join_policy, retention_days)
VALUES ('11111111-1111-4111-8111-111111111111', 'GTS', 'gts', 'free', 'invite_or_approval', 365)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO skills (id, name, description, subject_scope) VALUES
  ('praise', '칭찬 표현', '아이의 행동이나 말을 구체적으로 칭찬한 표현', 'common'),
  ('rule_as_question', '규칙을 질문으로 말하기', '금지가 아니라 질문으로 해야 할 행동을 안내한 표현', 'common'),
  ('child_care', '아이 마음 살피기', '아이의 감정을 알아차리고 받아 준 표현', 'common')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION current_app_user() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION current_app_org() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION current_app_role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.role', true), '')
$$;

CREATE OR REPLACE FUNCTION is_assigned_teacher(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM teacher_assignments ta
    WHERE ta.admin_id = current_app_user()
      AND ta.teacher_id = target
      AND ta.organization_id = current_app_org()
  )
$$;

CREATE OR REPLACE FUNCTION can_read_teacher(target uuid, org uuid) RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public AS $$
  SELECT current_app_user() IS NOT NULL
    AND org IS NOT DISTINCT FROM current_app_org()
    AND (
      (current_app_role() = 'teacher' AND target = current_app_user())
      OR current_app_role() = 'representative'
      OR (current_app_role() = 'admin' AND is_assigned_teacher(target))
    )
$$;

CREATE OR REPLACE FUNCTION can_upload_for_teacher(target uuid, org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT current_app_user() IS NOT NULL
    AND org IS NOT DISTINCT FROM current_app_org()
    AND (
      (current_app_role() = 'teacher' AND target = current_app_user())
      OR (
        current_app_role() = 'representative'
        AND EXISTS (
          SELECT 1 FROM memberships m
          WHERE m.user_id = target
            AND m.organization_id = org
            AND m.role = 'teacher'
            AND m.status = 'active'
        )
      )
    )
$$;

CREATE OR REPLACE FUNCTION org_join_policy(target uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT join_policy FROM organizations WHERE id = target
$$;

CREATE OR REPLACE FUNCTION guard_app_upload() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'class_coach_app' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.file_path IS NOT NULL OR NEW.audio_path IS NOT NULL OR NEW.worker_token IS NOT NULL
       OR NEW.expires_at IS NOT NULL OR NEW.status <> 'uploading' OR NEW.failure_reason IS NOT NULL THEN
      RAISE EXCEPTION 'invalid upload insert';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.teacher_id IS DISTINCT FROM OLD.teacher_id
     OR NEW.audio_path IS DISTINCT FROM OLD.audio_path
     OR NEW.duration_seconds IS DISTINCT FROM OLD.duration_seconds
     OR NEW.worker_token IS DISTINCT FROM OLD.worker_token
     OR NEW.media_kind IS DISTINCT FROM OLD.media_kind
     OR NEW.byte_size IS DISTINCT FROM OLD.byte_size
     OR NEW.original_filename IS DISTINCT FROM OLD.original_filename
     OR NEW.lesson_date IS DISTINCT FROM OLD.lesson_date
     OR NEW.class_name IS DISTINCT FROM OLD.class_name
     OR NEW.sport IS DISTINCT FROM OLD.sport
     OR NEW.language_mode IS DISTINCT FROM OLD.language_mode
     OR NEW.chunk_size IS DISTINCT FROM OLD.chunk_size
     OR NEW.expected_chunks IS DISTINCT FROM OLD.expected_chunks
     OR NEW.content_type IS DISTINCT FROM OLD.content_type
     OR NEW.transcript_adapter IS DISTINCT FROM OLD.transcript_adapter
     OR NEW.processing_started_at IS DISTINCT FROM OLD.processing_started_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'upload fields are locked';
  END IF;
  IF NEW.file_path IS DISTINCT FROM OLD.file_path THEN
    IF NOT (OLD.status = 'uploading' AND NEW.status = 'queued'
            AND NEW.file_path ~ ('^uploads/' || OLD.id::text || '/original[.][A-Za-z0-9]+$')) THEN
      RAISE EXCEPTION 'file path locked';
    END IF;
  END IF;
  IF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    IF NOT (OLD.status = 'uploading' AND NEW.status = 'queued' AND OLD.expires_at IS NULL AND NEW.expires_at IS NOT NULL) THEN
      RAISE EXCEPTION 'expiry locked';
    END IF;
  END IF;
  IF OLD.status = 'uploading' AND NEW.status = 'uploading' THEN
    RETURN NEW;
  ELSIF OLD.status = 'uploading' AND NEW.status = 'queued' AND NEW.failure_reason IS NULL THEN
    RETURN NEW;
  ELSIF OLD.status = 'failed' AND NEW.status = 'queued' AND NEW.failure_reason IS NULL THEN
    RETURN NEW;
  ELSE
    RAISE EXCEPTION 'status transition not allowed';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION guard_transcript_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'class_coach_app' THEN
    RETURN NEW;
  END IF;
  IF NEW.teacher_check NOT IN ('unconfirmed', 'confirmed', 'rejected') THEN
    RAISE EXCEPTION 'bad teacher check';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.upload_id IS DISTINCT FROM OLD.upload_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.teacher_id IS DISTINCT FROM OLD.teacher_id
     OR NEW.start_sec IS DISTINCT FROM OLD.start_sec
     OR NEW.text IS DISTINCT FROM OLD.text
     OR NEW.trusted IS DISTINCT FROM OLD.trusted
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'transcript fields are locked';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_notification_read() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'class_coach_app' THEN
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.upload_id IS DISTINCT FROM OLD.upload_id
     OR NEW.message IS DISTINCT FROM OLD.message
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'notification fields are locked';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_membership_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'class_coach_app' THEN
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'membership fields are locked';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_org_retention() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'class_coach_app' THEN
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.name IS DISTINCT FROM OLD.name
     OR NEW.slug IS DISTINCT FROM OLD.slug
     OR NEW.billing_tier IS DISTINCT FROM OLD.billing_tier
     OR NEW.join_policy IS DISTINCT FROM OLD.join_policy
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'organization fields are locked';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS uploads_guard ON uploads;
CREATE TRIGGER uploads_guard BEFORE INSERT OR UPDATE ON uploads
FOR EACH ROW EXECUTE FUNCTION guard_app_upload();

DROP TRIGGER IF EXISTS transcript_guard ON transcript_lines;
CREATE TRIGGER transcript_guard BEFORE UPDATE ON transcript_lines
FOR EACH ROW EXECUTE FUNCTION guard_transcript_check();

DROP TRIGGER IF EXISTS notifications_guard ON notifications;
CREATE TRIGGER notifications_guard BEFORE UPDATE ON notifications
FOR EACH ROW EXECUTE FUNCTION guard_notification_read();

DROP TRIGGER IF EXISTS memberships_guard ON memberships;
CREATE TRIGGER memberships_guard BEFORE UPDATE ON memberships
FOR EACH ROW EXECUTE FUNCTION guard_membership_update();

DROP TRIGGER IF EXISTS organizations_guard ON organizations;
CREATE TRIGGER organizations_guard BEFORE UPDATE ON organizations
FOR EACH ROW EXECUTE FUNCTION guard_org_retention();

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE teacher_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE uploads FORCE ROW LEVEL SECURITY;
ALTER TABLE transcript_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcript_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE cards FORCE ROW LEVEL SECURITY;
ALTER TABLE skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE skills FORCE ROW LEVEL SECURITY;
ALTER TABLE skill_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_progress FORCE ROW LEVEL SECURITY;
ALTER TABLE practice_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_checks FORCE ROW LEVEL SECURITY;
ALTER TABLE access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_log FORCE ROW LEVEL SECURITY;
ALTER TABLE consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE consents FORCE ROW LEVEL SECURITY;
ALTER TABLE lesson_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE criteria_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE criteria_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites FORCE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY organizations_select ON organizations FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organization_id = organizations.id
      AND m.user_id = current_app_user()
      AND m.status = 'active'
  )
);

CREATE POLICY organizations_update ON organizations FOR UPDATE
USING (id = current_app_org() AND current_app_role() = 'representative')
WITH CHECK (id = current_app_org() AND current_app_role() = 'representative');

CREATE POLICY users_select ON users FOR SELECT
USING (
  id = current_app_user()
  OR EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.user_id = users.id
      AND m.organization_id = current_app_org()
      AND m.status = 'active'
      AND (
        current_app_role() = 'representative'
        OR (current_app_role() = 'admin' AND (users.id = current_app_user() OR is_assigned_teacher(users.id)))
      )
  )
);

CREATE POLICY memberships_select ON memberships FOR SELECT
USING (
  user_id = current_app_user()
  OR (
    organization_id = current_app_org()
    AND current_app_role() = 'representative'
  )
  OR (
    organization_id = current_app_org()
    AND current_app_role() = 'admin'
    AND (user_id = current_app_user() OR is_assigned_teacher(user_id))
  )
);

CREATE POLICY memberships_insert ON memberships FOR INSERT
WITH CHECK (
  (
    user_id = current_app_user()
    AND role = 'teacher'
    AND status = 'pending'
    AND org_join_policy(organization_id) = 'invite_or_approval'
  )
  OR (
    current_app_role() = 'representative'
    AND organization_id = current_app_org()
    AND role IN ('teacher', 'admin', 'representative')
    AND status IN ('pending', 'active', 'rejected')
  )
);

CREATE POLICY memberships_update ON memberships FOR UPDATE
USING (organization_id = current_app_org() AND current_app_role() = 'representative')
WITH CHECK (organization_id = current_app_org() AND current_app_role() = 'representative');

CREATE POLICY assignments_select ON teacher_assignments FOR SELECT
USING (
  organization_id = current_app_org()
  AND (
    current_app_role() = 'representative'
    OR (current_app_role() = 'admin' AND admin_id = current_app_user())
    OR (current_app_role() = 'teacher' AND teacher_id = current_app_user())
  )
);

CREATE POLICY assignments_write ON teacher_assignments FOR INSERT
WITH CHECK (
  organization_id = current_app_org()
  AND current_app_role() = 'representative'
  AND EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.user_id = admin_id AND m.organization_id = organization_id AND m.role = 'admin' AND m.status = 'active'
  )
  AND EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.user_id = teacher_id AND m.organization_id = organization_id AND m.role = 'teacher' AND m.status = 'active'
  )
);

CREATE POLICY assignments_delete ON teacher_assignments FOR DELETE
USING (organization_id = current_app_org() AND current_app_role() = 'representative');

CREATE POLICY uploads_select ON uploads FOR SELECT
USING (can_read_teacher(teacher_id, organization_id));

CREATE POLICY uploads_insert ON uploads FOR INSERT
WITH CHECK (
  can_upload_for_teacher(teacher_id, organization_id)
  AND status = 'uploading'
  AND audio_path IS NULL
  AND worker_token IS NULL
);

CREATE POLICY uploads_update ON uploads FOR UPDATE
USING (can_upload_for_teacher(teacher_id, organization_id))
WITH CHECK (can_upload_for_teacher(teacher_id, organization_id));

CREATE POLICY uploads_delete ON uploads FOR DELETE
USING (
  teacher_id = current_app_user()
  AND organization_id = current_app_org()
  AND current_app_role() = 'teacher'
);

CREATE POLICY lines_select ON transcript_lines FOR SELECT
USING (can_read_teacher(teacher_id, organization_id));

CREATE POLICY lines_update ON transcript_lines FOR UPDATE
USING (
  teacher_id = current_app_user()
  AND organization_id = current_app_org()
  AND current_app_role() = 'teacher'
)
WITH CHECK (
  teacher_id = current_app_user()
  AND organization_id = current_app_org()
  AND current_app_role() = 'teacher'
);

CREATE POLICY cards_select ON cards FOR SELECT
USING (can_read_teacher(teacher_id, organization_id));

CREATE POLICY skills_select ON skills FOR SELECT
USING (current_app_user() IS NOT NULL);

CREATE POLICY progress_select ON skill_progress FOR SELECT
USING (can_read_teacher(teacher_id, organization_id));

CREATE POLICY practice_select ON practice_checks FOR SELECT
USING (can_read_teacher(teacher_id, organization_id));

CREATE POLICY practice_insert ON practice_checks FOR INSERT
WITH CHECK (
  teacher_id = current_app_user()
  AND organization_id = current_app_org()
  AND current_app_role() = 'teacher'
  AND practice_date = (now() AT TIME ZONE 'Asia/Seoul')::date
  AND EXISTS (
    SELECT 1 FROM cards c
    WHERE c.id = card_id AND c.teacher_id = current_app_user() AND c.organization_id = current_app_org()
  )
);

CREATE POLICY practice_delete ON practice_checks FOR DELETE
USING (
  teacher_id = current_app_user()
  AND organization_id = current_app_org()
  AND current_app_role() = 'teacher'
);

CREATE POLICY access_select ON access_log FOR SELECT
USING (organization_id = current_app_org() AND current_app_role() = 'representative');

CREATE POLICY access_insert ON access_log FOR INSERT
WITH CHECK (
  user_id = current_app_user()
  AND organization_id = current_app_org()
  AND (
    (target_type = 'recording' AND EXISTS (SELECT 1 FROM uploads u WHERE u.id = target_id))
    OR (target_type = 'card' AND EXISTS (SELECT 1 FROM cards c WHERE c.id = target_id))
  )
);

CREATE POLICY consents_select ON consents FOR SELECT
USING (user_id = current_app_user() AND organization_id = current_app_org());

CREATE POLICY consents_insert ON consents FOR INSERT
WITH CHECK (
  user_id = current_app_user()
  AND organization_id = current_app_org()
  AND current_app_role() IN ('teacher', 'admin', 'representative')
);

CREATE POLICY plans_select ON lesson_plans FOR SELECT
USING (can_read_teacher(teacher_id, organization_id));

CREATE POLICY plans_insert ON lesson_plans FOR INSERT
WITH CHECK (
  teacher_id = current_app_user()
  AND organization_id = current_app_org()
  AND current_app_role() = 'teacher'
  AND file_path ~ '^lesson-plans/[0-9a-f-]{36}[.]pdf$'
);

CREATE POLICY plans_delete ON lesson_plans FOR DELETE
USING (
  teacher_id = current_app_user()
  AND organization_id = current_app_org()
  AND current_app_role() = 'teacher'
);

CREATE POLICY criteria_select ON criteria_versions FOR SELECT
USING (organization_id = current_app_org() AND current_app_user() IS NOT NULL);

CREATE POLICY criteria_insert ON criteria_versions FOR INSERT
WITH CHECK (organization_id = current_app_org() AND current_app_role() = 'representative');

CREATE POLICY notifications_select ON notifications FOR SELECT
USING (user_id = current_app_user() AND organization_id = current_app_org());

CREATE POLICY notifications_update ON notifications FOR UPDATE
USING (user_id = current_app_user() AND organization_id = current_app_org())
WITH CHECK (user_id = current_app_user() AND organization_id = current_app_org());

CREATE POLICY invites_select ON invites FOR SELECT
USING (organization_id = current_app_org() AND current_app_role() = 'representative');

CREATE POLICY invites_insert ON invites FOR INSERT
WITH CHECK (
  organization_id = current_app_org()
  AND current_app_role() = 'representative'
  AND created_by = current_app_user()
);

GRANT CONNECT ON DATABASE class_coach TO class_coach_app;
GRANT USAGE ON SCHEMA public TO class_coach_app;

GRANT SELECT, UPDATE (retention_days) ON organizations TO class_coach_app;
GRANT SELECT (id, email, display_name, created_at) ON users TO class_coach_app;
GRANT SELECT, INSERT, UPDATE (role, status) ON memberships TO class_coach_app;
GRANT SELECT, INSERT, DELETE ON teacher_assignments TO class_coach_app;
GRANT SELECT, INSERT, DELETE, UPDATE (received_chunks, status, failure_reason, file_path, expires_at, updated_at) ON uploads TO class_coach_app;
GRANT SELECT, UPDATE (teacher_check) ON transcript_lines TO class_coach_app;
GRANT SELECT ON cards TO class_coach_app;
GRANT SELECT ON skills TO class_coach_app;
GRANT SELECT ON skill_progress TO class_coach_app;
GRANT SELECT, INSERT, DELETE ON practice_checks TO class_coach_app;
GRANT SELECT, INSERT ON access_log TO class_coach_app;
GRANT SELECT, INSERT ON consents TO class_coach_app;
GRANT SELECT, INSERT, DELETE ON lesson_plans TO class_coach_app;
GRANT SELECT, INSERT ON criteria_versions TO class_coach_app;
GRANT SELECT, UPDATE (read_at) ON notifications TO class_coach_app;
GRANT SELECT, INSERT ON invites TO class_coach_app;

GRANT EXECUTE ON FUNCTION current_app_user() TO class_coach_app;
GRANT EXECUTE ON FUNCTION current_app_org() TO class_coach_app;
GRANT EXECUTE ON FUNCTION current_app_role() TO class_coach_app;
GRANT EXECUTE ON FUNCTION is_assigned_teacher(uuid) TO class_coach_app;
GRANT EXECUTE ON FUNCTION can_read_teacher(uuid, uuid) TO class_coach_app;
GRANT EXECUTE ON FUNCTION can_upload_for_teacher(uuid, uuid) TO class_coach_app;
GRANT EXECUTE ON FUNCTION org_join_policy(uuid) TO class_coach_app;

INSERT INTO schema_migrations (id) VALUES ('001_init');
