export const GITHUB_API_VERSION = '2026-03-10';

export function githubApiHeaders(token, accept = 'application/vnd.github+json') {
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  };
}

export function githubApiUrl(apiBaseUrl, repository, pathname, query = '') {
  return `${apiBaseUrl.replace(/\/$/, '')}/repos/${repository}/${pathname}${query}`;
}

export function nextGitHubApiPage(linkHeader) {
  for (const link of linkHeader?.split(',') ?? []) {
    const match = link.match(/<([^>]+)>;\s*rel="next"/);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}
