import { Octokit } from '@octokit/rest';

export interface GitHubChange {
    id: string;
    timestamp: number;
    filePath: string;
    tagName: string;
    oldClassName: string;
    newClassName: string;
    elementPath: string;
    elementIndex?: number;
}

export interface GitHubConfig {
    owner: string;
    repo: string;
    token: string;
}

export interface GitHubRepository {
    id: number;
    name: string;
    full_name: string;
    owner: {
        login: string;
    };
    private: boolean;
    description: string | null;
}

// GitHub OAuth configuration
// To set up OAuth:
// 1. Go to https://github.com/settings/developers
// 2. Click "New OAuth App"
// 3. Set Application name: "Seam Extension"
// 4. Set Homepage URL: your website (or any valid URL)
// 5. Set Authorization callback URL: https://YOUR_EXTENSION_ID.chromiumapp.org
//    (Get extension ID from chrome://extensions; use chrome.identity.getRedirectURL() format)
// 6. Copy Client ID and Client Secret to .env: VITE_GITHUB_CLIENT_ID, VITE_GITHUB_CLIENT_SECRET
const GITHUB_CLIENT_ID = import.meta.env.VITE_GITHUB_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = import.meta.env.VITE_GITHUB_CLIENT_SECRET || '';
const GITHUB_OAUTH_SCOPE = 'repo';
const GITHUB_OAUTH_REDIRECT_URI = chrome.identity.getRedirectURL();
const GITHUB_TOKEN_EXCHANGE_URL = 'https://github.com/login/oauth/access_token';

// Normalize redirect URI - GitHub may be strict about trailing slashes
// Try without trailing slash if the default has one
const GITHUB_OAUTH_REDIRECT_URI_NORMALIZED = GITHUB_OAUTH_REDIRECT_URI.endsWith('/') 
    ? GITHUB_OAUTH_REDIRECT_URI.slice(0, -1)
    : GITHUB_OAUTH_REDIRECT_URI;

// Validate that client ID is set
if (!GITHUB_CLIENT_ID) {
    console.warn('GitHub OAuth Client ID not configured. Please set VITE_GITHUB_CLIENT_ID in .env file');
}
if (!GITHUB_CLIENT_SECRET) {
    console.warn('GitHub OAuth Client secret not configured. Token exchange requires VITE_GITHUB_CLIENT_SECRET in .env');
}

// Helper function to encode base64 (browser-compatible)
function base64Encode(str: string): string {
    return btoa(unescape(encodeURIComponent(str)));
}

// Helper function to decode base64 (browser-compatible)
function base64Decode(str: string): string {
    return decodeURIComponent(escape(atob(str)));
}

// Generate random string for PKCE (RFC 7636: [a-zA-Z0-9_.~-], length 43-128)
function generateRandomString(length: number): string {
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Generate code verifier for PKCE - RFC 7636 requires 43-128 chars, [a-zA-Z0-9_.~-] only
// Hex chars are valid; 64 bytes -> 128 hex chars exceeds max, so use 43 chars (22 bytes -> 44 hex, or 32 bytes -> 64 hex)
function generateCodeVerifier(): string {
    return generateRandomString(43); // 43 bytes -> 86 hex chars, within 43-128 range
}

// Generate code challenge from verifier (SHA256 hash, base64url encoded)
async function generateCodeChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
    // Convert to base64url (replace + with -, / with _, remove =)
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Initialize GitHub Octokit client
 */
function getOctokit(token: string): Octokit {
    return new Octokit({
        auth: token,
    });
}

/**
 * Parse owner/repo from repository string
 */
export function parseRepo(repoString: string): { owner: string; repo: string } | null {
    const match = repoString.match(/^([^/]+)\/([^/]+)$/);
    if (!match) {
        return null;
    }
    return {
        owner: match[1],
        repo: match[2],
    };
}

/**
 * Authenticate with GitHub using OAuth with PKCE
 * Returns the access token
 */
export async function authenticateWithOAuth(): Promise<{ token: string; scope: string }> {
    // Validate client ID is configured
    if (!GITHUB_CLIENT_ID) {
        throw new Error(
            'GitHub OAuth Client ID not configured. Please set VITE_GITHUB_CLIENT_ID in .env file. ' +
            'See https://github.com/settings/developers to create an OAuth app.'
        );
    }

    // Generate PKCE code verifier and challenge
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateRandomString(32);

    // Store code verifier and state in session storage for later verification
    sessionStorage.setItem('github_code_verifier', codeVerifier);
    sessionStorage.setItem('github_oauth_state', state);

    // Build OAuth URL
    // Use normalized redirect URI (without trailing slash) as GitHub may be strict about this
    const redirectUri = GITHUB_OAUTH_REDIRECT_URI_NORMALIZED;
    const authUrl = new URL('https://github.com/login/oauth/authorize');
    authUrl.searchParams.set('client_id', GITHUB_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', GITHUB_OAUTH_SCOPE);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    // Launch OAuth flow and wait for redirect
    return new Promise((resolve, reject) => {
        chrome.identity.launchWebAuthFlow(
            {
                url: authUrl.toString(),
                interactive: true,
            },
            async (redirectUrl) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }

                if (!redirectUrl) {
                    reject(new Error('No redirect URL received'));
                    return;
                }

                try {
                    // Parse authorization code from redirect URL
                    const url = new URL(redirectUrl);
                    const code = url.searchParams.get('code');
                    const returnedState = url.searchParams.get('state');

                    // Verify state matches
                    const storedState = sessionStorage.getItem('github_oauth_state');
                    if (!code || returnedState !== storedState) {
                        reject(new Error('Invalid OAuth response'));
                        return;
                    }

                    // Retrieve code verifier
                    const storedVerifier = sessionStorage.getItem('github_code_verifier');
                    if (!storedVerifier) {
                        reject(new Error('Code verifier not found'));
                        return;
                    }

                    // Exchange code for access token
                    // GitHub expects form-encoded data, not JSON
                    // IMPORTANT: redirect_uri must match EXACTLY what was sent in authorization request
                    // Use the same normalized redirect URI as in the authorization request
                    const redirectUri = GITHUB_OAUTH_REDIRECT_URI_NORMALIZED;
                    const params = new URLSearchParams();
                    params.append('client_id', GITHUB_CLIENT_ID);
                    if (GITHUB_CLIENT_SECRET) params.append('client_secret', GITHUB_CLIENT_SECRET);
                    params.append('code', code);
                    params.append('redirect_uri', redirectUri);
                    params.append('code_verifier', storedVerifier);

                    const tokenResponse = await fetch(GITHUB_TOKEN_EXCHANGE_URL, {
                        method: 'POST',
                        headers: {
                            'Accept': 'application/json',
                            'Content-Type': 'application/x-www-form-urlencoded',
                        },
                        body: params.toString(),
                    });

                    if (!tokenResponse.ok) {
                        const errorText = await tokenResponse.text();
                        let errorMessage = `Token exchange failed: ${errorText}`;

                        // Provide more helpful error messages
                        if (tokenResponse.status === 404) {
                            // Show the normalized redirect URI (without trailing slash) that we're now using
                            const exactUri = GITHUB_OAUTH_REDIRECT_URI_NORMALIZED;
                            const originalUri = GITHUB_OAUTH_REDIRECT_URI;
                            const hasTrailingSlash = originalUri.endsWith('/');
                            
                            let uriInstructions = '';
                            if (hasTrailingSlash && exactUri !== originalUri) {
                                uriInstructions = `The extension is now using this redirect URI (without trailing slash):\n\n${exactUri}\n\nPlease add this EXACT redirect URI to your GitHub OAuth app. Make sure there are no trailing slashes, spaces, or extra characters.`;
                            } else {
                                uriInstructions = `Please add this EXACT redirect URI to your GitHub OAuth app:\n\n${exactUri}`;
                            }
                            
                            errorMessage = `Token exchange failed: Redirect URI not found in GitHub OAuth app.\n\n${uriInstructions}\n\nIMPORTANT: Use an OAuth App (not a GitHub App). Client ID: ${GITHUB_CLIENT_ID}\n\nSteps:\n1. Go to https://github.com/settings/developers\n2. Under "OAuth Apps", open the app with Client ID: ${GITHUB_CLIENT_ID}\n3. In "Authorization callback URL", add:\n   ${exactUri}\n4. Click "Update application"\n5. Make sure there are no extra spaces, trailing slashes, or characters`;
                        }

                        reject(new Error(errorMessage));
                        return;
                    }

                    const tokenData = await tokenResponse.json();

                    if (tokenData.error) {
                        let errorMessage = `OAuth error: ${tokenData.error_description || tokenData.error}`;

                        if (tokenData.error === 'incorrect_client_credentials') {
                            if (!GITHUB_CLIENT_SECRET) {
                                errorMessage = `GitHub OAuth requires a client secret for token exchange.\n\nAdd VITE_GITHUB_CLIENT_SECRET to your .env file:\n1. Go to https://github.com/settings/developers\n2. Open your OAuth app (Client ID: ${GITHUB_CLIENT_ID})\n3. Generate a new client secret\n4. Add to apps/extension/src/sidepanel/.env:\n   VITE_GITHUB_CLIENT_SECRET=your_secret_here\n5. Rebuild the extension and reload`;
                            } else {
                                errorMessage = `Invalid GitHub OAuth credentials. Verify VITE_GITHUB_CLIENT_ID and VITE_GITHUB_CLIENT_SECRET in .env match your OAuth app at https://github.com/settings/developers`;
                            }
                        } else if (tokenData.error === 'not_found' || tokenData.error === 'redirect_uri_mismatch') {
                            errorMessage = `Redirect URI mismatch. Please ensure your GitHub OAuth app's callback URL is set to exactly: ${GITHUB_OAUTH_REDIRECT_URI_NORMALIZED}`;
                        }

                        reject(new Error(errorMessage));
                        return;
                    }

                    // Clean up session storage
                    sessionStorage.removeItem('github_code_verifier');
                    sessionStorage.removeItem('github_oauth_state');

                    resolve({
                        token: tokenData.access_token,
                        scope: tokenData.scope || '',
                    });
                } catch (error) {
                    reject(error);
                }
            }
        );
    });
}

/**
 * Get authenticated user information
 */
export async function getAuthenticatedUser(token: string): Promise<{ login: string; name: string | null }> {
    try {
        const octokit = getOctokit(token);
        const { data } = await octokit.users.getAuthenticated();
        return {
            login: data.login,
            name: data.name || null,
        };
    } catch (error) {
        console.error('Failed to get authenticated user:', error);
        throw error;
    }
}

/**
 * Get list of repositories for the authenticated user
 */
export async function getUserRepositories(token: string): Promise<GitHubRepository[]> {
    try {
        const octokit = getOctokit(token);
        const { data } = await octokit.repos.listForAuthenticatedUser({
            type: 'all',
            sort: 'updated',
            per_page: 100, // Get up to 100 repos
        });
        return data.map((repo) => ({
            id: repo.id,
            name: repo.name,
            full_name: repo.full_name,
            owner: {
                login: repo.owner.login,
            },
            private: repo.private,
            description: repo.description,
        }));
    } catch (error) {
        console.error('Failed to get user repositories:', error);
        throw error;
    }
}

/**
 * Validate repository access
 */
export async function validateRepoAccess(config: GitHubConfig): Promise<boolean> {
    try {
        const octokit = getOctokit(config.token);
        await octokit.repos.get({
            owner: config.owner,
            repo: config.repo,
        });
        return true;
    } catch (error) {
        console.error('Failed to validate repo access:', error);
        return false;
    }
}

/**
 * Get default branch of repository
 */
export async function getDefaultBranch(config: GitHubConfig): Promise<string> {
    try {
        const octokit = getOctokit(config.token);
        const { data } = await octokit.repos.get({
            owner: config.owner,
            repo: config.repo,
        });
        return data.default_branch;
    } catch (error) {
        console.error('Failed to get default branch:', error);
        throw error;
    }
}

/**
 * Create a new branch from base branch
 */
export async function createBranch(
    config: GitHubConfig,
    baseBranch: string,
    newBranch: string
): Promise<void> {
    try {
        const octokit = getOctokit(config.token);

        // Get the SHA of the base branch
        const { data: refData } = await octokit.git.getRef({
            owner: config.owner,
            repo: config.repo,
            ref: `heads/${baseBranch}`,
        });

        const baseSha = refData.object.sha;

        // Create new branch
        await octokit.git.createRef({
            owner: config.owner,
            repo: config.repo,
            ref: `refs/heads/${newBranch}`,
            sha: baseSha,
        });
    } catch (error) {
        console.error('Failed to create branch:', error);
        throw error;
    }
}

/**
 * Get file content from repository
 */
export async function getFileContent(
    config: GitHubConfig,
    path: string,
    ref: string = 'HEAD'
): Promise<{ content: string; sha: string }> {
    try {
        const octokit = getOctokit(config.token);
        const { data } = await octokit.repos.getContent({
            owner: config.owner,
            repo: config.repo,
            path,
            ref,
        });

        if (Array.isArray(data) || data.type !== 'file') {
            throw new Error(`Path ${path} is not a file`);
        }

        // Decode base64 content
        const content = base64Decode(data.content);
        return {
            content,
            sha: data.sha,
        };
    } catch (error) {
        console.error('Failed to get file content:', error);
        throw error;
    }
}

/**
 * Update file content in repository
 */
export async function updateFile(
    config: GitHubConfig,
    path: string,
    content: string,
    message: string,
    branch: string,
    sha?: string
): Promise<void> {
    try {
        const octokit = getOctokit(config.token);

        // Encode content to base64
        const encodedContent = base64Encode(content);

        await octokit.repos.createOrUpdateFileContents({
            owner: config.owner,
            repo: config.repo,
            path,
            message,
            content: encodedContent,
            branch,
            sha, // Include SHA if updating existing file
        });
    } catch (error) {
        console.error('Failed to update file:', error);
        throw error;
    }
}

/**
 * Create a pull request
 */
export async function createPullRequest(
    config: GitHubConfig,
    title: string,
    body: string,
    headBranch: string,
    baseBranch: string
): Promise<{ url: string; number: number }> {
    try {
        const octokit = getOctokit(config.token);
        const { data } = await octokit.pulls.create({
            owner: config.owner,
            repo: config.repo,
            title,
            body,
            head: headBranch,
            base: baseBranch,
        });

        return {
            url: data.html_url,
            number: data.number,
        };
    } catch (error) {
        console.error('Failed to create pull request:', error);
        throw error;
    }
}

/**
 * Commit multiple file changes to a branch
 */
export async function commitChanges(
    config: GitHubConfig,
    branch: string,
    changes: Array<{
        path: string;
        content: string;
        message: string;
        sha?: string;
    }>
): Promise<void> {
    try {
        // Commit each file change sequentially
        for (const change of changes) {
            await updateFile(
                config,
                change.path,
                change.content,
                change.message,
                branch,
                change.sha
            );
        }
    } catch (error) {
        console.error('Failed to commit changes:', error);
        throw error;
    }
}

