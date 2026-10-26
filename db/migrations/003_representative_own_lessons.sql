-- 대표도 자기 수업을 직접 올리고 지울 수 있다(자기 행에 한함). 다른 사람 행 규칙은 그대로.

CREATE OR REPLACE FUNCTION can_upload_for_teacher(target uuid, org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT current_app_user() IS NOT NULL
    AND org IS NOT DISTINCT FROM current_app_org()
    AND (
      (current_app_role() IN ('teacher', 'representative') AND target = current_app_user())
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

DROP POLICY IF EXISTS uploads_delete ON uploads;
CREATE POLICY uploads_delete ON uploads FOR DELETE
USING (
  teacher_id = current_app_user()
  AND organization_id = current_app_org()
  AND current_app_role() IN ('teacher', 'representative')
);
