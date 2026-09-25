import { ApiError } from '@/app/core/api';

/** A Goal-addressed request could not find a Goal available to this person. */
export class GoalUnavailableError extends ApiError {
  constructor(error: ApiError) {
    super(error.message, error.status);
    this.name = 'GoalUnavailableError';
  }
}

/** A Contribution addressed by its ID could not be found or changed. */
export class GoalContributionUnavailableError extends ApiError {
  constructor(error: ApiError) {
    super(error.message, error.status);
    this.name = 'GoalContributionUnavailableError';
  }
}

/** Translate ownership-hiding responses only after an adapter knows the addressed resource. */
export function mapUnavailableResourceError<T extends ApiError>(
  error: unknown,
  create: (error: ApiError) => T,
): unknown {
  if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
    return create(error);
  }
  return error;
}
