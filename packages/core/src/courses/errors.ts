import type { CourseIssue } from './graph';

export type CourseErrorCode =
  | 'invalid_course'
  | 'slug_taken'
  | 'version_locked'
  | 'version_not_published'
  | 'course_not_found'
  | 'invalid_content'
  | 'content_not_found'
  | 'media_not_found'
  | 'question_not_found'
  | 'invalid_question'
  | 'wrong_pool'
  | 'not_enrolled'
  | 'node_locked'
  | 'node_cooldown'
  | 'node_passed'
  | 'test_unavailable'
  | 'assessment_not_found'
  | 'assessment_closed'
  | 'already_answered'
  | 'invalid_tutor_input'
  | 'tutor_unavailable'
  | 'tutor_disabled'
  | 'node_test_disabled'
  | 'experiment_not_joined'
  | 'experiment_step_not_allowed'
  | 'experiment_course_missing'
  | 'consent_required'
  | 'invalid_survey'
  | 'tutor_rate_limited'
  | 'tutor_budget_exceeded'
  | 'audit_limit_reached'
  | 'invalid_version_state'
  | 'invalid_graph_edit'
  | 'review_not_found'
  | 'invalid_review'
  | 'review_conflict'
  | 'exam_not_eligible'
  | 'exam_banned'
  | 'exam_cooldown'
  | 'exam_passed'
  | 'exam_time_expired'
  | 'exam_not_current'
  | 'camera_required'
  | 'invalid_proctor_event'
  | 'strike_not_found'
  | 'invalid_strike_state'
  | 'certificate_not_found'
  | 'certificate_not_eligible'
  | 'certificate_on_hold'
  | 'certificate_unavailable'
  | 'invalid_certificate_state'
  | 'invalid_revocation';

const httpStatus: Record<CourseErrorCode, number> = {
  invalid_course: 422,
  slug_taken: 409,
  version_locked: 409,
  version_not_published: 409,
  course_not_found: 404,
  invalid_content: 422,
  content_not_found: 404,
  media_not_found: 404,
  question_not_found: 404,
  invalid_question: 422,
  wrong_pool: 409,
  not_enrolled: 403,
  node_locked: 403,
  node_cooldown: 409,
  node_passed: 409,
  test_unavailable: 409,
  assessment_not_found: 404,
  assessment_closed: 409,
  already_answered: 409,
  invalid_tutor_input: 422,
  tutor_unavailable: 409,
  tutor_disabled: 403,
  node_test_disabled: 403,
  experiment_not_joined: 403,
  experiment_step_not_allowed: 409,
  experiment_course_missing: 409,
  consent_required: 422,
  invalid_survey: 422,
  tutor_rate_limited: 429,
  tutor_budget_exceeded: 429,
  audit_limit_reached: 409,
  invalid_version_state: 409,
  invalid_graph_edit: 422,
  review_not_found: 404,
  invalid_review: 422,
  review_conflict: 409,
  exam_not_eligible: 409,
  exam_banned: 403,
  exam_cooldown: 409,
  exam_passed: 409,
  exam_time_expired: 409,
  exam_not_current: 409,
  camera_required: 409,
  invalid_proctor_event: 422,
  strike_not_found: 404,
  invalid_strike_state: 409,
  certificate_not_found: 404,
  certificate_not_eligible: 409,
  certificate_on_hold: 409,
  certificate_unavailable: 503,
  invalid_certificate_state: 409,
  invalid_revocation: 422,
};

export class CourseError extends Error {
  readonly status: number;
  constructor(
    readonly code: CourseErrorCode,
    /** For `invalid_course`: every problem found, not just the first. */
    readonly issues: CourseIssue[] = [],
  ) {
    super(code);
    this.status = httpStatus[code];
  }
}
