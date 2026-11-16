import type { CourseIssue } from './graph';

export type CourseErrorCode =
  | 'invalid_course'
  | 'slug_taken'
  | 'version_locked'
  | 'version_not_published'
  | 'course_not_found'
  | 'invalid_content'
  | 'content_not_found'
  | 'media_not_found';

const httpStatus: Record<CourseErrorCode, number> = {
  invalid_course: 422,
  slug_taken: 409,
  version_locked: 409,
  version_not_published: 409,
  course_not_found: 404,
  invalid_content: 422,
  content_not_found: 404,
  media_not_found: 404,
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
