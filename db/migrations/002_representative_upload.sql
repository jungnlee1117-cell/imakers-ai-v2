-- 대표는 같은 소속의 활성 선생님 행에만 업로드한다. 관리자와 선생님의 기존 범위는 유지한다.

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

GRANT EXECUTE ON FUNCTION can_upload_for_teacher(uuid, uuid) TO class_coach_app;

DROP POLICY IF EXISTS uploads_insert ON uploads;
CREATE POLICY uploads_insert ON uploads FOR INSERT
WITH CHECK (
  can_upload_for_teacher(teacher_id, organization_id)
  AND status = 'uploading'
  AND audio_path IS NULL
  AND worker_token IS NULL
);

DROP POLICY IF EXISTS uploads_update ON uploads;
CREATE POLICY uploads_update ON uploads FOR UPDATE
USING (can_upload_for_teacher(teacher_id, organization_id))
WITH CHECK (can_upload_for_teacher(teacher_id, organization_id));
