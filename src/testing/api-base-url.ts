import { environment } from '@/environments/environment';

/**
 * The API origin HTTP specs configure `API_BASE_URL` with. Kept in one place so
 * the literal is not re-typed per spec; matched to the dev environment.
 */
export const TEST_API_BASE_URL = environment.apiBaseUrl;
